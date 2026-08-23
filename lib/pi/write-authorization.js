const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_LIMITS = Object.freeze({
  maxBodyBytes: 1_048_576,
  maxPropertyBytes: 262_144,
  maxAttachmentFiles: 10,
  maxAttachmentFileBytes: 26_214_400,
  maxAttachmentTotalBytes: 104_857_600,
});

const LIMIT_ENV = Object.freeze({
  maxBodyBytes: 'CONFLUENCE_PI_MAX_BODY_BYTES',
  maxPropertyBytes: 'CONFLUENCE_PI_MAX_PROPERTY_BYTES',
  maxAttachmentFiles: 'CONFLUENCE_PI_MAX_ATTACHMENT_FILES',
  maxAttachmentFileBytes: 'CONFLUENCE_PI_MAX_ATTACHMENT_FILE_BYTES',
  maxAttachmentTotalBytes: 'CONFLUENCE_PI_MAX_ATTACHMENT_TOTAL_BYTES',
});

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isTrueLike(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function makeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function projectError(message) {
  return makeError('PROJECT_PATH', message);
}

function cancellationError(message) {
  return makeError('CANCELLED', message);
}

function confirmationMismatchError(message) {
  return makeError('CONFIRMATION_MISMATCH', message);
}

function noUiError(message) {
  return makeError('NO_UI', message);
}

function isInsideProject(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw makeError('INVALID_ARGUMENT', `${name} must be a non-empty string.`);
  }
  return value;
}

function canonicalProjectRoot(projectRoot) {
  const resolvedRoot = path.resolve(requireString(projectRoot, 'projectRoot'));
  return fs.realpathSync(resolvedRoot);
}

function parseLimit(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { value: fallback, valid: true };
  }

  const trimmed = String(raw).trim();
  if (!/^[1-9][0-9]*$/.test(trimmed)) {
    return { value: fallback, valid: false };
  }

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    return { value: fallback, valid: false };
  }

  return { value, valid: true };
}

function parseLimits(env = {}) {
  const values = { ...DEFAULT_LIMITS };
  let valid = true;

  for (const [key, envName] of Object.entries(LIMIT_ENV)) {
    const parsed = parseLimit(env[envName], DEFAULT_LIMITS[key]);
    values[key] = parsed.value;
    valid = valid && parsed.valid;
  }

  return {
    limits: Object.freeze(values),
    valid,
  };
}

function parseSpaces(rawSpaces) {
  const spaces = new Set();
  if (!hasText(rawSpaces)) {
    return { spaces, valid: false };
  }

  for (const token of String(rawSpaces).split(',')) {
    const normalized = token.trim();
    if (normalized === '') {
      continue;
    }
    if (/[*?]/.test(normalized)) {
      return { spaces: new Set(), valid: false };
    }
    spaces.add(normalized.toUpperCase());
  }

  return { spaces, valid: spaces.size > 0 };
}

function readWriteConfig(env = {}) {
  const writesEnabled = String(env.CONFLUENCE_PI_WRITES ?? '').trim() === 'true';
  const spaceConfig = parseSpaces(env.CONFLUENCE_PI_WRITE_SPACES);
  const limitConfig = parseLimits(env);

  return Object.freeze({
    enabled: Boolean(writesEnabled && spaceConfig.valid && limitConfig.valid),
    spaces: Object.freeze(new Set(spaceConfig.spaces)),
    limits: limitConfig.limits,
  });
}

function assertWriteEnabled(env = {}) {
  if (isTrueLike(env.CONFLUENCE_READ_ONLY)) {
    throw makeError('READ_ONLY', 'Writes are blocked by CONFLUENCE_READ_ONLY.');
  }

  const config = readWriteConfig(env);
  if (!config.enabled) {
    throw makeError('WRITE_DISABLED', 'Confluence writes are not enabled.');
  }

  return {
    spaces: config.spaces,
    limits: config.limits,
  };
}

