'use strict';

const chalk = require('chalk');

let jsonMode = false;

function setJsonMode(enabled) {
  jsonMode = Boolean(enabled);
}

function isJsonMode() {
  return jsonMode;
}

// Single place JSON output is produced, so piping to tools like jq stays clean:
// pretty-printed, no colors, no human-readable preamble. Uses console.log (not
// process.stdout.write) so it lands on stdout and stays test-spy friendly.
function emitJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

// Network-level error codes (from Node/axios) that mean the request never got a
// response — connection refused, DNS failure, timeouts, etc.
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET',
  'ECONNABORTED', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH',
]);

// Map an error onto a small, stable machine code so agents/scripts can branch on
// failures without parsing prose. Kept intentionally coarse — it only draws the
// distinctions the existing human-readable messages already make.
function classifyErrorCode(error) {
  const status = error?.response?.status;
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status === 404) return 'NOT_FOUND';
  if (typeof status === 'number' && status >= 400) return 'API_ERROR';
  if (error?.code && NETWORK_ERROR_CODES.has(error.code)) return 'NETWORK';
  // A thrown Error that never reached the server (validation, bad args, missing
  // files) — the client raises these with `new Error(...)` and no `.response`.
  if (error instanceof Error) return 'VALIDATION';
  return 'UNKNOWN';
}

// Emit exactly one machine-parseable JSON error object on stderr (keeping stdout
// reserved for data). Shape: { error, code, status, details }. `overrides` lets
// synthetic call sites (arg validation, tooling failures) supply an explicit
// message/code/status/details without constructing a fake HTTP error.
function emitJsonError(error, overrides = {}) {
  const status = 'status' in overrides
    ? overrides.status
    : (error?.response?.status ?? null);
  const details = 'details' in overrides
    ? overrides.details
    : (error?.response?.data ?? null);
  const payload = {
    error: overrides.message ?? error?.message ?? String(error),
    code: overrides.code ?? classifyErrorCode(error),
    status: status ?? null,
    details: details ?? null,
  };
  console.error(JSON.stringify(payload, null, 2));
}

let deprecationWarned = false;

// Resolve whether a command should emit JSON.
//   - `globalJson` is the value of the global `--json` flag (the canonical form).
//   - The per-command `--format json` form still works but is deprecated: it
//     prints a one-time warning to stderr (never stdout, so piped JSON stays
//     parseable) and is honored for backward compatibility.
function jsonRequested(globalJson, options = {}) {
  if (globalJson) {
    return true;
  }
  const format = typeof options.format === 'string' ? options.format.toLowerCase() : '';
  if (format === 'json') {
    if (!deprecationWarned) {
      deprecationWarned = true;
      console.error(chalk.yellow(
        'Warning: "--format json" is deprecated and will be removed in a future major version. Use the global "--json" flag instead.'
      ));
    }
    return true;
  }
  return false;
}

module.exports = {
  emitJson,
  emitJsonError,
  classifyErrorCode,
  jsonRequested,
  setJsonMode,
  isJsonMode,
};
