const fs = require('fs');

// Mock CONFIG_DIR and CONFIG_FILE before requiring config module
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn((...args) => actual.existsSync(...args)),
    readFileSync: jest.fn((...args) => actual.readFileSync(...args)),
    writeFileSync: jest.fn((...args) => actual.writeFileSync(...args)),
    mkdirSync: jest.fn((...args) => actual.mkdirSync(...args)),
  };
});

const {
  getConfig,
  listProfiles,
  setActiveProfile,
  deleteProfile,
  isValidProfileName,
  CONFIG_FILE,
} = require('../lib/config');

// Save and restore all relevant env vars around each test
const ENV_KEYS = [
  'CONFLUENCE_DOMAIN', 'CONFLUENCE_HOST',
  'CONFLUENCE_API_TOKEN', 'CONFLUENCE_PASSWORD',
  'CONFLUENCE_EMAIL', 'CONFLUENCE_USERNAME',
  'CONFLUENCE_AUTH_TYPE', 'CONFLUENCE_API_PATH',
  'CONFLUENCE_PROTOCOL', 'CONFLUENCE_PROFILE',
];

// Helper to create a multi-profile config
function multiProfileConfig(overrides = {}) {
  return {
    activeProfile: 'default',
    profiles: {
      default: {
        domain: 'default.atlassian.net',
        protocol: 'https',
        apiPath: '/wiki/rest/api',
        token: 'default-token',
        authType: 'bearer',
      },
      staging: {
        domain: 'staging.example.com',
        protocol: 'http',
        apiPath: '/rest/api',
        token: 'staging-token',
        authType: 'basic',
        email: 'user@staging.com',
      },
    },
    ...overrides,
  };
}

// Helper to create an old flat config
function flatConfig() {
  return {
    domain: 'old.atlassian.net',
    protocol: 'https',
    apiPath: '/wiki/rest/api',
    token: 'old-token',
    authType: 'bearer',
  };
}

// Mock fs to simulate config file reads/writes
function mockConfigFile(data) {
  fs.existsSync.mockImplementation((filePath) => {
    if (filePath === CONFIG_FILE) return data !== null;
    return jest.requireActual('fs').existsSync(filePath);
  });
  fs.readFileSync.mockImplementation((filePath, encoding) => {
    if (filePath === CONFIG_FILE) {
      if (data === null) throw new Error('ENOENT: no such file');
      return JSON.stringify(data);
    }
    return jest.requireActual('fs').readFileSync(filePath, encoding);
  });
}

// Capture what was written to config file
function captureConfigWrite() {
  let captured = null;
  fs.writeFileSync.mockImplementation((filePath, content) => {
    if (filePath === CONFIG_FILE) {
      captured = JSON.parse(content);
    }
  });
  fs.mkdirSync.mockImplementation(() => {});
  return () => captured;
}