function normalizeAllowedSpaces(allowedSpaces) {
  if (allowedSpaces instanceof Set) {
    return allowedSpaces;
  }
  if (Array.isArray(allowedSpaces)) {
    return new Set(allowedSpaces.map((space) => String(space).trim().toUpperCase()));
  }
  return new Set();
}

function resolveTargetSpaceKey(target) {
  const raw = target?.spaceKey ?? target?.space?.key;
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const normalized = String(raw).trim();
  if (normalized === '') {
    return undefined;
  }
  return normalized.toUpperCase();
}

function assertAllowedSpaces(targets, allowedSpaces) {
  const allowed = normalizeAllowedSpaces(allowedSpaces);

  for (const target of targets || []) {
    const spaceKey = resolveTargetSpaceKey(target);
    if (!spaceKey) {
      throw makeError('SPACE_NOT_RESOLVED', 'A target space must be resolved before authorization.');
    }
    if (!allowed.has(spaceKey)) {
      throw makeError('SPACE_NOT_ALLOWED', `Space ${spaceKey} is not allowed.`);
    }
  }
}

function resolveProjectInputFile(projectRoot, candidate) {
  const root = canonicalProjectRoot(projectRoot);
  const resolved = path.resolve(root, requireString(candidate, 'path'));
  const canonical = fs.realpathSync(resolved);

  if (!isInsideProject(root, canonical)) {
    throw projectError('Path must stay inside the project directory.');
  }

  const stat = fs.statSync(canonical);
  if (!stat.isFile()) {
    throw projectError('Path must resolve to a regular file inside the project directory.');
  }

  return canonical;
}

function resolveProjectOutputPath(projectRoot, candidate) {
  const root = canonicalProjectRoot(projectRoot);
  const resolved = path.resolve(root, requireString(candidate, 'path'));
  let current = resolved;
  const suffix = [];

  while (!fs.existsSync(current)) {
    try {
      const linkStat = fs.lstatSync(current);
      if (linkStat.isSymbolicLink()) {
        throw projectError('Path must stay inside the project directory.');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    suffix.unshift(path.basename(current));
    current = parent;
  }

  if (!fs.existsSync(current)) {
    throw projectError('Path must stay inside the project directory.');
  }

  const canonicalAncestor = fs.realpathSync(current);
  if (!isInsideProject(root, canonicalAncestor)) {
    throw projectError('Path must stay inside the project directory.');
  }

  const ancestorStat = fs.statSync(canonicalAncestor);
  if (suffix.length > 0 && !ancestorStat.isDirectory()) {
    throw projectError('Path must stay inside the project directory.');
  }

  return suffix.length === 0
    ? canonicalAncestor
    : path.join(canonicalAncestor, ...suffix);
}

function snapshotFile(filePath) {
  const canonicalPath = fs.realpathSync(requireString(filePath, 'path'));
  const stat = fs.statSync(canonicalPath);
  if (!stat.isFile()) {
    throw projectError('Path must resolve to a regular file.');
  }

  return Object.freeze({
    path: canonicalPath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(canonicalPath)).digest('hex'),
  });
}

function verifyFileSnapshots(fileSnapshots) {
  for (const snapshot of fileSnapshots || []) {
    let canonicalPath;
    try {
      canonicalPath = fs.realpathSync(snapshot.path);
    } catch (error) {
      throw makeError('STALE_FILE', 'File snapshot changed after confirmation.');
    }

    if (canonicalPath !== snapshot.path) {
      throw makeError('STALE_FILE', 'File snapshot changed after confirmation.');
    }

    const stat = fs.statSync(canonicalPath);
    if (!stat.isFile()) {
      throw makeError('STALE_FILE', 'File snapshot changed after confirmation.');
    }

    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(canonicalPath)).digest('hex');
    if (
      stat.size !== snapshot.size
      || stat.mtimeMs !== snapshot.mtimeMs
      || sha256 !== snapshot.sha256
    ) {
      throw makeError('STALE_FILE', 'File snapshot changed after confirmation.');
    }
  }
}

