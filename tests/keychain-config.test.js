const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../lib/keychain', () => {
  const actual = jest.requireActual('../lib/keychain');
  return {
    ...actual,
    isKeychainSupported: jest.fn(() => true),
    getKeychainToken: jest.fn(() => ({ token: undefined, attempted: true })),
    setKeychainToken: jest.fn(() => ({ replaced: false })),
  };
});

const keychain = require('../lib/keychain');

const ENV_KEYS = [
  'CONFLUENCE_DOMAIN', 'CONFLUENCE_HOST', 'CONFLUENCE_API_TOKEN', 'CONFLUENCE_PASSWORD',
  'CONFLUENCE_EMAIL', 'CONFLUENCE_USERNAME', 'CONFLUENCE_AUTH_TYPE', 'CONFLUENCE_PROFILE',
  'CONFLUENCE_CONFIG_DIR', 'NETRC', 'CONFLUENCE_KEYCHAIN',
];

function loadConfigModule(configDir) {
  process.env.CONFLUENCE_CONFIG_DIR = configDir;
  jest.resetModules();
  jest.doMock('../lib/keychain', () => keychain);
  return require('../lib/config');
}

function writeProfiles(configDir, profiles, activeProfile = 'default') {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ activeProfile, profiles }, null, 2));
}

describe('macOS Keychain token fallback in getConfig', () => {
  const saved = {};
  let configDir;
  let logSpy;
  let errSpy;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-keychain-'));
    // Point NETRC at a non-existent file so the host machine's ~/.netrc never interferes.
    process.env.NETRC = path.join(configDir, 'no-netrc');
    keychain.getKeychainToken.mockReset().mockReturnValue({ token: undefined, attempted: true });
    keychain.setKeychainToken.mockReset().mockReturnValue({ replaced: false });
    keychain.isKeychainSupported.mockReset().mockReturnValue(true);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    fs.rmSync(configDir, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      if (saved[key] !== undefined) process.env[key] = saved[key];
      else delete process.env[key];
    }
  });

  test('uses the Keychain token when the profile has none (basic auth matches by email)', () => {
    writeProfiles(configDir, {
      default: { domain: 'wiki.example.com', apiPath: '/rest/api', authType: 'basic', email: 'me@example.com' },
    });
    keychain.getKeychainToken.mockReturnValue({ token: 'kc-token', attempted: true });
    const { getConfig } = loadConfigModule(configDir);

    const config = getConfig(undefined, { throwOnError: true });

    expect(config.token).toBe('kc-token');
    expect(keychain.getKeychainToken).toHaveBeenCalledWith({ host: 'wiki.example.com', login: 'me@example.com' });
  });

  test('bearer profiles look up the Keychain without a login', () => {
    writeProfiles(configDir, {
      default: { domain: 'https://wiki.example.com', apiPath: '/rest/api', authType: 'bearer' },
    });
    keychain.getKeychainToken.mockReturnValue({ token: 'pat', attempted: true });
    const { getConfig } = loadConfigModule(configDir);

    expect(getConfig(undefined, { throwOnError: true }).token).toBe('pat');
    expect(keychain.getKeychainToken).toHaveBeenCalledWith({ host: 'wiki.example.com', login: undefined });
  });

  test('a token stored in config.json wins over the Keychain', () => {
    writeProfiles(configDir, {
      default: { domain: 'wiki.example.com', apiPath: '/rest/api', authType: 'bearer', token: 'file-token' },
    });
    const { getConfig } = loadConfigModule(configDir);

    expect(getConfig(undefined, { throwOnError: true }).token).toBe('file-token');
    expect(keychain.getKeychainToken).not.toHaveBeenCalled();
  });

  test('falls back to .netrc when the Keychain has no item', () => {
    writeProfiles(configDir, {
      default: { domain: 'wiki.example.com', apiPath: '/rest/api', authType: 'bearer' },
    });
    fs.writeFileSync(process.env.NETRC, 'machine wiki.example.com password netrc-token\n');
    const { getConfig } = loadConfigModule(configDir);

    expect(getConfig(undefined, { throwOnError: true }).token).toBe('netrc-token');
    expect(keychain.getKeychainToken).toHaveBeenCalledTimes(1);
  });

  test('does not consult the Keychain for cookie/mtls/none auth', () => {
    writeProfiles(configDir, {
      default: { domain: 'wiki.example.com', apiPath: '/rest/api', authType: 'cookie', cookie: 'JSESSIONID=abc' },
    });
    const { getConfig } = loadConfigModule(configDir);

    getConfig(undefined, { throwOnError: true });
    expect(keychain.getKeychainToken).not.toHaveBeenCalled();
  });

  test('direct env config never touches the Keychain', () => {
    process.env.CONFLUENCE_DOMAIN = 'env.example.com';
    process.env.CONFLUENCE_API_TOKEN = 'env-token';
    const { getConfig } = loadConfigModule(configDir);

    expect(getConfig().token).toBe('env-token');
    expect(keychain.getKeychainToken).not.toHaveBeenCalled();
  });
});

