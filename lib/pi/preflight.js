const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_PAGES = 100;

const OPERATION_HANDLERS = Object.freeze({
  confluence_move: (invoker, input) => handleMove(invoker, input),
  confluence_create_child: (invoker, input) => handleCreateChild(invoker, input),
  confluence_update: (invoker, input) => handleSinglePage(invoker, input, 'confluence_update'),
  confluence_delete: (invoker, input) => handleSinglePage(invoker, input, 'confluence_delete'),
  confluence_comment_create: (invoker, input) => handleSinglePage(invoker, input, 'confluence_comment_create'),
  confluence_property_set: (invoker, input) => handleSinglePage(invoker, input, 'confluence_property_set'),
  confluence_attachment_upload: (invoker, input) => handleSinglePage(invoker, input, 'confluence_attachment_upload'),
  confluence_comment_delete: (invoker, input) => handleCommentDelete(invoker, input),
  confluence_property_delete: (invoker, input) => handlePropertyDelete(invoker, input),
  confluence_attachment_delete: (invoker, input) => handleAttachmentDelete(invoker, input),
  confluence_version_delete: (invoker, input) => handleVersionDelete(invoker, input),
  confluence_copy_tree_preview: (invoker, input) => handleCopyTreePreview(invoker, input, 'confluence_copy_tree_preview'),
  confluence_copy_tree: (invoker, input) => handleCopyTreePreview(invoker, input, 'confluence_copy_tree'),
  confluence_versions_purge_preview: (invoker, input) => handleVersionsPurge(invoker, input, 'confluence_versions_purge_preview'),
  confluence_versions_purge: (invoker, input) => handleVersionsPurge(invoker, input, 'confluence_versions_purge'),
  confluence_create: (invoker, input) => handleCreate(invoker, input),
});

function makeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function hasValue(value) {
  return value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
}

function requireText(value, name) {
  if (!hasValue(value)) {
    throw makeError('MALFORMED_RESULT', `${name} must be present.`);
  }
  return String(value).trim();
}

function requireSpaceKey(value, name) {
  return requireText(value, name).toUpperCase();
}

function normalizeId(value) {
  return requireText(value, 'id');
}

function normalizePageRecord(payload, label = 'page') {
  const data = payload && typeof payload === 'object' && payload.page && typeof payload.page === 'object'
    ? payload.page
    : payload;

  if (!data || typeof data !== 'object') {
    throw makeError('MALFORMED_RESULT', `Preflight ${label} response must be an object.`);
  }

  const pageId = data.id ?? data.pageId ?? data.contentId;
  const title = data.title ?? data.name;
  const space = data.space && typeof data.space === 'object' ? data.space.key : data.spaceKey ?? data.space;

  if (!hasValue(pageId) || !hasValue(title) || !hasValue(space)) {
    throw makeError('MALFORMED_RESULT', `Preflight ${label} response must include id, title, and space key.`);
  }

  return Object.freeze({
    pageId: String(pageId).trim(),
    title: String(title).trim(),
    spaceKey: requireSpaceKey(space, 'space key'),
  });
}

function pageSummary(page) {
  return `${page.title} (ID: ${page.pageId}, SPACE: ${page.spaceKey})`;
}

function stableCanonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableCanonicalize(entry));
  }

  if (value && typeof value === 'object') {
    const canonical = {};
    for (const key of Object.keys(value).sort()) {
      canonical[key] = stableCanonicalize(value[key]);
    }
    return canonical;
  }

  return value;
}

function stableFingerprint(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableCanonicalize(value)))
    .digest('hex');
}

function unwrapInvocationResult(result) {
  if (result && typeof result === 'object') {
    if (result.truncated === true || result.outputTruncated === true) {
      throw makeError('OUTPUT_TRUNCATED', 'Preflight response was truncated.');
    }

    if (Object.prototype.hasOwnProperty.call(result, 'json')) {
      return result.json;
    }
  }

  return result;
}

async function invokeJson(invoker, toolName, input) {
  const response = await invoker(toolName, input);
  return unwrapInvocationResult(response);
}

function normalizeInput(rawInput, transforms) {
  const input = rawInput && typeof rawInput === 'object' ? { ...rawInput } : {};

  for (const [key, transform] of Object.entries(transforms)) {
    if (hasValue(input[key])) {
      input[key] = transform(input[key]);
    }
  }

  return input;
}

