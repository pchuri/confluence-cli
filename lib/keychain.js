const { spawnSync } = require('child_process');
const chalk = require('chalk');
const { isJsonMode } = require('./output');

// macOS Keychain storage for API tokens, driven by the built-in `security`
// CLI so no native dependency is needed. This is the same approach used by
// zalando/go-keyring (and therefore jira-cli).
//
// Items are stored as generic passwords under the service name
// `confluence-cli:<host>` with the account set to the basic-auth login, or
// the literal `bearer` when no login is used.
//
// Because the item is created by /usr/bin/security, the Keychain ACL trusts
// that binary, so later reads through `security` do not raise an access prompt
// regardless of which Node binary or CLI version performs the call.
//
// Token values are stored as `b64:` + base64(UTF-8) so that
// `find-generic-password -w` always sees printable ASCII and never falls back
// to its ambiguous hexadecimal output. Items written by hand (plain values)
// are read back as-is.
//
// Writes go through `security -i`, which reads whole commands from stdin, so
// the token never appears on argv (visible in `ps`) and the call behaves the
// same with or without a controlling terminal. (`security ... -w` with no
// value prompts on /dev/tty when one exists and ignores piped stdin.)

const SECURITY_BIN = '/usr/bin/security';
const SERVICE_PREFIX = 'confluence-cli:';
const BEARER_ACCOUNT = 'bearer';
const BASE64_PREFIX = 'b64:';
const SECURITY_TIMEOUT_MS = 30000;
const NOT_FOUND_STATUS = 44;
const DISABLE_VALUES = ['0', 'false', 'off', 'no'];

function isKeychainSupported({ platform = process.platform, env = process.env } = {}) {
  if (platform !== 'darwin') {
    return false;
  }
  const flag = String(env.CONFLUENCE_KEYCHAIN || '').trim().toLowerCase();
  return !DISABLE_VALUES.includes(flag);
}

function keychainService(host) {
  return `${SERVICE_PREFIX}${String(host || '').trim().toLowerCase()}`;
}

// Reject values that could break out of the `security -i` command line
// (newlines start a new command; other control characters are never legitimate
// in a host or login).
function assertSafeIdentifier(value, label) {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${label} contains control characters and cannot be used as a Keychain identifier.`);
  }
}

// Quote a value for the `security -i` tokenizer (double quotes, with `\` and
// `"` escaped), so spaces, leading dashes and quotes are passed through literally.
function quoteForSecurity(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function keychainAccount(login) {
  const trimmed = typeof login === 'string' ? login.trim() : '';
  return trimmed || BEARER_ACCOUNT;
}

function describeKeychainItem({ host, login }) {
  return `service "${keychainService(host)}", account "${keychainAccount(login)}"`;
}

function encodeToken(token) {
  return BASE64_PREFIX + Buffer.from(token, 'utf8').toString('base64');
}

function decodeToken(raw) {
  const value = String(raw).replace(/\r?\n$/, '');
  if (value.startsWith(BASE64_PREFIX)) {
    return Buffer.from(value.slice(BASE64_PREFIX.length), 'base64').toString('utf8');
  }
  return value;
}

function warn(message) {
  if (!isJsonMode()) {
    console.error(chalk.yellow(`⚠ ${message}`));
  }
}

function runSecurity(args, input) {
  return spawnSync(SECURITY_BIN, args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: SECURITY_TIMEOUT_MS,
  });
}

function isNotFound(result) {
  return result.status === NOT_FOUND_STATUS
    || /could not be found/i.test(result.stderr || '');
}

// Look up a token. Returns { token, attempted }: `attempted` is false when the
// Keychain is not available on this platform or was disabled; `token` is
// undefined when no matching item exists or the lookup failed (a warning is
// printed for failures other than "not found").
function getKeychainToken({ host, login } = {}) {
  if (!isKeychainSupported() || !host) {
    return { token: undefined, attempted: false };
  }

  const result = runSecurity([
    'find-generic-password',
    '-s', keychainService(host),
    '-a', keychainAccount(login),
    '-w',
  ]);

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      warn('macOS Keychain lookup timed out (is the keychain locked?). Falling back to other token sources.');
    } else {
      warn(`macOS Keychain lookup failed: ${result.error.message}`);
    }
    return { token: undefined, attempted: true };
  }

  if (result.status !== 0) {
    if (!isNotFound(result)) {
      warn(`macOS Keychain lookup failed (exit ${result.status}): ${(result.stderr || '').trim()}`);
    }
    return { token: undefined, attempted: true };
  }

  const token = decodeToken(result.stdout);
  return { token: token || undefined, attempted: true };
}

// Store (or replace) a token. The whole command, including the encoded value,
// is fed to `security -i` on stdin so nothing secret appears on argv.
function setKeychainToken({ host, login, token } = {}) {
  if (!isKeychainSupported()) {
    throw new Error('macOS Keychain storage is only available on macOS.');
  }
  if (!host) {
    throw new Error('A host is required to store a token in the macOS Keychain.');
  }
  if (typeof token !== 'string' || !token) {
    throw new Error('A non-empty token is required to store in the macOS Keychain.');
  }

  const service = keychainService(host);
  const account = keychainAccount(login);
  assertSafeIdentifier(service, 'Host');
  assertSafeIdentifier(account, 'Login');

  const command = [
    'add-generic-password',
    '-s', quoteForSecurity(service),
    '-a', quoteForSecurity(account),
    '-l', quoteForSecurity(`Confluence CLI (${String(host).trim().toLowerCase()})`),
    '-U',
    '-w', encodeToken(token),
  ].join(' ');
  const result = runSecurity(['-i'], `${command}\n`);

  if (result.error) {
    throw new Error(`Failed to store the token in the macOS Keychain: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Failed to store the token in the macOS Keychain (exit ${result.status}): ${(result.stderr || '').trim()}`);
  }

  // Read the item back to be sure the stored value is exactly what was requested.
  const verify = getKeychainToken({ host, login });
  if (verify.token !== token) {
    throw new Error('Stored the token in the macOS Keychain, but reading it back returned a different value.');
  }
}

// Remove a token. Returns true when an item was deleted, false when none existed.
function deleteKeychainToken({ host, login } = {}) {
  if (!isKeychainSupported() || !host) {
    return false;
  }

  const result = runSecurity([
    'delete-generic-password',
    '-s', keychainService(host),
    '-a', keychainAccount(login),
  ]);

  if (result.error) {
    throw new Error(`Failed to delete the token from the macOS Keychain: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (isNotFound(result)) {
      return false;
    }
    throw new Error(`Failed to delete the token from the macOS Keychain (exit ${result.status}): ${(result.stderr || '').trim()}`);
  }
  return true;
}

module.exports = {
  isKeychainSupported,
  keychainService,
  keychainAccount,
  describeKeychainItem,
  encodeToken,
  decodeToken,
  quoteForSecurity,
  getKeychainToken,
  setKeychainToken,
  deleteKeychainToken,
  SECURITY_BIN,
};
