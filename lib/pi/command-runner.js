const { spawn } = require('child_process');
const path = require('path');

const ERROR_CODES = Object.freeze({
  ABORTED: 'ABORTED',
  INVALID_JSON: 'INVALID_JSON',
  OUTPUT_TRUNCATED: 'OUTPUT_TRUNCATED',
  SPAWN_FAILED: 'SPAWN_FAILED',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN_RESULT: 'UNKNOWN_RESULT',
  CLI_FAILED: 'CLI_FAILED',
});

const CONFIG_ENV_KEYS = Object.freeze([
  'CONFLUENCE_DOMAIN',
  'CONFLUENCE_HOST',
  'CONFLUENCE_CONFIG_DIR',
  'CONFLUENCE_API_PATH',
  'CONFLUENCE_PROTOCOL',
  'CONFLUENCE_AUTH_TYPE',
  'CONFLUENCE_EMAIL',
  'CONFLUENCE_USERNAME',
  'CONFLUENCE_API_TOKEN',
  'CONFLUENCE_PASSWORD',
  'CONFLUENCE_PROFILE',
  'CONFLUENCE_READ_ONLY',
  'CONFLUENCE_FORCE_CLOUD',
  'CONFLUENCE_LINK_STYLE',
  'CONFLUENCE_COOKIE',
  'CONFLUENCE_TLS_CA_CERT',
  'CONFLUENCE_TLS_CLIENT_CERT',
  'CONFLUENCE_TLS_CLIENT_KEY',
  'NETRC',
  'HOME',
  'USERPROFILE',
  'XDG_CONFIG_HOME',
  'PATH',
  'NO_COLOR',
]);

const TERMINATION_GRACE_MS = 250;

class ConfluencePiError extends Error {
  constructor(message, { code = ERROR_CODES.CLI_FAILED, cause, unknownResult = false, stdout, stderr, truncated = false } = {}) {
    super(message);
    this.name = 'ConfluencePiError';
    this.code = code;
    this.unknownResult = unknownResult;
    this.stdout = stdout;
    this.stderr = stderr;
    this.truncated = truncated;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function buildCliEnvironment(env = process.env) {
  const result = {};
  for (const key of CONFIG_ENV_KEYS) {
    if (env && env[key] !== undefined) {
      result[key] = env[key];
    }
  }
  return result;
}

function redactText(text, env = process.env) {
  let redacted = String(text);
  for (const key of [
    'CONFLUENCE_API_TOKEN',
    'CONFLUENCE_PASSWORD',
    'CONFLUENCE_EMAIL',
    'CONFLUENCE_USERNAME',
    'CONFLUENCE_COOKIE',
    'CONFLUENCE_TLS_CLIENT_KEY',
  ]) {
    const value = env && env[key];
    if (typeof value === 'string' && value.length > 0) {
      redacted = redacted.split(value).join('[REDACTED]');
    }
  }
  return redacted;
}

function appendBounded(current, chunk, remaining) {
  if (remaining <= 0) {
    return { text: current, written: 0, truncated: true };
  }

  const text = chunk.toString('utf8');
  const bytes = Buffer.byteLength(text);
  if (bytes <= remaining) {
    return { text: current + text, written: bytes, truncated: false };
  }

  return {
    text: current + Buffer.from(text).subarray(0, remaining).toString('utf8'),
    written: remaining,
    truncated: true,
  };
}

function runCommand({
  packageRoot,
  projectRoot,
  args = [],
  env = process.env,
  signal,
  timeoutMs = 30_000,
  maxOutputBytes = 48 * 1024,
  expectJson = false,
  mutation = false,
}) {
  const entryPoint = path.resolve(requireString(packageRoot, 'packageRoot'), 'bin/index.js');
  const cwd = path.resolve(requireString(projectRoot, 'projectRoot'));
  const childEnv = buildCliEnvironment(env);
  const argv = Array.isArray(args) ? args.map((arg) => String(arg)) : [];
  const outputLimit = Number.isFinite(maxOutputBytes) && maxOutputBytes >= 0 ? maxOutputBytes : 0;
  const timeoutLimit = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 0;

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let truncated = false;
    let settled = false;
    let aborted = false;
    let timedOut = false;
    let child;
    let timeoutTimer = null;
    let escalationTimer = null;
    let sigtermRequested = false;
    let sigkillRequested = false;
    let terminationReason = null;

    const cleanup = () => {
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      if (escalationTimer !== null) clearTimeout(escalationTimer);
      if (signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const makeError = (code, message, extra = {}) => new ConfluencePiError(redactText(message, env), {
      code,
      ...extra,
      stdout: redactText(stdout, env),
      stderr: redactText(stderr, env),
      truncated,
    });

    const settleResolve = (value) => finish(() => resolve(value));
    const settleReject = (error) => finish(() => reject(error));

    const sendSigkill = () => {
      escalationTimer = null;
      if (settled || !child || sigkillRequested) return;
      if (child.exitCode !== null || child.signalCode !== null) return;
      sigkillRequested = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore kill races; close() will settle if the child already exited.
      }
    };

    const requestTermination = (reason) => {
      if (!child || sigtermRequested) return;
      sigtermRequested = true;
      terminationReason = terminationReason || reason;
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore kill races; close() will settle if the child already exited.
      }
      if (escalationTimer === null) {
        escalationTimer = setTimeout(sendSigkill, TERMINATION_GRACE_MS);
      }
    };

    const onAbort = () => {
      aborted = true;
      requestTermination('abort');
    };

    if (signal && signal.aborted) {
      settleReject(makeError(ERROR_CODES.ABORTED, 'Confluence CLI run aborted.'));
      return;
    }

    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    if (timeoutLimit > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        requestTermination('timeout');
      }, timeoutLimit);
    }