function normalizePageIdInput(rawInput, fields) {
  const transforms = {};
  for (const field of fields) {
    transforms[field] = normalizeId;
  }
  return normalizeInput(rawInput, transforms);
}

function normalizeSinglePageInput(rawInput) {
  return normalizePageIdInput(rawInput, ['pageId']);
}

function normalizeCreateChildInput(rawInput) {
  return normalizePageIdInput(rawInput, ['parentId']);
}

function normalizeMoveInput(rawInput) {
  return normalizePageIdInput(rawInput, ['pageId', 'newParentId']);
}

function normalizeCommentDeleteInput(rawInput) {
  return normalizePageIdInput(rawInput, ['pageId', 'commentId']);
}

function normalizePropertyDeleteInput(rawInput) {
  const input = normalizePageIdInput(rawInput, ['pageId']);
  if (hasValue(input.key)) {
    input.key = String(input.key).trim();
  }
  return input;
}

function normalizeAttachmentDeleteInput(rawInput) {
  return normalizePageIdInput(rawInput, ['pageId', 'attachmentId']);
}

function normalizeVersionDeleteInput(rawInput) {
  const input = normalizePageIdInput(rawInput, ['pageId']);
  if (hasValue(input.versionNumber)) {
    input.versionNumber = String(input.versionNumber).trim();
  }
  return input;
}

function normalizeCopyTreeInput(rawInput) {
  const input = normalizePageIdInput(rawInput, ['sourcePageId', 'targetParentId']);
  if (hasValue(input.title)) {
    input.title = String(input.title).trim();
  }
  return input;
}

function normalizeCreateInput(rawInput) {
  const input = rawInput && typeof rawInput === 'object' ? { ...rawInput } : {};
  if (hasValue(input.title)) {
    input.title = String(input.title).trim();
  }
  if (hasValue(input.spaceKey)) {
    input.spaceKey = requireSpaceKey(input.spaceKey, 'space key');
  }
  return input;
}

function normalizeForOperation(operation, rawInput) {
  switch (operation) {
  case 'confluence_move':
    return normalizeMoveInput(rawInput);
  case 'confluence_create_child':
    return normalizeCreateChildInput(rawInput);
  case 'confluence_update':
  case 'confluence_delete':
  case 'confluence_comment_create':
  case 'confluence_property_set':
  case 'confluence_attachment_upload':
  case 'confluence_versions_purge_preview':
  case 'confluence_versions_purge':
    return normalizeSinglePageInput(rawInput);
  case 'confluence_comment_delete':
    return normalizeCommentDeleteInput(rawInput);
  case 'confluence_property_delete':
    return normalizePropertyDeleteInput(rawInput);
  case 'confluence_attachment_delete':
    return normalizeAttachmentDeleteInput(rawInput);
  case 'confluence_version_delete':
    return normalizeVersionDeleteInput(rawInput);
  case 'confluence_copy_tree_preview':
  case 'confluence_copy_tree':
    return normalizeCopyTreeInput(rawInput);
  case 'confluence_create':
    return normalizeCreateInput(rawInput);
  default:
    return rawInput && typeof rawInput === 'object' ? { ...rawInput } : {};
  }
}

async function resolvePage(invoker, pageId, label = 'page') {
  const response = await invokeJson(invoker, 'confluence_info', { pageId: normalizeId(pageId) });
  return normalizePageRecord(response, label);
}

