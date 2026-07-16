const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');

// Minimal reader for GNU .netrc files
// (https://www.gnu.org/software/inetutils/manual/html_node/The-_002enetrc-file.html).
// netrc supplies only the token/password; the machine (host) and login come from
// the CLI's own configuration.

// Resolve the .netrc path: $NETRC if set, else ~/.netrc (~/_netrc on Windows).
function getNetrcPath() {
  if (process.env.NETRC) {
    return process.env.NETRC;
  }
  const base = process.platform === 'win32' ? '_netrc' : '.netrc';
  return path.join(os.homedir(), base);
}

function tokenizeLine(line) {
  const tokens = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    tokens.push(match[1] !== undefined ? match[1].replace(/\\(.)/g, '$1') : match[2]);
  }
  return tokens;
}

// Parse .netrc contents into an array of { machine, login, password } entries.
// A new entry starts at each `machine` (or `default`) token; `macdef` macro
// bodies are skipped up to the next blank line; comment lines and unknown
// tokens are ignored.
function parseNetrc(data) {
  const entries = [];
  let current = null;
  let inMacro = false;

  for (const line of data.split('\n')) {
    if (inMacro) {
      // A macro body runs until the first empty line.
      if (line.trim() === '') {
        inMacro = false;
      }
      continue;
    }

    if (line.trimStart().startsWith('#')) {
      continue;
    }

    const fields = tokenizeLine(line);
    for (let i = 0; i < fields.length; i++) {
      const token = fields[i];
      switch (token) {
      case 'machine':
        current = { machine: fields[++i], login: undefined, password: undefined };
        entries.push(current);
        break;
      case 'default':
        // Applies to any machine; recorded with a null host so host matching
        // never selects it (no default fallback).
        current = { machine: null, login: undefined, password: undefined };
        entries.push(current);
        break;
      case 'macdef':
        inMacro = true;
        i = fields.length;
        break;
      case 'login':
        if (current) current.login = fields[++i];
        break;
      case 'password':
        if (current) current.password = fields[++i];
        break;
      default:
        // Ignore account, port, and any other unrecognized tokens (and their value).
        i++;
        break;
      }
    }
  }

  return entries;
}

// Read ~/.netrc and return the first entry matching `machine` (host, compared
// case-insensitively) and, when `login` is provided, `login`. Returns null when
// the file is absent or no entry matches. Other read errors emit a warning.
function lookupNetrc({ machine, login } = {}) {
  const host = (machine || '').trim().toLowerCase();
  if (!host) {
    return null;
  }

  const filePath = getNetrcPath();
  let data;
  try {
    data = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    console.error(chalk.yellow(`⚠ Failed to read netrc file at ${filePath}: ${error.message}`));
    return null;
  }

  const entries = parseNetrc(data);
  const match = entries.find((entry) =>
    entry.machine
    && entry.machine.toLowerCase() === host
    && (login == null || entry.login === login)
  );

  if (!match) {
    return null;
  }

  return { machine: match.machine, login: match.login, password: match.password };
}

module.exports = { getNetrcPath, parseNetrc, lookupNetrc };