describe('confluence init --keychain', () => {
  const saved = {};
  let configDir;
  let logSpy;
  let errSpy;
  let exitSpy;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-keychain-init-'));
    keychain.getKeychainToken.mockReset();
    keychain.setKeychainToken.mockReset().mockReturnValue({ replaced: false });
    keychain.isKeychainSupported.mockReset().mockReturnValue(true);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    fs.rmSync(configDir, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      if (saved[key] !== undefined) process.env[key] = saved[key];
      else delete process.env[key];
    }
  });

  test('stores the token in the Keychain and omits it from config.json', async () => {
    const { initConfig } = loadConfigModule(configDir);

    await initConfig({
      domain: 'wiki.example.com',
      apiPath: '/rest/api',
      authType: 'basic',
      email: 'me@example.com',
      token: 'secret-token',
      keychain: true,
    });

    expect(keychain.setKeychainToken).toHaveBeenCalledWith({
      host: 'wiki.example.com',
      login: 'me@example.com',
      token: 'secret-token',
    });
    const written = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
    expect(written.profiles.default.token).toBeUndefined();
    expect(written.profiles.default.email).toBe('me@example.com');
    expect(JSON.stringify(written)).not.toContain('secret-token');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('macOS Keychain'));
  });

  test('replaces a previously stored plaintext token when re-run with --keychain', async () => {
    writeProfiles(configDir, {
      default: { domain: 'wiki.example.com', apiPath: '/rest/api', authType: 'bearer', token: 'old-plain' },
    });
    const { initConfig } = loadConfigModule(configDir);

    await initConfig({ domain: 'wiki.example.com', authType: 'bearer', token: 'new-secret', keychain: true });

    expect(keychain.setKeychainToken).toHaveBeenCalledWith({ host: 'wiki.example.com', login: undefined, token: 'new-secret' });
    const written = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
    expect(written.profiles.default.token).toBeUndefined();
  });

  test('without --keychain the token is written to config.json as before', async () => {
    const { initConfig } = loadConfigModule(configDir);

    await initConfig({ domain: 'wiki.example.com', authType: 'bearer', token: 'plain' });

    expect(keychain.setKeychainToken).not.toHaveBeenCalled();
    const written = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
    expect(written.profiles.default.token).toBe('plain');
  });

  test('rejects --keychain when the Keychain is unavailable', async () => {
    keychain.isKeychainSupported.mockReturnValue(false);
    const { initConfig } = loadConfigModule(configDir);

    await expect(initConfig({ domain: 'wiki.example.com', authType: 'bearer', token: 'x', keychain: true }))
      .rejects.toThrow('process.exit(1)');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('--keychain'));
    expect(keychain.setKeychainToken).not.toHaveBeenCalled();
  });

  test('rejects --keychain for auth types without a token', async () => {
    const { initConfig } = loadConfigModule(configDir);

    await expect(initConfig({ domain: 'wiki.example.com', authType: 'cookie', cookie: 'a=b', keychain: true }))
      .rejects.toThrow('process.exit(1)');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('basic or bearer'));
  });

  test('surfaces a Keychain write failure instead of silently saving', async () => {
    keychain.setKeychainToken.mockImplementation(() => {
      throw new Error('Failed to store the token in the macOS Keychain (exit 36): User interaction is not allowed.');
    });
    const { initConfig } = loadConfigModule(configDir);

    await expect(initConfig({ domain: 'wiki.example.com', authType: 'bearer', token: 'x', keychain: true }))
      .rejects.toThrow('process.exit(1)');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('User interaction is not allowed'));
    expect(fs.existsSync(path.join(configDir, 'config.json'))).toBe(false);
  });
});