function extractItems(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const candidates = [payload.results, payload.items, payload.comments, payload.attachments, payload.properties, payload.versions];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function itemIdForType(item, type) {
  if (item === null || item === undefined) {
    return undefined;
  }

  if (typeof item !== 'object') {
    return item;
  }

  if (type === 'property') {
    return item.key;
  }

  if (type === 'version') {
    return item.number ?? item.versionNumber ?? item.id;
  }

  if (type === 'attachment') {
    return item.id ?? item.attachmentId;
  }

  return item.id ?? item.commentId;
}

function verifyListOwnership(response, pageId, label) {
  if (!response || typeof response !== 'object') {
    throw makeError('MALFORMED_RESULT', `Preflight ${label} response must be an object.`);
  }

  const reportedPageId = response.pageId ?? response.id ?? response.contentId;
  if (hasValue(reportedPageId) && String(reportedPageId).trim() !== String(pageId)) {
    throw makeError('MALFORMED_RESULT', `Preflight ${label} response does not belong to the requested page.`);
  }
}

async function findPagedMatch({ invoker, toolName, page, label, type, matchValue }) {
  const seenCursors = new Set();
  let start = 0;
  let pageCount = 0;
  let match = null;

  while (true) {
    const cursor = String(start);
    if (seenCursors.has(cursor)) {
      throw makeError('PAGINATION_LOOP', `Preflight ${label} pagination repeated cursor ${cursor}.`);
    }
    seenCursors.add(cursor);
    pageCount += 1;
    if (pageCount > MAX_PAGES) {
      throw makeError('PAGINATION_LIMIT', `Preflight ${label} pagination exceeded ${MAX_PAGES} pages.`);
    }

    const response = await invokeJson(invoker, toolName, { pageId: page.pageId, start });
    verifyListOwnership(response, page.pageId, label);
    const items = extractItems(response);

    for (const item of items) {
      const itemId = itemIdForType(item, type);
      if (hasValue(itemId) && String(itemId).trim() === String(matchValue)) {
        if (match) {
          throw makeError('AMBIGUOUS_TARGET', `Preflight ${label} ownership is ambiguous.`);
        }
        match = item;
      }
    }

    if (!Object.prototype.hasOwnProperty.call(response, 'nextStart') || response.nextStart === undefined || response.nextStart === null) {
      break;
    }

    start = response.nextStart;
  }

  if (!match) {
    throw makeError('TARGET_NOT_FOUND', `Preflight ${label} target was not found.`);
  }

  return match;
}

function parseVersionNumber(value) {
  if (!hasValue(value)) {
    return undefined;
  }
  const normalized = String(value).trim();
  return normalized === '' ? undefined : normalized;
}

function collectVersionState(payload, page) {
  verifyListOwnership(payload, page.pageId, 'versions');
  const versions = extractItems(payload).map((item) => {
    if (item && typeof item === 'object') {
      return parseVersionNumber(item.number ?? item.versionNumber ?? item.id);
    }
    return parseVersionNumber(item);
  }).filter((version) => version !== undefined);

  if (versions.length === 0) {
    throw makeError('MALFORMED_RESULT', 'Preflight versions response must include version numbers.');
  }

  const currentVersionValue = payload && typeof payload === 'object'
    ? payload.currentVersion ?? payload.current?.number ?? versions[versions.length - 1]
    : versions[versions.length - 1];

  const currentVersion = parseVersionNumber(currentVersionValue);
  if (!hasValue(currentVersion)) {
    throw makeError('MALFORMED_RESULT', 'Preflight versions response must include the current version.');
  }

  const historicalVersions = versions.filter((version) => String(version) !== String(currentVersion));

  return {
    currentVersion: Number(currentVersion),
    historicalVersions: historicalVersions.map((version) => Number(version)),
  };
}

function buildResult({ operation, input, targets, facts, summary, phrase }) {
  const canonicalFacts = facts ?? {};
  const resultInput = input && typeof input === 'object' ? input : {};
  const resultTargets = Array.isArray(targets) ? targets.map((target) => Object.freeze({ ...target })) : [];
  return Object.freeze({
    operation,
    input: Object.freeze({ ...resultInput }),
    targets: Object.freeze(resultTargets),
    facts: Object.freeze({ ...canonicalFacts }),
    summary,
    phrase,
    inputHash: stableFingerprint({ operation, input: resultInput }),
    snapshotHash: stableFingerprint({ targets: resultTargets, facts: canonicalFacts }),
  });
}

function target(role, page) {
  return {
    role,
    pageId: page.pageId,
    title: page.title,
    spaceKey: page.spaceKey,
  };
}

async function handleMove(invoker, input) {
  const source = await resolvePage(invoker, input.pageId, 'move source');
  const destination = await resolvePage(invoker, input.newParentId, 'move destination');
  return buildResult({
    operation: 'confluence_move',
    input,
    targets: [target('source', source), target('destination', destination)],
    facts: {},
    summary: `Move ${pageSummary(source)} to ${pageSummary(destination)}?`,
  });
}

async function handleCreateChild(invoker, input) {
  const parent = await resolvePage(invoker, input.parentId, 'parent');
  return buildResult({
    operation: 'confluence_create_child',
    input,
    targets: [target('parent', parent)],
    facts: {},
    summary: `Create child under ${pageSummary(parent)}?`,
  });
}

async function handleCreate(invoker, input) {
  const targetSpace = requireSpaceKey(input.spaceKey, 'space key');
  const resultTarget = {
    role: 'destination',
    pageId: targetSpace,
    title: hasValue(input.title) ? String(input.title).trim() : '',
    spaceKey: targetSpace,
  };
  return buildResult({
    operation: 'confluence_create',
    input,
    targets: [resultTarget],
    facts: {},
    summary: `Create ${hasValue(input.title) ? String(input.title).trim() : 'page'} in SPACE ${targetSpace}?`,
  });
}

function statAttachment(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return undefined;
  }
}

