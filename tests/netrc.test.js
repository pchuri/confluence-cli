const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseNetrc, lookupNetrc, getNetrcPath } = require('../lib/netrc');

describe('parseNetrc', () => {
  test('parses a single-line entry', () => {
    const entries = parseNetrc('machine example.atlassian.net login me@example.com password tok123');
    expect(entries).toEqual([
      { machine: 'example.atlassian.net', login: 'me@example.com', password: 'tok123' }
    ]);
  });

  test('parses a multi-line entry', () => {
    const data = [
      'machine example.atlassian.net',
      '  login me@example.com',
      '  password tok123',
    ].join('\n');
    expect(parseNetrc(data)).toEqual([
      { machine: 'example.atlassian.net', login: 'me@example.com', password: 'tok123' }
    ]);
  });

  test('parses multiple machines', () => {
    const data = [
      'machine one.example.com login a password p1',
      'machine two.example.com login b password p2',
    ].join('\n');
    expect(parseNetrc(data)).toEqual([
      { machine: 'one.example.com', login: 'a', password: 'p1' },
      { machine: 'two.example.com', login: 'b', password: 'p2' },
    ]);
  });

  test('parses double-quoted values containing whitespace', () => {
    const entries = parseNetrc('machine example.atlassian.net login "me@example.com" password "tok en 123"');
    expect(entries).toEqual([
      { machine: 'example.atlassian.net', login: 'me@example.com', password: 'tok en 123' }
    ]);
  });

  test('unescapes backslash sequences inside quoted values', () => {
    const entries = parseNetrc('machine host.example.com password "a\\"b"');
    expect(entries).toEqual([
      { machine: 'host.example.com', login: undefined, password: 'a"b' }
    ]);
  });

  test('records an entry without a login (bearer style)', () => {
    const entries = parseNetrc('machine pat.example.com password patToken');
    expect(entries).toEqual([
      { machine: 'pat.example.com', login: undefined, password: 'patToken' }
    ]);
  });

  test('skips macdef macro bodies', () => {
    const data = [
      'macdef init',
      '  put file1',
      '  put file2',
      '',
      'machine real.example.com login u password realpw',
    ].join('\n');
    expect(parseNetrc(data)).toEqual([
      { machine: 'real.example.com', login: 'u', password: 'realpw' }
    ]);
  });

  test('skips comment lines so a commented keyword cannot hijack an entry', () => {
    const data = [
      'machine real.example.com',
      '  # my machine token below',
      '  password pw',
    ].join('\n');
    expect(parseNetrc(data)).toEqual([
      { machine: 'real.example.com', login: undefined, password: 'pw' }
    ]);
  });

  test('ignores unknown tokens such as account and port', () => {
    const data = 'machine host.example.com login u account acct port 8443 password pw';
    expect(parseNetrc(data)).toEqual([
      { machine: 'host.example.com', login: 'u', password: 'pw' }
    ]);
  });

  test('records a default entry with a null host', () => {
    const entries = parseNetrc('default login anyone password fallbackpw');
    expect(entries).toEqual([
      { machine: null, login: 'anyone', password: 'fallbackpw' }
    ]);
  });
});

describe('getNetrcPath', () => {
  const saved = process.env.NETRC;
  afterEach(() => {
    if (saved === undefined) delete process.env.NETRC;
    else process.env.NETRC = saved;
  });

  test('honors the NETRC environment variable', () => {
    process.env.NETRC = '/custom/location/.netrc';
    expect(getNetrcPath()).toBe('/custom/location/.netrc');
  });

  test('defaults to a file in the home directory when NETRC is unset', () => {
    delete process.env.NETRC;
    const base = process.platform === 'win32' ? '_netrc' : '.netrc';
    expect(getNetrcPath()).toBe(path.join(os.homedir(), base));
  });
});

describe('lookupNetrc', () => {
  let tmpDir;
  let netrcFile;
  const savedNetrc = process.env.NETRC;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netrc-lookup-'));
    netrcFile = path.join(tmpDir, '.netrc');
    fs.writeFileSync(netrcFile, [
      'machine one.example.com login alice password secret1',
      'machine one.example.com login bob password secret2',
      'machine PAT.Example.COM password bearerToken',
    ].join('\n'));
    process.env.NETRC = netrcFile;
  });

  afterAll(() => {
    if (savedNetrc === undefined) delete process.env.NETRC;
    else process.env.NETRC = savedNetrc;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('matches by machine and login', () => {
    expect(lookupNetrc({ machine: 'one.example.com', login: 'bob' })).toEqual({
      machine: 'one.example.com', login: 'bob', password: 'secret2'
    });
  });

  test('matches by machine only when login is omitted (returns first entry)', () => {
    expect(lookupNetrc({ machine: 'one.example.com' })).toEqual({
      machine: 'one.example.com', login: 'alice', password: 'secret1'
    });
  });

  test('returns null when the login does not match', () => {
    expect(lookupNetrc({ machine: 'one.example.com', login: 'carol' })).toBeNull();
  });

  test('returns null for an unknown machine', () => {
    expect(lookupNetrc({ machine: 'nope.example.com', login: 'alice' })).toBeNull();
  });

  test('matches the host case-insensitively', () => {
    expect(lookupNetrc({ machine: 'pat.example.com' })).toEqual({
      machine: 'PAT.Example.COM', login: undefined, password: 'bearerToken'
    });
  });

  test('returns null when no machine is provided', () => {
    expect(lookupNetrc({})).toBeNull();
  });

  test('returns null when the file does not exist', () => {
    process.env.NETRC = path.join(tmpDir, 'does-not-exist');
    expect(lookupNetrc({ machine: 'one.example.com' })).toBeNull();
    process.env.NETRC = netrcFile;
  });
});