    try {
      child = spawn(process.execPath, [entryPoint, ...argv], {
        cwd,
        env: childEnv,
        shell: false,
      });
    } catch (error) {
      settleReject(makeError(ERROR_CODES.SPAWN_FAILED, `Confluence CLI failed to start: ${error.message}`, { cause: error }));
      return;
    }

    child.stdout.on('data', (chunk) => {
      const result = appendBounded(stdout, chunk, outputLimit - outputBytes);
      outputBytes += result.written;
      truncated ||= result.truncated;
      stdout = result.text;
      if (result.truncated) {
        terminationReason = terminationReason || 'output-limit';
        requestTermination('output-limit');
      }
    });

    child.stderr.on('data', (chunk) => {
      const result = appendBounded(stderr, chunk, outputLimit - outputBytes);
      outputBytes += result.written;
      truncated ||= result.truncated;
      stderr = result.text;
      if (result.truncated) {
        terminationReason = terminationReason || 'output-limit';
        requestTermination('output-limit');
      }
    });

    child.on('error', (error) => {
      settleReject(makeError(ERROR_CODES.SPAWN_FAILED, `Confluence CLI failed to start: ${error.message}`, { cause: error }));
    });

    child.on('close', (code, signalCode) => {
      if (aborted) {
        settleReject(makeError(ERROR_CODES.ABORTED, 'Confluence CLI run aborted.'));
        return;
      }
      if (timedOut) {
        settleReject(makeError(ERROR_CODES.TIMEOUT, `Confluence CLI timed out after ${timeoutLimit}ms.`));
        return;
      }
      if (code !== null && code !== 0) {
        settleReject(makeError(ERROR_CODES.CLI_FAILED, `Confluence CLI failed (exit ${code}): ${stderr}`));
        return;
      }
      if (signalCode && terminationReason === null) {
        settleReject(makeError(ERROR_CODES.CLI_FAILED, `Confluence CLI failed (signal ${signalCode}): ${stderr}`));
        return;
      }
      if (truncated) {
        if (mutation) {
          settleReject(makeError(ERROR_CODES.UNKNOWN_RESULT, 'Confluence CLI mutation result is unknown because output was truncated.', {
            unknownResult: true,
          }));
          return;
        }
        if (expectJson) {
          settleReject(makeError(ERROR_CODES.OUTPUT_TRUNCATED, 'Confluence CLI output was truncated before valid JSON could be read.'));
          return;
        }
        settleResolve({
          stdout: redactText(stdout, env),
          stderr: redactText(stderr, env),
          truncated: true,
          json: undefined,
        });
        return;
      }
      if (expectJson) {
        try {
          const json = JSON.parse(stdout);
          settleResolve({
            stdout: redactText(stdout, env),
            stderr: redactText(stderr, env),
            truncated: false,
            json,
          });
        } catch (error) {
          settleReject(makeError(ERROR_CODES.INVALID_JSON, `Confluence CLI returned invalid JSON: ${error.message}`, { cause: error }));
        }
        return;
      }
      settleResolve({
        stdout: redactText(stdout, env),
        stderr: redactText(stderr, env),
        truncated: false,
        json: undefined,
      });
    });
  });
}

module.exports = {
  ERROR_CODES,
  CONFIG_ENV_KEYS,
  ConfluencePiError,
  buildCliEnvironment,
  redactText,
  runCommand,
};