function attachmentUploadSummary(input, page) {
  const files = Array.isArray(input.files) ? input.files : [];
  const sizes = files.map((file) => statAttachment(file));
  const parts = files.map((file, index) => {
    const size = sizes[index];
    return size === undefined
      ? `${path.basename(file)} (size unknown)`
      : `${path.basename(file)} (${size} bytes)`;
  });
  const knownTotalBytes = sizes.reduce((sum, size) => sum + (size || 0), 0);
  const totalText = sizes.every((size) => size !== undefined)
    ? `${knownTotalBytes} bytes`
    : `${knownTotalBytes} known bytes`;
  const replaceState = input.replace === true ? 'replace existing files' : 'do not replace existing files';
  return `Upload attachments to ${pageSummary(page)}: ${parts.join(', ')}; total ${totalText}; ${replaceState}?`;
}

async function handleSinglePage(invoker, input, operation) {
  const page = await resolvePage(invoker, input.pageId, operation);
  const actionMap = {
    confluence_update: 'Update',
    confluence_delete: 'Delete',
    confluence_comment_create: 'Create comment on',
    confluence_property_set: 'Set property on',
  };
  const summary = operation === 'confluence_attachment_upload'
    ? attachmentUploadSummary(input, page)
    : `${actionMap[operation] || 'Process'} ${pageSummary(page)}?`;
  const phrase = operation === 'confluence_delete' ? `DELETE PAGE ${input.pageId}` : undefined;
  return buildResult({
    operation,
    input,
    targets: [target('target', page)],
    facts: {},
    summary,
    phrase,
  });
}

async function handleCommentDelete(invoker, input) {
  const page = await resolvePage(invoker, input.pageId, 'comment');
  await findPagedMatch({
    invoker,
    toolName: 'confluence_comments',
    page,
    label: 'comment',
    type: 'comment',
    matchValue: input.commentId,
  });

  return buildResult({
    operation: 'confluence_comment_delete',
    input,
    targets: [target('page', page)],
    facts: {},
    summary: `Delete comment ${input.commentId} from ${pageSummary(page)}?`,
    phrase: `DELETE COMMENT ${input.commentId} FROM ${input.pageId}`,
  });
}

async function handlePropertyDelete(invoker, input) {
  const page = await resolvePage(invoker, input.pageId, 'property');
  await findPagedMatch({
    invoker,
    toolName: 'confluence_property_list',
    page,
    label: 'property',
    type: 'property',
    matchValue: input.key,
  });

  return buildResult({
    operation: 'confluence_property_delete',
    input,
    targets: [target('page', page)],
    facts: {},
    summary: `Delete property ${input.key} from ${pageSummary(page)}?`,
    phrase: `DELETE PROPERTY ${input.key} FROM ${input.pageId}`,
  });
}

async function handleAttachmentDelete(invoker, input) {
  const page = await resolvePage(invoker, input.pageId, 'attachment');
  await findPagedMatch({
    invoker,
    toolName: 'confluence_attachments',
    page,
    label: 'attachment',
    type: 'attachment',
    matchValue: input.attachmentId,
  });

  return buildResult({
    operation: 'confluence_attachment_delete',
    input,
    targets: [target('page', page)],
    facts: {},
    summary: `Delete attachment ${input.attachmentId} from ${pageSummary(page)}?`,
    phrase: `DELETE ATTACHMENT ${input.attachmentId} FROM ${input.pageId}`,
  });
}

