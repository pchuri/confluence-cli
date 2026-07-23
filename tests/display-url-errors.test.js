const { spawnSync } = require('child_process');
const path = require('path');

const CLI = path.resolve(__dirname, '../bin/index.js');
const DISPLAY_URL = 'http://127.0.0.1:1/display/SPACE/Title';

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      CONFLUENCE_DOMAIN: '127.0.0.1:1',
      CONFLUENCE_API_TOKEN: 'test-token',
      CONFLUENCE_AUTH_TYPE: 'bearer',
      CONFLUENCE_PROTOCOL: 'http',
      CONFLUENCE_API_PATH: '/rest/api',
      NO_PROXY: '127.0.0.1',
    },
  });
}

describe('display URL resolution failures', () => {
  test('--json emits exactly one structured error on stderr', () => {
    const result = runCli(['--json', 'info', DISPLAY_URL]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toEqual({
      error: `Could not resolve page ID from display URL: ${DISPLAY_URL}`,
      code: 'VALIDATION',
      status: null,
      details: null,
    });
  });

  test('human-readable mode preserves the resolution diagnostic', () => {
    const result = runCli(['info', DISPLAY_URL]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Error resolving page ID from display URL:');
    expect(result.stderr).toContain(`Error: Could not resolve page ID from display URL: ${DISPLAY_URL}`);
  });
});
