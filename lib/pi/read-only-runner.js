const fs = require('fs');
const path = require('path');

const { ConfluencePiError, redactText, runCommand } = require('./command-runner');

const READ_ONLY_COMMANDS = new Set([
  'read', 'search', 'info', 'spaces', 'children', 'export', 'convert',
]);
const REMOTE_OPERATIONS = new Set([
  'read', 'search', 'info', 'spaces', 'children', 'export',
]);

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function resolveProjectPath(projectRoot, candidatePath) {
  const root = path.resolve(requireString(projectRoot, 'projectRoot'));
  const resolved = path.resolve(root, requireString(candidatePath, 'path'));
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Path must stay inside the current project directory.');
  }
  return resolved;
}

function optionalFlag(args, enabled, flag) {
  if (enabled) args.push(flag);
}

function optionalValue(args, value, flag) {
  if (value !== undefined) args.push(flag, String(value));
}

function safeExportFile(value) {
  if (value === undefined) return undefined;
  const filename = requireString(value, 'file');
  if (path.basename(filename) !== filename) {
    throw new Error('Export file must be a filename without directory components.');
  }
  return filename;
}

function buildArgs(operation, input, projectRoot) {
  if (!READ_ONLY_COMMANDS.has(operation)) {
    throw new Error(`Confluence operation "${operation}" is not allowed.`);
  }

  const params = input || {};
  switch (operation) {
  case 'read':
    return ['read', requireString(params.pageId, 'pageId'), '--format', params.format || 'text'];
  case 'search': {
    const args = ['search', requireString(params.query, 'query'), '--limit', String(params.limit ?? 10), '--start', String(params.start ?? 0)];
    optionalFlag(args, params.cql, '--cql');
    return args;
  }
  case 'info':
    return ['info', requireString(params.pageId, 'pageId')];
  case 'spaces':
    return ['spaces', '--limit', String(params.limit ?? 500)];
  case 'children': {
    const args = ['children', requireString(params.pageId, 'pageId')];
    optionalFlag(args, params.recursive, '--recursive');
    optionalValue(args, params.maxDepth, '--max-depth');
    optionalValue(args, params.type, '--type');
    optionalValue(args, params.format, '--format');
    optionalFlag(args, params.showUrl, '--show-url');
    optionalFlag(args, params.showId, '--show-id');
    return args;
  }
  case 'export': {
    const args = [
      'export', requireString(params.pageId, 'pageId'),
      '--dest', resolveProjectPath(projectRoot, params.destination),
      '--format', params.format || 'markdown',
      '--skip-attachments',
    ];
    optionalValue(args, safeExportFile(params.file), '--file');
    optionalFlag(args, params.recursive, '--recursive');
    optionalValue(args, params.maxDepth, '--max-depth');
    optionalFlag(args, params.dryRun, '--dry-run');
    optionalFlag(args, params.referencedOnly, '--referenced-only');
    return args;
  }
  case 'convert': {
    const args = [
      'convert',
      '--input-file', resolveProjectPath(projectRoot, params.inputFile),
    ];
    if (params.outputFile !== undefined) {
      args.push('--output-file', resolveProjectPath(projectRoot, params.outputFile));
    }
    args.push(
      '--input-format', requireString(params.inputFormat, 'inputFormat'),
      '--output-format', requireString(params.outputFormat, 'outputFormat'),
    );
    return args;
  }
  default:
    throw new Error(`Confluence operation "${operation}" is not allowed.`);
  }
}

function hasStoredProfile(env) {
  const home = env.HOME || env.USERPROFILE;
  if (!home) return false;
  const configRoot = env.XDG_CONFIG_HOME || path.join(home, '.confluence-cli');
  return fs.existsSync(path.join(configRoot, 'config.json'));
}

function hasConfiguration(env) {
  return Boolean(
    (env.CONFLUENCE_DOMAIN && env.CONFLUENCE_API_TOKEN)
    || env.CONFLUENCE_PROFILE
    || hasStoredProfile(env),
  );
}

async function runReadOnlyCommand({
  packageRoot,
  projectRoot,
  operation,
  input,
  env = process.env,
  timeoutMs = 30_000,
  maxOutputBytes = 48 * 1024,
}) {
  if (REMOTE_OPERATIONS.has(operation) && !hasConfiguration(env)) {
    return Promise.reject(new Error('Confluence configuration is required for remote operations.'));
  }

  const args = buildArgs(operation, input, projectRoot);

  try {
    const result = await runCommand({
      packageRoot,
      projectRoot,
      args,
      env,
      timeoutMs,
      maxOutputBytes,
      expectJson: false,
      mutation: false,
    });

    return {
      stdout: result.truncated ? `${result.stdout}\n[output truncated]\n` : result.stdout,
      stderr: result.truncated ? `${result.stderr}\n[output truncated]\n` : result.stderr,
      truncated: result.truncated,
    };
  } catch (error) {
    if (error instanceof ConfluencePiError) {
      throw new Error(error.message);
    }
    throw error;
  }
}

module.exports = {
  READ_ONLY_COMMANDS,
  resolveProjectPath,
  buildArgs,
  redactText,
  runReadOnlyCommand,
};
