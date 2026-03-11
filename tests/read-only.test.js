const { getConfig } = require('../lib/config');

const ENV_KEYS = [
  'CONFLUENCE_DOMAIN', 'CONFLUENCE_HOST',
  'CONFLUENCE_API_TOKEN', 'CONFLUENCE_PASSWORD',
  'CONFLUENCE_EMAIL', 'CONFLUENCE_USERNAME',
  'CONFLUENCE_AUTH_TYPE', 'CONFLUENCE_API_PATH',
  'CONFLUENCE_PROTOCOL', 'CONFLUENCE_READ_ONLY'
];

describe('readOnly mode via environment variables', () => {
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

  test('readOnly is false by default when env var is not set', () => {
    process.env.CONFLUENCE_DOMAIN = 'example.com';
    process.env.CONFLUENCE_API_TOKEN = 'token';

    const config = getConfig();
    expect(config.readOnly).toBe(false);
  });

  test('CONFLUENCE_READ_ONLY=true sets readOnly to true', () => {
    process.env.CONFLUENCE_DOMAIN = 'example.com';
    process.env.CONFLUENCE_API_TOKEN = 'token';
    process.env.CONFLUENCE_READ_ONLY = 'true';

    const config = getConfig();
    expect(config.readOnly).toBe(true);
  });

  test('CONFLUENCE_READ_ONLY=false keeps readOnly as false', () => {
    process.env.CONFLUENCE_DOMAIN = 'example.com';
    process.env.CONFLUENCE_API_TOKEN = 'token';
    process.env.CONFLUENCE_READ_ONLY = 'false';

    const config = getConfig();
    expect(config.readOnly).toBe(false);
  });
});

describe('readOnly mode via config file', () => {
  const saved = {};
  const fs = require('fs');
  const { CONFIG_FILE } = require('../lib/config');

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

  test('readOnly from config file is returned when set to true', () => {
    const originalReadFile = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    const mockConfig = {
      activeProfile: 'default',
      profiles: {
        default: {
          domain: 'example.com',
          token: 'token',
          authType: 'bearer',
          protocol: 'https',
          apiPath: '/rest/api',
          readOnly: true
        }
      }
    };

    jest.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
      if (filePath === CONFIG_FILE) return true;
      return originalExistsSync(filePath);
    });

    jest.spyOn(fs, 'readFileSync').mockImplementation((filePath, encoding) => {
      if (filePath === CONFIG_FILE) return JSON.stringify(mockConfig);
      return originalReadFile(filePath, encoding);
    });

    try {
      const config = getConfig();
      expect(config.readOnly).toBe(true);
    } finally {
      fs.existsSync.mockRestore();
      fs.readFileSync.mockRestore();
    }
  });

  test('CONFLUENCE_READ_ONLY env var overrides config file readOnly=false', () => {
    const originalReadFile = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    const mockConfig = {
      activeProfile: 'default',
      profiles: {
        default: {
          domain: 'example.com',
          token: 'token',
          authType: 'bearer',
          protocol: 'https',
          apiPath: '/rest/api',
          readOnly: false
        }
      }
    };

    jest.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
      if (filePath === CONFIG_FILE) return true;
      return originalExistsSync(filePath);
    });

    jest.spyOn(fs, 'readFileSync').mockImplementation((filePath, encoding) => {
      if (filePath === CONFIG_FILE) return JSON.stringify(mockConfig);
      return originalReadFile(filePath, encoding);
    });

    process.env.CONFLUENCE_READ_ONLY = 'true';

    try {
      const config = getConfig();
      expect(config.readOnly).toBe(true);
    } finally {
      fs.existsSync.mockRestore();
      fs.readFileSync.mockRestore();
    }
  });

  test('CONFLUENCE_READ_ONLY=false overrides config file readOnly=true', () => {
    const originalReadFile = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    const mockConfig = {
      activeProfile: 'default',
      profiles: {
        default: {
          domain: 'example.com',
          token: 'token',
          authType: 'bearer',
          protocol: 'https',
          apiPath: '/rest/api',
          readOnly: true
        }
      }
    };

    jest.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
      if (filePath === CONFIG_FILE) return true;
      return originalExistsSync(filePath);
    });

    jest.spyOn(fs, 'readFileSync').mockImplementation((filePath, encoding) => {
      if (filePath === CONFIG_FILE) return JSON.stringify(mockConfig);
      return originalReadFile(filePath, encoding);
    });

    process.env.CONFLUENCE_READ_ONLY = 'false';

    try {
      const config = getConfig();
      expect(config.readOnly).toBe(false);
    } finally {
      fs.existsSync.mockRestore();
      fs.readFileSync.mockRestore();
    }
  });
});

describe('assertWritable', () => {
  const { _test } = require('../bin/confluence');
  const { assertWritable } = _test;

  test('does not throw for non-readOnly config', () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => assertWritable({ readOnly: false })).not.toThrow();
    expect(mockExit).not.toHaveBeenCalled();

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  test('exits with code 1 for readOnly config', () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => assertWritable({ readOnly: true })).toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('read-only mode')
    );

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  test('does not exit when readOnly is undefined', () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => assertWritable({})).not.toThrow();
    expect(mockExit).not.toHaveBeenCalled();

    mockExit.mockRestore();
    mockError.mockRestore();
  });
});

describe('listProfiles includes readOnly', () => {
  const fs = require('fs');
  const { listProfiles, CONFIG_FILE } = require('../lib/config');

  test('profiles include readOnly flag', () => {
    const originalReadFile = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    const mockConfig = {
      activeProfile: 'default',
      profiles: {
        default: {
          domain: 'example.com',
          token: 'token',
          readOnly: true
        },
        writable: {
          domain: 'other.com',
          token: 'token2'
        }
      }
    };

    jest.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
      if (filePath === CONFIG_FILE) return true;
      return originalExistsSync(filePath);
    });

    jest.spyOn(fs, 'readFileSync').mockImplementation((filePath, encoding) => {
      if (filePath === CONFIG_FILE) return JSON.stringify(mockConfig);
      return originalReadFile(filePath, encoding);
    });

    try {
      const { profiles } = listProfiles();
      const defaultProfile = profiles.find(p => p.name === 'default');
      const writableProfile = profiles.find(p => p.name === 'writable');

      expect(defaultProfile.readOnly).toBe(true);
      expect(writableProfile.readOnly).toBe(false);
    } finally {
      fs.existsSync.mockRestore();
      fs.readFileSync.mockRestore();
    }
  });
});
