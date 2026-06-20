'use strict';

const chalk = require('chalk');

// Single place JSON output is produced, so piping to tools like jq stays clean:
// pretty-printed, no colors, no human-readable preamble. Uses console.log (not
// process.stdout.write) so it lands on stdout and stays test-spy friendly.
function emitJson(data) {
  console.log(JSON.stringify(data, null, 2));
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

module.exports = { emitJson, jsonRequested };
