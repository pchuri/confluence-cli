const { getConfig, initConfig } = require('../lib/config');

// Save and restore all relevant env vars around each test
const ENV_KEYS = [
  'CONFLUENCE_DOMAIN', 'CONFLUENCE_HOST',
  'CONFLUENCE_API_TOKEN', 'CONFLUENCE_PASSWORD',
  'CONFLUENCE_EMAIL', 'CONFLUENCE_USERNAME',
  'CONFLUENCE_AUTH_TYPE', 'CONFLUENCE_API_PATH',
  'CONFLUENCE_PROTOCOL', 'CONFLUENCE_FORCE_CLOUD',
  'CONFLUENCE_LINK_STYLE',
  'CONFLUENCE_COOKIE',
  'CONFLUENCE_TLS_CA_CERT', 'CONFLUENCE_TLS_CLIENT_CERT', 'CONFLUENCE_TLS_CLIENT_KEY'
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

  test('CONFLUENCE_LINK_STYLE sets linkStyle in config', () => {
    process.env.CONFLUENCE_DOMAIN = 'wiki.example.org';
    process.env.CONFLUENCE_API_TOKEN = 'token';
    process.env.CONFLUENCE_LINK_STYLE = 'plain';

    const config = getConfig();
    expect(config.linkStyle).toBe('plain');
  });

  test('linkStyle is undefined when CONFLUENCE_LINK_STYLE is not set', () => {
    process.env.CONFLUENCE_DOMAIN = 'wiki.example.org';
    process.env.CONFLUENCE_API_TOKEN = 'token';

    const config = getConfig();
    expect(config.linkStyle).toBeUndefined();
  });

  test('invalid CONFLUENCE_LINK_STYLE warns and falls back to undefined', () => {
    process.env.CONFLUENCE_DOMAIN = 'wiki.example.org';
    process.env.CONFLUENCE_API_TOKEN = 'token';
    process.env.CONFLUENCE_LINK_STYLE = 'smrt';

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const config = getConfig();
      expect(config.linkStyle).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Invalid linkStyle.*smrt/)
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('CONFLUENCE_LINK_STYLE is case-insensitive and trimmed', () => {
    process.env.CONFLUENCE_DOMAIN = 'wiki.example.org';
    process.env.CONFLUENCE_API_TOKEN = 'token';
    process.env.CONFLUENCE_LINK_STYLE = '  PLAIN  ';

    const config = getConfig();
    expect(config.linkStyle).toBe('plain');
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

  test('CONFLUENCE_AUTH_TYPE=COOKIE (uppercase) enters env path and validates', () => {
    process.env.CONFLUENCE_DOMAIN = 'confluence.company.com';
    process.env.CONFLUENCE_AUTH_TYPE = 'COOKIE';
    // No CONFLUENCE_COOKIE set — should surface the cookie validation error,
    // NOT fall through to "No configuration found!".

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      expect(() => getConfig()).toThrow('process.exit called');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/Cookie authentication requires a cookie value/));
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringMatching(/No configuration found/));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  test('CONFLUENCE_AUTH_TYPE=COOKIE (uppercase) with cookie resolves normally', () => {
    process.env.CONFLUENCE_DOMAIN = 'confluence.company.com';
    process.env.CONFLUENCE_AUTH_TYPE = 'COOKIE';
    process.env.CONFLUENCE_COOKIE = 'JSESSIONID=abc123';

    const config = getConfig();
    expect(config.authType).toBe('cookie');
    expect(config.cookie).toBe('JSESSIONID=abc123');
  });

  test('CONFLUENCE_AUTH_TYPE=MTLS (uppercase) enters env path with mTLS error', () => {
    process.env.CONFLUENCE_DOMAIN = 'confluence.company.com';
    process.env.CONFLUENCE_AUTH_TYPE = 'MTLS';
    // No CONFLUENCE_TLS_* set — should surface the mTLS validation error,
    // NOT fall through to "No configuration found!".

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      expect(() => getConfig()).toThrow('process.exit called');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/client certificate and client key/));
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringMatching(/No configuration found/));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});

describe('initConfig CLI option validation', () => {
  let exitSpy;
  let errorSpy;
  let logSpy;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  test('null --token surfaces a validation error instead of crashing', async () => {
    await expect(initConfig({
      domain: 'example.com',
      token: null,
      authType: 'bearer',
    })).rejects.toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/--token cannot be empty/)
    );
  });

  test('non-string --token surfaces a validation error instead of crashing', async () => {
    await expect(initConfig({
      domain: 'example.com',
      token: 12345,
      authType: 'bearer',
    })).rejects.toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/--token cannot be empty/)
    );
  });

  test('null --cookie with cookie auth surfaces a validation error instead of crashing', async () => {
    await expect(initConfig({
      domain: 'example.com',
      authType: 'cookie',
      cookie: null,
    })).rejects.toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/--cookie cannot be empty/)
    );
  });

  test('whitespace-only --token still flagged as empty (regression guard)', async () => {
    await expect(initConfig({
      domain: 'example.com',
      token: '   ',
      authType: 'bearer',
    })).rejects.toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/--token cannot be empty/)
    );
  });

  test('non-string --domain surfaces a validation error instead of crashing', async () => {
    await expect(initConfig({
      domain: 12345,
      token: 'valid-token',
      authType: 'bearer',
    })).rejects.toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/--domain cannot be empty/)
    );
  });

  test('non-string --api-path surfaces a validation error instead of crashing', async () => {
    await expect(initConfig({
      domain: 'example.com',
      apiPath: 12345,
      token: 'valid-token',
      authType: 'bearer',
    })).rejects.toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/--api-path must start with/)
    );
  });

  test('non-string --protocol surfaces a validation error instead of crashing', async () => {
    await expect(initConfig({
      domain: 'example.com',
      protocol: 12345,
      token: 'valid-token',
      authType: 'bearer',
    })).rejects.toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/--protocol must be/)
    );
  });

  test('non-string --auth-type surfaces a validation error instead of crashing', async () => {
    await expect(initConfig({
      domain: 'example.com',
      token: 'valid-token',
      authType: 12345,
    })).rejects.toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/--auth-type must be/)
    );
  });
});
