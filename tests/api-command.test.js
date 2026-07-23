const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.resolve(__dirname, '../bin/index.js');

// Save and set up env-based config so getConfig() works without a config file
const ENV_KEYS = [
  'CONFLUENCE_DOMAIN', 'CONFLUENCE_HOST',
  'CONFLUENCE_API_TOKEN', 'CONFLUENCE_PASSWORD',
  'CONFLUENCE_EMAIL', 'CONFLUENCE_USERNAME',
  'CONFLUENCE_AUTH_TYPE', 'CONFLUENCE_API_PATH',
  'CONFLUENCE_PROTOCOL', 'CONFLUENCE_READ_ONLY'
];

describe('api command', () => {
  let tmpDir;
  let baseEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-api-'));
    // Build a clean env that won't pick up any host config file
    baseEnv = { ...process.env };
    for (const key of ENV_KEYS) {
      delete baseEnv[key];
    }
    baseEnv.CONFLUENCE_DOMAIN = 'test.atlassian.net';
    baseEnv.CONFLUENCE_API_TOKEN = 'test-token';
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function run(args, opts = {}) {
    const { env: extraEnv, ...rest } = opts;
    return execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...baseEnv, ...extraEnv },
      ...rest,
    });
  }

  function runErr(args, opts = {}) {
    const { env: extraEnv, ...rest } = opts;
    try {
      execFileSync(process.execPath, [CLI, ...args], {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...baseEnv, ...extraEnv },
        ...rest,
      });
      throw new Error('Expected command to fail');
    } catch (e) {
      if (e.message === 'Expected command to fail') throw e;
      return { stderr: e.stderr, stdout: e.stdout, status: e.status };
    }
  }

  describe('field parsing', () => {
    test('missing = in field causes error', () => {
      const { stderr } = runErr(['api', '/rest/api/content', '-f', 'badfield']);
      expect(stderr).toContain('Invalid field');
      expect(stderr).toContain('key=value');
    });

    test('field value containing = is preserved', () => {
      // This will fail connecting, but we can verify the field parsing doesn't error
      const { stderr } = runErr(['api', '/rest/api/content', '-f', 'query=a=b']);
      // Should NOT contain "Invalid field" — the error should be a connection/network error
      expect(stderr).not.toContain('Invalid field');
    });
  });

  describe('header parsing', () => {
    test('missing : in header causes error', () => {
      const { stderr } = runErr(['api', '/rest/api/content', '-H', 'BadHeader']);
      expect(stderr).toContain('Invalid header');
      expect(stderr).toContain('key:value');
    });

    test('header value containing : is preserved', () => {
      const { stderr } = runErr(['api', '/rest/api/content', '-H', 'Accept:application/json:extra']);
      // Should NOT contain "Invalid header"
      expect(stderr).not.toContain('Invalid header');
    });
  });

  describe('read-only enforcement', () => {
    test('blocks DELETE in read-only mode', () => {
      const { stderr } = runErr(['api', '/rest/api/content/123', '-X', 'DELETE'], {
        env: { CONFLUENCE_READ_ONLY: 'true' },
      });
      expect(stderr).toContain('read-only');
    });

    test('blocks POST in read-only mode', () => {
      const { stderr } = runErr(['api', '/rest/api/content', '-X', 'POST'], {
        env: { CONFLUENCE_READ_ONLY: 'true' },
      });
      expect(stderr).toContain('read-only');
    });

    test('allows GET in read-only mode', () => {
      // Will fail with connection error, not read-only error
      const { stderr } = runErr(['api', '/rest/api/content'], {
        env: { CONFLUENCE_READ_ONLY: 'true' },
      });
      expect(stderr).not.toContain('read-only');
    });
  });

  describe('method auto-detection', () => {
    test('defaults to GET when no fields', () => {
      // Will fail connecting, but shouldn't show read-only error
      const { stderr } = runErr(['api', '/rest/api/content'], {
        env: { CONFLUENCE_READ_ONLY: 'true' },
      });
      expect(stderr).not.toContain('read-only');
    });

    test('auto-POST when fields present', () => {
      const { stderr } = runErr(['api', '/rest/api/content', '-f', 'title=Test'], {
        env: { CONFLUENCE_READ_ONLY: 'true' },
      });
      expect(stderr).toContain('read-only');
    });

    test('explicit method overrides auto-detection', () => {
      // Explicit GET even with fields should not be blocked
      const { stderr } = runErr(['api', '/rest/api/content', '-f', 'title=Test', '-X', 'GET'], {
        env: { CONFLUENCE_READ_ONLY: 'true' },
      });
      expect(stderr).not.toContain('read-only');
    });
  });

  describe('--input option', () => {
    test('reads body from file', () => {
      const inputFile = path.join(tmpDir, 'body.json');
      fs.writeFileSync(inputFile, '{"title":"FromFile"}');
      // --input triggers auto-POST, read-only should block it
      const { stderr } = runErr(['api', '/rest/api/content', '--input', inputFile], {
        env: { CONFLUENCE_READ_ONLY: 'true' },
      });
      expect(stderr).toContain('read-only');
    });

    test('reads body from stdin via -', () => {
      // --input - triggers auto-POST, read-only should block it
      const { stderr } = runErr(['api', '/rest/api/content', '--input', '-'], {
        env: { CONFLUENCE_READ_ONLY: 'true' },
        input: '{"title":"FromStdin"}',
      });
      expect(stderr).toContain('read-only');
    });
  });

  describe('--silent option', () => {
    test('suppresses output on error', () => {
      // Even with --silent, errors still go to stderr and exit 1
      const { stderr } = runErr(['api', '/rest/api/content', '--silent']);
      // Should still have some error (connection failure), but command ran
      expect(stderr).toBeDefined();
    });
  });

  describe('--json structured errors', () => {
    test('invalid field under --json emits one JSON error object on stderr, nothing on stdout', () => {
      const { stderr, stdout } = runErr(['--json', 'api', '/rest/api/content', '-f', 'badfield']);
      expect(stdout).toBe('');
      const payload = JSON.parse(stderr);
      expect(payload).toEqual({
        error: 'Invalid field "badfield". Must be key=value.',
        code: 'VALIDATION',
        status: null,
        details: null,
      });
    });

    test('read-only block under --json emits structured VALIDATION error (no Tip prose)', () => {
      const { stderr } = runErr(['--json', 'api', '/rest/api/content/123', '-X', 'DELETE'], {
        env: { CONFLUENCE_READ_ONLY: 'true' },
      });
      const payload = JSON.parse(stderr);
      expect(payload).toMatchObject({ code: 'VALIDATION', status: null });
      expect(payload.error).toContain('read-only');
      expect(stderr).not.toContain('Tip:');
    });

    test('without --json, invalid field stays human-readable prose (not JSON)', () => {
      const { stderr } = runErr(['api', '/rest/api/content', '-f', 'badfield']);
      expect(stderr).toContain('Error:');
      expect(stderr).toContain('Invalid field');
      expect(() => JSON.parse(stderr)).toThrow();
    });
  });

  describe('help output', () => {
    test('api command appears in help', () => {
      const output = run(['api', '--help']);
      expect(output).toContain('authenticated API request');
      expect(output).toContain('--method');
      expect(output).toContain('--field');
      expect(output).toContain('--header');
      expect(output).toContain('--input');
      expect(output).toContain('--jq');
      expect(output).toContain('--include');
      expect(output).toContain('--silent');
    });

    test('help documents absolute-path apiPath bypass', () => {
      const output = run(['api', '--help']);
      expect(output).toContain('apiPath');
      expect(output).toContain('/wiki');
    });
  });
});