function byteLength(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

function ensureWithinLimit(actualBytes, limit, label) {
  if (actualBytes > limit) {
    throw makeError('PAYLOAD_TOO_LARGE', `${label} exceeds the configured limit.`);
  }
}

function normalizeBodySource(input, projectRoot, limits, snapshots, required) {
  const hasContent = hasText(input.content);
  const hasContentFile = hasText(input.contentFile ?? input.file);

  if (hasContent && hasContentFile) {
    throw makeError('PAYLOAD_INVALID', 'Use only one of content or contentFile.');
  }

  if (!hasContent && !hasContentFile) {
    if (required) {
      throw makeError('PAYLOAD_INVALID', 'Either content or contentFile is required.');
    }
    return { present: false };
  }

  if (hasContent) {
    const serialized = String(input.content);
    ensureWithinLimit(byteLength(serialized), limits.maxBodyBytes, 'Body');
    return {
      present: true,
      input: { content: serialized },
    };
  }

  const canonical = resolveProjectInputFile(projectRoot, input.contentFile ?? input.file);
  const text = fs.readFileSync(canonical, 'utf8');
  ensureWithinLimit(Buffer.byteLength(text, 'utf8'), limits.maxBodyBytes, 'Body');
  snapshots.push(snapshotFile(canonical));
  return {
    present: true,
    input: { contentFile: canonical },
  };
}

function normalizePropertyValue(input, projectRoot, limits, snapshots) {
  const hasValue = Object.prototype.hasOwnProperty.call(input, 'value') && input.value !== undefined;
  const hasValueFile = hasText(input.valueFile ?? input.file);

  if (hasValue && hasValueFile) {
    throw makeError('PAYLOAD_INVALID', 'Use only one of value or valueFile.');
  }

  if (!hasValue && !hasValueFile) {
    throw makeError('PAYLOAD_INVALID', 'Either value or valueFile is required.');
  }

  if (hasValue) {
    const serialized = JSON.stringify(input.value);
    ensureWithinLimit(byteLength(serialized), limits.maxPropertyBytes, 'Property value');
    return {
      present: true,
      input: { value: serialized },
    };
  }

  const canonical = resolveProjectInputFile(projectRoot, input.valueFile ?? input.file);
  const text = fs.readFileSync(canonical, 'utf8');
  ensureWithinLimit(Buffer.byteLength(text, 'utf8'), limits.maxPropertyBytes, 'Property value');
  snapshots.push(snapshotFile(canonical));
  return {
    present: true,
    input: { valueFile: canonical },
  };
}

function normalizeAttachmentFiles(input, projectRoot, limits, snapshots) {
  const source = input.files ?? input.file ?? input.attachmentFiles;
  const files = Array.isArray(source) ? source : (source === undefined || source === null ? [] : [source]);

  if (files.length === 0) {
    throw makeError('PAYLOAD_INVALID', 'At least one attachment file is required.');
  }
  if (files.length > limits.maxAttachmentFiles) {
    throw makeError('PAYLOAD_TOO_LARGE', 'Attachment file count exceeds the configured limit.');
  }

  const canonicalFiles = [];
  let totalBytes = 0;
  for (const file of files) {
    const canonical = resolveProjectInputFile(projectRoot, file);
    const stat = fs.statSync(canonical);
    if (!stat.isFile()) {
      throw projectError('Attachment files must be regular files inside the project directory.');
    }
    if (stat.size > limits.maxAttachmentFileBytes) {
      throw makeError('PAYLOAD_TOO_LARGE', 'Attachment file size exceeds the configured limit.');
    }
    totalBytes += stat.size;
    canonicalFiles.push(canonical);
    snapshots.push(snapshotFile(canonical));
  }

  if (totalBytes > limits.maxAttachmentTotalBytes) {
    throw makeError('PAYLOAD_TOO_LARGE', 'Attachment payload exceeds the configured limit.');
  }

  return {
    present: true,
    input: { files: canonicalFiles },
  };
}

function normalizePayloadForOperation(operation, rawInput, projectRoot, limits, snapshots) {
  const input = { ...(rawInput || {}) };

  switch (operation) {
  case 'confluence_create':
  case 'confluence_create_child': {
    const type = input.type ?? 'page';
    if (type === 'folder') {
      if (hasText(input.content) || hasText(input.contentFile ?? input.file)) {
        throw makeError('PAYLOAD_INVALID', 'Folders must not include a page body.');
      }
      break;
    }

    const body = normalizeBodySource(input, projectRoot, limits, snapshots, true);
    Object.assign(input, body.input);
    delete input.file;
    break;
  }
  case 'confluence_update': {
    const hasTitle = hasText(input.title);
    const body = normalizeBodySource(input, projectRoot, limits, snapshots, false);
    if (!hasTitle && !body.present) {
      throw makeError('PAYLOAD_INVALID', 'At least one of title, content, or contentFile is required.');
    }
    if (body.present) {
      Object.assign(input, body.input);
    }
    delete input.file;
    break;
  }
  case 'confluence_comment_create': {
    const body = normalizeBodySource(input, projectRoot, limits, snapshots, true);
    Object.assign(input, body.input);
    delete input.file;
    break;
  }
  case 'confluence_property_set': {
    const value = normalizePropertyValue(input, projectRoot, limits, snapshots);
    Object.assign(input, value.input);
    delete input.file;
    break;
  }
  case 'confluence_attachment_upload': {
    const attachments = normalizeAttachmentFiles(input, projectRoot, limits, snapshots);
    Object.assign(input, attachments.input);
    delete input.file;
    delete input.attachmentFiles;
    break;
  }
  default:
    throw makeError('OPERATION_NOT_ALLOWED', `Confluence operation "${operation}" is not allowed.`);
  }

  return Object.freeze(input);
}

function validateAndNormalizePayload(operation, input, projectRoot, limits = DEFAULT_LIMITS) {
  const snapshots = [];
  const normalized = normalizePayloadForOperation(operation, input, projectRoot, limits, snapshots);
  return Object.freeze({
    input: normalized,
    fileSnapshots: Object.freeze(snapshots),
  });
}

function isCancelledResult(result) {
  return result === undefined || result === null || result === false;
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'ERR_ABORTED';
}

async function confirmWrite({ ctx, signal, title, message, phrase }) {
  if (!ctx || ctx.hasUI !== true || !ctx.ui) {
    throw noUiError('Pi UI is required for write confirmation.');
  }

  if (phrase === undefined) {
    try {
      const response = await ctx.ui.confirm(title, message, { signal });
      if (response === true) {
        return;
      }
      throw cancellationError('Write confirmation was cancelled.');
    } catch (error) {
      if (isAbortError(error)) {
        throw cancellationError('Write confirmation was cancelled.');
      }
      if (error?.code === 'CANCELLED' || error?.code === 'NO_UI') {
        throw error;
      }
      throw error;
    }
  }

  try {
    const response = await ctx.ui.input(
      `Confluence destructive confirmation\n${message}`,
      `Type exactly: ${phrase}`,
      { signal },
    );

    if (isCancelledResult(response)) {
      throw cancellationError('Write confirmation was cancelled.');
    }
    if (response === phrase) {
      return;
    }
    throw confirmationMismatchError('Confirmation phrase did not match exactly.');
  } catch (error) {
    if (isAbortError(error)) {
      throw cancellationError('Write confirmation was cancelled.');
    }
    if (error?.code === 'CANCELLED' || error?.code === 'CONFIRMATION_MISMATCH') {
      throw error;
    }
    throw error;
  }
}

module.exports = {
  DEFAULT_LIMITS,
  LIMIT_ENV,
  readWriteConfig,
  assertWriteEnabled,
  assertAllowedSpaces,
  resolveProjectInputFile,
  resolveProjectOutputPath,
  snapshotFile,
  verifyFileSnapshots,
  validateAndNormalizePayload,
  confirmWrite,
};
