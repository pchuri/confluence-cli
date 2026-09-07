const fs = require('fs');
const os = require('os');
const path = require('path');

// Some reverse-proxy/SSO gateways (e.g. F5 BIG-IP APM) require their own
// session cookie in addition to an application-level Bearer/Basic credential.
// These tests exercise the full non-interactive `initConfig` -> saveConfig ->
// getConfig round trip to make sure a `cookie` provided alongside a
// non-`cookie` authType is actually persisted and read back, not silently
// dropped.

describe('combining a cookie with bearer/basic auth (init -> save -> read)', () => {
  let tmpDir;
  let config;
  let errorSpy;
  let logSpy;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-cli-cookie-combo-'));
    process.env.CONFLUENCE_CONFIG_DIR = tmpDir;
    delete process.env.CONFLUENCE_DOMAIN;
    delete process.env.CONFLUENCE_API_TOKEN;
    delete process.env.CONFLUENCE_AUTH_TYPE;
    delete process.env.CONFLUENCE_COOKIE;
    delete process.env.CONFLUENCE_PROFILE;

    jest.resetModules();
    config = require('../lib/config');

    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
    delete process.env.CONFLUENCE_CONFIG_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('persists cookie alongside bearer auth via non-interactive CLI flags', async () => {
    await config.initConfig({
      domain: 'confluence.company.com',
      authType: 'bearer',
      token: 'my-pat',
      cookie: 'MRHSession=abc123',
      profile: 'combo',
    });

    const written = JSON.parse(fs.readFileSync(config.CONFIG_FILE, 'utf8'));
    expect(written.profiles.combo).toMatchObject({
      authType: 'bearer',
      token: 'my-pat',
      cookie: 'MRHSession=abc123',
    });

    const resolved = config.getConfig('combo');
    expect(resolved.authType).toBe('bearer');
    expect(resolved.token).toBe('my-pat');
    expect(resolved.cookie).toBe('MRHSession=abc123');
  });

  test('persists cookie alongside basic auth via non-interactive CLI flags', async () => {
    await config.initConfig({
      domain: 'confluence.company.com',
      authType: 'basic',
      email: 'user@example.com',
      token: 'my-password',
      cookie: 'MRHSession=abc123',
      profile: 'combo',
    });

    const written = JSON.parse(fs.readFileSync(config.CONFIG_FILE, 'utf8'));
    expect(written.profiles.combo).toMatchObject({
      authType: 'basic',
      email: 'user@example.com',
      token: 'my-password',
      cookie: 'MRHSession=abc123',
    });

    const resolved = config.getConfig('combo');
    expect(resolved.cookie).toBe('MRHSession=abc123');
  });

  test('does not persist a cookie field when none is provided (regression guard)', async () => {
    await config.initConfig({
      domain: 'confluence.company.com',
      authType: 'bearer',
      token: 'my-pat',
      profile: 'combo',
    });

    const written = JSON.parse(fs.readFileSync(config.CONFIG_FILE, 'utf8'));
    expect(written.profiles.combo.cookie).toBeUndefined();
  });

  test('empty --cookie is rejected for bearer auth instead of being silently ignored', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    await expect(config.initConfig({
      domain: 'confluence.company.com',
      authType: 'bearer',
      token: 'my-pat',
      cookie: '   ',
      profile: 'combo',
    })).rejects.toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/--cookie cannot be empty/));
    exitSpy.mockRestore();
  });

  test('--cookie is rejected when combined with --auth-type none instead of being silently persisted', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    await expect(config.initConfig({
      domain: 'confluence.company.com',
      authType: 'none',
      cookie: 'MRHSession=abc123',
      profile: 'combo',
    })).rejects.toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/--cookie cannot be combined with --auth-type "none"/));
    expect(fs.existsSync(config.CONFIG_FILE)).toBe(false);
    exitSpy.mockRestore();
  });
});
