const { getConfig } = require('../lib/config');

// Save and restore all relevant env vars around each test
const ENV_KEYS = [
  'CONFLUENCE_DOMAIN', 'CONFLUENCE_HOST',
  'CONFLUENCE_API_TOKEN', 'CONFLUENCE_PASSWORD',
  'CONFLUENCE_EMAIL', 'CONFLUENCE_USERNAME',
  'CONFLUENCE_AUTH_TYPE', 'CONFLUENCE_API_PATH'
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
});
