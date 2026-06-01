const fs = require('fs');

// Mock fs so we can simulate the on-disk config file without touching ~/.confluence-cli
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn((...args) => actual.existsSync(...args)),
    readFileSync: jest.fn((...args) => actual.readFileSync(...args)),
    writeFileSync: jest.fn((...args) => actual.writeFileSync(...args)),
    mkdirSync: jest.fn((...args) => actual.mkdirSync(...args)),
    chmodSync: jest.fn(),
  };
});

const { initConfig, CONFIG_FILE } = require('../lib/config');

// Make CONFIG_FILE reads/writes hit our in-memory data instead of disk.
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

function captureConfigWrite() {
  let captured = null;
  fs.writeFileSync.mockImplementation((filePath, content) => {
    if (filePath === CONFIG_FILE) {
      captured = JSON.parse(content);
    }
  });
  fs.mkdirSync.mockImplementation(() => {});
  return { getWritten: () => captured };
}

describe('initConfig with a pre-existing config file that lacks a profiles key', () => {
  let exitSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit called with ${code}`);
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Regression: an older flat config using baseUrl/apiToken (no `domain`, no `profiles`)
  // is returned as-is by readConfigFile, then saveConfig does
  // `fileData.profiles[targetProfile] = ...` on an undefined `profiles`, crashing with
  // "Cannot set properties of undefined (setting 'default')".
  test('does not crash and writes a valid profiles structure', async () => {
    mockConfigFile({
      baseUrl: 'https://old.atlassian.net/wiki',
      restApiPath: '/rest/api',
      email: 'old@example.com',
      apiToken: 'old-token',
    });
    const writer = captureConfigWrite();

    let error;
    try {
      await initConfig({
        domain: 'new.atlassian.net',
        apiPath: '/wiki/rest/api',
        authType: 'basic',
        email: 'new@example.com',
        token: 'new-token',
        protocol: 'https',
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();

    const written = writer.getWritten();
    expect(written).toBeTruthy();
    expect(written.profiles).toBeDefined();
    expect(written.profiles.default.domain).toBe('new.atlassian.net');
    expect(written.profiles.default.token).toBe('new-token');
    expect(written.activeProfile).toBe('default');
  });
});