async function handleVersionDelete(invoker, input) {
  const page = await resolvePage(invoker, input.pageId, 'versions');
  const response = await invokeJson(invoker, 'confluence_versions', { pageId: normalizeId(input.pageId) });
  const state = collectVersionState(response, page);
  const requested = parseVersionNumber(input.versionNumber);

  if (String(requested) === String(state.currentVersion)) {
    throw makeError('CURRENT_VERSION', 'The current version cannot be deleted.');
  }

  if (!state.historicalVersions.some((version) => String(version) === String(requested))) {
    throw makeError('TARGET_NOT_FOUND', 'Preflight version target was not found.');
  }

  return buildResult({
    operation: 'confluence_version_delete',
    input,
    targets: [target('page', page)],
    facts: {},
    summary: `Delete version ${requested} from ${pageSummary(page)}?`,
    phrase: `DELETE VERSION ${requested} FROM ${input.pageId}`,
  });
}

async function handleCopyTreePreview(invoker, input, operation) {
  const source = await resolvePage(invoker, input.sourcePageId, 'copy tree source');
  const destination = await resolvePage(invoker, input.targetParentId, 'copy tree destination');
  const preview = await invokeJson(invoker, 'confluence_copy_tree_preview', input);

  const childCountValue = preview && typeof preview === 'object'
    ? preview.childCount ?? preview.plannedCount ?? preview.count
    : undefined;
  if (!hasValue(childCountValue)) {
    throw makeError('MALFORMED_RESULT', 'Preflight copy tree response must include a child count.');
  }

  const childCount = Number(childCountValue);
  if (!Number.isFinite(childCount)) {
    throw makeError('MALFORMED_RESULT', 'Preflight copy tree child count must be numeric.');
  }

  const rootTitle = hasValue(preview && preview.rootTitle) ? String(preview.rootTitle).trim() : source.title;
  const totalCreateCount = childCount + 1;
  const plannedRoot = rootTitle === source.title ? '' : ` Planned root title: ${rootTitle}.`;
  const summary = `Copy ${totalCreateCount} pages from ${pageSummary(source)} to ${pageSummary(destination)}${plannedRoot}?`;
  return buildResult({
    operation,
    input,
    targets: [target('source', source), target('destination', destination)],
    facts: {
      rootTitle,
      childCount,
      totalCreateCount,
    },
    summary,
    phrase: `COPY ${totalCreateCount} PAGES FROM ${source.pageId} TO ${destination.pageId}`,
  });
}

async function handleVersionsPurge(invoker, input, operation) {
  const page = await resolvePage(invoker, input.pageId, 'versions');
  const response = await invokeJson(invoker, 'confluence_versions', { pageId: normalizeId(input.pageId) });
  const state = collectVersionState(response, page);
  return buildResult({
    operation,
    input,
    targets: [target('page', page)],
    facts: {
      currentVersion: state.currentVersion,
      historicalVersions: state.historicalVersions,
      historicalCount: state.historicalVersions.length,
    },
    summary: `Purge ${state.historicalVersions.length} versions from ${pageSummary(page)}?`,
    phrase: `PURGE ${state.historicalVersions.length} VERSIONS FROM ${input.pageId}`,
  });
}

async function runPreflight({ operation, input = {}, invokeJson: invoker }) {
  if (!OPERATION_HANDLERS[operation]) {
    throw makeError('OPERATION_NOT_ALLOWED', `Confluence operation "${operation}" is not allowed.`);
  }

  if (typeof invoker !== 'function') {
    throw makeError('INVALID_ARGUMENT', 'invokeJson must be a function.');
  }

  const normalizedInput = normalizeForOperation(operation, input);
  const handler = OPERATION_HANDLERS[operation];
  const result = await handler(invoker, normalizedInput);
  return Object.freeze({
    ...result,
    input: normalizedInput,
    inputHash: stableFingerprint({ operation, input: normalizedInput }),
    snapshotHash: stableFingerprint({ targets: result.targets, facts: result.facts }),
  });
}

module.exports = {
  runPreflight,
  stableFingerprint,
};
