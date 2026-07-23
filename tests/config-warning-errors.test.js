const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.resolve(__dirname, '../bin/index.js');

const CONFIG_ENV_KEYS = [
  'CONFLUENCE_DOMAIN', 'CONFLUENCE_HOST',
  'CONFLUENCE_API_TOKEN', 'CONFLUENCE_PASSWORD',
  'CONFLUENCE_EMAIL', 'CONFLUENCE_USERNAME',
  'CONFLUENCE_AUTH_TYPE', 'CONFLUENCE_API_PATH',
  'CONFLUENCE_PROTOCOL', 'CONFLUENCE_LINK_STYLE',
  'CONFLUENCE_CONFIG_DIR', 'CONFLUENCE_PROFILE', 'NETRC',
];

function runCli(args, overrides) {
  const env = { ...process.env };
  for (const key of CONFIG_ENV_KEYS) delete env[key];

  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...env, ...overrides },
  });
}

function expectStructuredError(result) {
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(JSON.parse(result.stderr)).toEqual({
    error: expect.any(String),
    code: expect.any(String),
    status: null,
    details: null,
  });
}

describe('configuration warnings on command failures', () => {
  test('--json suppresses unreadable netrc warnings without changing human output', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-netrc-warning-'));
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
      activeProfile: 'default',
      profiles: {
        default: {
          domain: 'example.atlassian.net',
          authType: 'bearer',
          protocol: 'https',
          apiPath: '/rest/api',
        },
      },
    }));

    try {
      const env = { CONFLUENCE_CONFIG_DIR: configDir, NETRC: configDir };
      const result = runCli(['--json', 'spaces'], env);

      expectStructuredError(result);

      const humanResult = runCli(['spaces'], env);
      expect(humanResult.status).toBe(1);
      expect(humanResult.stderr).toContain(`⚠ Failed to read netrc file at ${configDir}:`);
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  test('--json suppresses invalid link-style warnings without changing human output', () => {
    const env = {
      CONFLUENCE_DOMAIN: '127.0.0.1:1',
      CONFLUENCE_API_TOKEN: 'test-token',
      CONFLUENCE_AUTH_TYPE: 'bearer',
      CONFLUENCE_PROTOCOL: 'http',
      CONFLUENCE_API_PATH: '/rest/api',
      CONFLUENCE_LINK_STYLE: 'smrt',
      NO_PROXY: '127.0.0.1',
    };
    const result = runCli(['--json', 'spaces'], env);

    expectStructuredError(result);

    const humanResult = runCli(['spaces'], env);
    expect(humanResult.status).toBe(1);
    expect(humanResult.stderr).toContain(
      '⚠ Invalid linkStyle from CONFLUENCE_LINK_STYLE "smrt"; valid values:'
    );
  });
});
