const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const READ_ONLY_COMMANDS = new Set([
  'read', 'search', 'info', 'spaces', 'children', 'export', 'convert',
]);
const REMOTE_OPERATIONS = new Set([
  'read', 'search', 'info', 'spaces', 'children', 'export',
]);
const CONFIG_ENV_KEYS = [
  'CONFLUENCE_DOMAIN',
  'CONFLUENCE_API_PATH',
  'CONFLUENCE_AUTH_TYPE',
  'CONFLUENCE_EMAIL',
  'CONFLUENCE_API_TOKEN',
  'CONFLUENCE_PROFILE',
  'CONFLUENCE_READ_ONLY',
  'CONFLUENCE_FORCE_CLOUD',
  'CONFLUENCE_LINK_STYLE',
  'NETRC',
  'HOME',
  'USERPROFILE',
  'XDG_CONFIG_HOME',
  'PATH',
  'NO_COLOR',
];

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

function buildCliEnvironment(env) {
  const result = {};
  for (const key of CONFIG_ENV_KEYS) {
    if (env[key] !== undefined) result[key] = env[key];
  }
  return result;
}

function redactText(text, env) {
  let redacted = String(text);
  for (const key of ['CONFLUENCE_API_TOKEN', 'CONFLUENCE_EMAIL']) {
    const value = env[key];
    if (typeof value === 'string' && value.length > 0) {
      redacted = redacted.split(value).join('[REDACTED]');
    }
  }
  return redacted;
}

function appendBounded(current, chunk, remaining) {
  if (remaining <= 0) return { text: current, written: 0, truncated: true };
  const text = chunk.toString('utf8');
  const bytes = Buffer.byteLength(text);
  if (bytes <= remaining) return { text: current + text, written: bytes, truncated: false };
  return {
    text: current + Buffer.from(text).subarray(0, remaining).toString('utf8'),
    written: remaining,
    truncated: true,
  };
}

function runReadOnlyCommand({
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
  const entryPoint = path.resolve(requireString(packageRoot, 'packageRoot'), 'bin/index.js');
  const childEnv = buildCliEnvironment(env);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const child = spawn(process.execPath, [entryPoint, ...args], {
      cwd: path.resolve(projectRoot),
      env: childEnv,
      shell: false,
    });

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const append = (stream, chunk) => {
      const result = appendBounded(stream === 'stdout' ? stdout : stderr, chunk, maxOutputBytes - outputBytes);
      outputBytes += result.written;
      truncated ||= result.truncated;
      if (stream === 'stdout') stdout = result.text;
      else stderr = result.text;
      if (truncated && !child.killed) child.kill('SIGTERM');
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.on('error', (error) => finish(() => reject(new Error(redactText(`Confluence CLI failed to start: ${error.message}`, env)))));
    child.on('close', (code) => finish(() => {
      const boundedStdout = truncated ? `${stdout}\n[output truncated]\n` : stdout;
      const boundedStderr = truncated ? `${stderr}\n[output truncated]\n` : stderr;
      if (timedOut) {
        reject(new Error(redactText(`Confluence CLI timed out after ${timeoutMs}ms.`, env)));
        return;
      }
      if (code !== 0 && !truncated) {
        reject(new Error(redactText(`Confluence CLI failed (exit ${code}): ${boundedStderr}`, env)));
        return;
      }
      resolve({
        stdout: redactText(boundedStdout, env),
        stderr: redactText(boundedStderr, env),
        truncated,
      });
    }));
  });
}

module.exports = {
  READ_ONLY_COMMANDS,
  resolveProjectPath,
  buildArgs,
  redactText,
  runReadOnlyCommand,
};
