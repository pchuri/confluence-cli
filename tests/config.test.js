const { getConfig } = require('../lib/config');

// Save and restore all relevant env vars around each test
const ENV_KEYS = [
  'CONFLUENCE_DOMAIN', 'CONFLUENCE_HOST',
  'CONFLUENCE_API_TOKEN', 'CONFLUENCE_PASSWORD',
  'CONFLUENCE_EMAIL', 'CONFLUENCE_USERNAME',
  'CONFLUENCE_AUTH_TYPE', 'CONFLUENCE_API_PATH',
  'CONFLUENCE_PROTOCOL', 'CONFLUENCE_FORCE_CLOUD',
  'CONFLUENCE_COOKIE'
];

describe('getConfig env var aliases', () => {
  const saved = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key];
      } else {
        delete process.env[key];
      }
    }
  });

  test('CONFLUENCE_USERNAME is used when CONFLUENCE_EMAIL is not set', () => {
    process.env.CONFLUENCE_DOMAIN = 'on-prem.example.com';
    process.env.CONFLUENCE_PASSWORD = 'secret';
    process.env.CONFLUENCE_USERNAME = 'admin';
    process.env.CONFLUENCE_AUTH_TYPE = 'basic';

    const config = getConfig();
    expect(config.email).toBe('admin');
    expect(config.token).toBe('secret');
  });

  test('CONFLUENCE_EMAIL takes priority over CONFLUENCE_USERNAME', () => {
    process.env.CONFLUENCE_DOMAIN = 'cloud.atlassian.net';
    process.env.CONFLUENCE_API_TOKEN = 'api-token';
    process.env.CONFLUENCE_EMAIL = 'user@example.com';
    process.env.CONFLUENCE_USERNAME = 'admin';
    process.env.CONFLUENCE_AUTH_TYPE = 'basic';

    const config = getConfig();
    expect(config.email).toBe('user@example.com');
  });

  test('CONFLUENCE_PASSWORD is used when CONFLUENCE_API_TOKEN is not set', () => {
    process.env.CONFLUENCE_DOMAIN = 'on-prem.example.com';
    process.env.CONFLUENCE_PASSWORD = 'my-password';
    process.env.CONFLUENCE_USERNAME = 'admin';
    process.env.CONFLUENCE_AUTH_TYPE = 'basic';

    const config = getConfig();
    expect(config.token).toBe('my-password');
  });

  test('CONFLUENCE_API_TOKEN takes priority over CONFLUENCE_PASSWORD', () => {
    process.env.CONFLUENCE_DOMAIN = 'cloud.atlassian.net';
    process.env.CONFLUENCE_API_TOKEN = 'api-token';
    process.env.CONFLUENCE_PASSWORD = 'password';

    const config = getConfig();
    expect(config.token).toBe('api-token');
  });

  test('CONFLUENCE_HOST alias still works for domain', () => {
    process.env.CONFLUENCE_HOST = 'host.example.com';
    process.env.CONFLUENCE_API_TOKEN = 'token';

    const config = getConfig();
    expect(config.domain).toBe('host.example.com');
  });

  test('protocol defaults to https when CONFLUENCE_PROTOCOL is not set', () => {
    process.env.CONFLUENCE_DOMAIN = 'example.com';
    process.env.CONFLUENCE_API_TOKEN = 'token';

    const config = getConfig();
    expect(config.protocol).toBe('https');
  });

  test('CONFLUENCE_PROTOCOL=http is respected', () => {
    process.env.CONFLUENCE_DOMAIN = 'example.com';
    process.env.CONFLUENCE_API_TOKEN = 'token';
    process.env.CONFLUENCE_PROTOCOL = 'http';

    const config = getConfig();
    expect(config.protocol).toBe('http');
  });

  test('CONFLUENCE_PROTOCOL invalid value defaults to https', () => {
    process.env.CONFLUENCE_DOMAIN = 'example.com';
    process.env.CONFLUENCE_API_TOKEN = 'token';
    process.env.CONFLUENCE_PROTOCOL = 'ftp';

    const config = getConfig();
    expect(config.protocol).toBe('https');
  });

  test('CONFLUENCE_FORCE_CLOUD=true sets forceCloud in config', () => {
    process.env.CONFLUENCE_DOMAIN = 'wiki.example.org';
    process.env.CONFLUENCE_API_TOKEN = 'token';
    process.env.CONFLUENCE_FORCE_CLOUD = 'true';

    const config = getConfig();
    expect(config.forceCloud).toBe(true);
  });

  test('forceCloud defaults to false when CONFLUENCE_FORCE_CLOUD is not set', () => {
    process.env.CONFLUENCE_DOMAIN = 'wiki.example.org';
    process.env.CONFLUENCE_API_TOKEN = 'token';

    const config = getConfig();
    expect(config.forceCloud).toBe(false);
  });

  test('CONFLUENCE_COOKIE with AUTH_TYPE=cookie sets cookie auth', () => {
    process.env.CONFLUENCE_DOMAIN = 'confluence.company.com';
    process.env.CONFLUENCE_AUTH_TYPE = 'cookie';
    process.env.CONFLUENCE_COOKIE = 'JSESSIONID=abc123xyz';

    const config = getConfig();
    expect(config.authType).toBe('cookie');
    expect(config.cookie).toBe('JSESSIONID=abc123xyz');
    expect(config.token).toBeUndefined();
  });

  test('CONFLUENCE_COOKIE alone (without token or AUTH_TYPE) infers cookie auth', () => {
    process.env.CONFLUENCE_DOMAIN = 'confluence.company.com';
    process.env.CONFLUENCE_COOKIE = 'JSESSIONID=abc123xyz';

    const config = getConfig();
    expect(config.authType).toBe('cookie');
    expect(config.cookie).toBe('JSESSIONID=abc123xyz');
  });

  test('CONFLUENCE_COOKIE is trimmed', () => {
    process.env.CONFLUENCE_DOMAIN = 'confluence.company.com';
    process.env.CONFLUENCE_AUTH_TYPE = 'cookie';
    process.env.CONFLUENCE_COOKIE = '  JSESSIONID=abc123  ';

    const config = getConfig();
    expect(config.cookie).toBe('JSESSIONID=abc123');
  });

  test('cookie auth with multiple cookies preserved', () => {
    process.env.CONFLUENCE_DOMAIN = 'confluence.company.com';
    process.env.CONFLUENCE_AUTH_TYPE = 'cookie';
    process.env.CONFLUENCE_COOKIE = 'JSESSIONID=abc; XSRF-TOKEN=xyz';

    const config = getConfig();
    expect(config.cookie).toBe('JSESSIONID=abc; XSRF-TOKEN=xyz');
  });

  test('AUTH_TYPE=cookie without CONFLUENCE_COOKIE exits with error', () => {
    process.env.CONFLUENCE_DOMAIN = 'confluence.company.com';
    process.env.CONFLUENCE_AUTH_TYPE = 'cookie';
    // No CONFLUENCE_COOKIE set

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      expect(() => getConfig()).toThrow('process.exit called');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/Cookie authentication requires a cookie value/));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