describe('Profile management', () => {
  const saved = {};

  beforeEach(() => {
    jest.clearAllMocks();
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

  describe('isValidProfileName', () => {
    test('accepts alphanumeric names', () => {
      expect(isValidProfileName('myprofile')).toBe(true);
      expect(isValidProfileName('Profile1')).toBe(true);
    });

    test('accepts names with hyphens and underscores', () => {
      expect(isValidProfileName('my-profile')).toBe(true);
      expect(isValidProfileName('my_profile')).toBe(true);
      expect(isValidProfileName('dev-env_01')).toBe(true);
    });

    test('rejects names with spaces', () => {
      expect(isValidProfileName('my profile')).toBe(false);
    });

    test('rejects names with special characters', () => {
      expect(isValidProfileName('my.profile')).toBe(false);
      expect(isValidProfileName('my/profile')).toBe(false);
      expect(isValidProfileName('my@profile')).toBe(false);
    });

    test('rejects empty names', () => {
      expect(isValidProfileName('')).toBe(false);
    });
  });

  describe('getConfig with profiles', () => {
    test('returns default profile when no profile name given', () => {
      mockConfigFile(multiProfileConfig());
      const config = getConfig();
      expect(config.domain).toBe('default.atlassian.net');
      expect(config.token).toBe('default-token');
      expect(config.protocol).toBe('https');
    });

    test('returns named profile when profile name given', () => {
      mockConfigFile(multiProfileConfig());
      const config = getConfig('staging');
      expect(config.domain).toBe('staging.example.com');
      expect(config.token).toBe('staging-token');
      expect(config.email).toBe('user@staging.com');
      expect(config.authType).toBe('basic');
      expect(config.protocol).toBe('http');
    });

    test('env vars still take priority over any profile', () => {
      process.env.CONFLUENCE_DOMAIN = 'env.example.com';
      process.env.CONFLUENCE_API_TOKEN = 'env-token';
      mockConfigFile(multiProfileConfig());

      const config = getConfig('staging');
      expect(config.domain).toBe('env.example.com');
      expect(config.token).toBe('env-token');
    });

    test('CONFLUENCE_PROFILE env var selects profile', () => {
      process.env.CONFLUENCE_PROFILE = 'staging';
      mockConfigFile(multiProfileConfig());

      const config = getConfig();
      expect(config.domain).toBe('staging.example.com');
    });

    test('explicit profile parameter overrides CONFLUENCE_PROFILE env var', () => {
      process.env.CONFLUENCE_PROFILE = 'staging';
      mockConfigFile(multiProfileConfig());

      const config = getConfig('default');
      expect(config.domain).toBe('default.atlassian.net');
    });

    test('exits with error for non-existent profile name', () => {
      mockConfigFile(multiProfileConfig());
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
      const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});
      const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});

      expect(() => getConfig('nonexistent')).toThrow('process.exit');

      mockExit.mockRestore();
      mockError.mockRestore();
      mockLog.mockRestore();
    });

    test('backward compatible with old flat config format', () => {
      mockConfigFile(flatConfig());
      const config = getConfig();
      expect(config.domain).toBe('old.atlassian.net');
      expect(config.token).toBe('old-token');
      expect(config.authType).toBe('bearer');
      expect(config.protocol).toBe('https');
    });

    test('exits with error for empty config file', () => {
      mockConfigFile(null);
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
      const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});
      const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});

      expect(() => getConfig()).toThrow('process.exit');

      mockExit.mockRestore();
      mockError.mockRestore();
      mockLog.mockRestore();
    });
  });

  describe('listProfiles', () => {
    test('returns empty list when no config file', () => {
      mockConfigFile(null);
      const result = listProfiles();
      expect(result.activeProfile).toBeNull();
      expect(result.profiles).toEqual([]);
    });

    test('returns all profiles with active marker', () => {
      mockConfigFile(multiProfileConfig());
      const result = listProfiles();
      expect(result.activeProfile).toBe('default');
      expect(result.profiles).toHaveLength(2);

      const defaultProfile = result.profiles.find(p => p.name === 'default');
      expect(defaultProfile.active).toBe(true);
      expect(defaultProfile.domain).toBe('default.atlassian.net');

      const stagingProfile = result.profiles.find(p => p.name === 'staging');
      expect(stagingProfile.active).toBe(false);
      expect(stagingProfile.domain).toBe('staging.example.com');
    });

    test('handles old flat config format', () => {
      mockConfigFile(flatConfig());
      const result = listProfiles();
      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0].name).toBe('default');
      expect(result.profiles[0].domain).toBe('old.atlassian.net');
    });
  });

  describe('setActiveProfile', () => {
    test('switches active profile', () => {
      mockConfigFile(multiProfileConfig());
      const getWritten = captureConfigWrite();

      setActiveProfile('staging');

      const written = getWritten();
      expect(written.activeProfile).toBe('staging');
      expect(written.profiles.default).toBeDefined();
      expect(written.profiles.staging).toBeDefined();
    });

    test('throws error for non-existent profile', () => {
      mockConfigFile(multiProfileConfig());
      expect(() => setActiveProfile('nonexistent')).toThrow('not found');
    });

    test('throws error when no config file', () => {
      mockConfigFile(null);
      expect(() => setActiveProfile('default')).toThrow('No configuration file found');
    });
  });

  describe('deleteProfile', () => {
    test('removes named profile', () => {
      mockConfigFile(multiProfileConfig());
      const getWritten = captureConfigWrite();

      deleteProfile('staging');

      const written = getWritten();
      expect(written.profiles.staging).toBeUndefined();
      expect(written.profiles.default).toBeDefined();
    });

    test('switches active profile if deleted profile was active', () => {
      mockConfigFile(multiProfileConfig());
      const getWritten = captureConfigWrite();

      deleteProfile('default');

      const written = getWritten();
      expect(written.profiles.default).toBeUndefined();
      expect(written.activeProfile).toBe('staging');
    });

    test('throws error when trying to delete the only profile', () => {
      mockConfigFile({
        activeProfile: 'default',
        profiles: {
          default: {
            domain: 'only.atlassian.net',
            protocol: 'https',
            apiPath: '/wiki/rest/api',
            token: 'only-token',
            authType: 'bearer',
          },
        },
      });

      expect(() => deleteProfile('default')).toThrow('Cannot delete the only remaining profile');
    });

    test('throws error for non-existent profile', () => {
      mockConfigFile(multiProfileConfig());
      expect(() => deleteProfile('nonexistent')).toThrow('not found');
    });

    test('throws error when no config file', () => {
      mockConfigFile(null);
      expect(() => deleteProfile('default')).toThrow('No configuration file found');
    });
  });
});