describe('getConfig netrc token fallback', () => {
  let tmpDir;
  let configDir;
  let netrcFile;
  const savedEnv = {};
  const ENV_KEYS = [
    'NETRC', 'CONFLUENCE_CONFIG_DIR',
    'CONFLUENCE_DOMAIN', 'CONFLUENCE_HOST',
    'CONFLUENCE_API_TOKEN', 'CONFLUENCE_PASSWORD',
    'CONFLUENCE_EMAIL', 'CONFLUENCE_USERNAME',
    'CONFLUENCE_AUTH_TYPE', 'CONFLUENCE_PROFILE',
  ];

  const writeConfig = (profiles, activeProfile = 'default') => {
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({ activeProfile, profiles }, null, 2)
    );
  };

  const writeNetrc = (contents) => {
    fs.writeFileSync(netrcFile, contents);
  };

  // Re-require config fresh so the cached CONFIG_DIR/CONFIG_FILE pick up
  // CONFLUENCE_CONFIG_DIR, then run getConfig.
  const loadConfig = () => {
    jest.resetModules();
    return require('../lib/config');
  };

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netrc-config-'));
    configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(configDir);
    netrcFile = path.join(tmpDir, '.netrc');
    process.env.CONFLUENCE_CONFIG_DIR = configDir;
    process.env.NETRC = netrcFile;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('fills a basic-auth token from netrc when the profile has none', () => {
    writeConfig({
      default: { domain: 'example.atlassian.net', authType: 'basic', email: 'me@example.com' }
    });
    writeNetrc('machine example.atlassian.net login me@example.com password netrcSecret');

    const { getConfig } = loadConfig();
    const config = getConfig();
    expect(config.token).toBe('netrcSecret');
    expect(config.authType).toBe('basic');
    expect(config.email).toBe('me@example.com');
  });

  test('fills a bearer token from netrc via machine-only match', () => {
    writeConfig({
      default: { domain: 'onprem.example.com', authType: 'bearer' }
    });
    writeNetrc('machine onprem.example.com password patToken');

    const { getConfig } = loadConfig();
    expect(getConfig().token).toBe('patToken');
  });

  test('fills a bearer token from netrc even when a stale email lingers in the profile', () => {
    writeConfig({
      default: { domain: 'onprem.example.com', authType: 'bearer', email: 'stale@example.com' }
    });
    writeNetrc('machine onprem.example.com password patToken');

    const { getConfig } = loadConfig();
    expect(getConfig().token).toBe('patToken');
  });

  test('preserves an on-prem context path while matching netrc by host', () => {
    writeConfig({
      default: { domain: 'wiki.example.com/confluence', authType: 'bearer' }
    });
    writeNetrc('machine wiki.example.com password patToken');

    const { getConfig } = loadConfig();
    const config = getConfig();
    expect(config.token).toBe('patToken');
    expect(config.domain).toBe('wiki.example.com/confluence');
    expect(config.apiPath).toBe('/rest/api');
  });

  test('a stored profile token takes precedence over netrc', () => {
    writeConfig({
      default: { domain: 'example.atlassian.net', authType: 'basic', email: 'me@example.com', token: 'storedToken' }
    });
    writeNetrc('machine example.atlassian.net login me@example.com password netrcSecret');

    const { getConfig } = loadConfig();
    expect(getConfig().token).toBe('storedToken');
  });

  test('does not consult netrc for a basic profile whose email does not match', () => {
    writeConfig({
      default: { domain: 'example.atlassian.net', authType: 'basic', email: 'me@example.com' }
    });
    writeNetrc('machine example.atlassian.net login someone-else@example.com password netrcSecret');

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit ${code}`);
    });
    const { getConfig } = loadConfig();
    expect(() => getConfig()).toThrow('process.exit 1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('does not use netrc for mTLS auth', () => {
    writeConfig({
      default: {
        domain: 'example.atlassian.net',
        authType: 'mtls',
        mtls: { clientCert: netrcFile, clientKey: netrcFile }
      }
    });
    writeNetrc('machine example.atlassian.net login me@example.com password netrcSecret');

    const { getConfig } = loadConfig();
    const config = getConfig();
    expect(config.authType).toBe('mtls');
    expect(config.token).toBeUndefined();
  });
});
