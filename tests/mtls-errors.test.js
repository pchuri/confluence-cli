const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.resolve(__dirname, '../bin/index.js');

describe('mTLS failures', () => {
  test('--json suppresses the client-key permission warning without changing human output', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-mtls-errors-'));
    const clientCert = path.join(tempDir, 'client.pem');
    const clientKey = path.join(tempDir, 'client.key');
    fs.writeFileSync(clientCert, 'client-cert');
    fs.writeFileSync(clientKey, 'client-key', { mode: 0o644 });

    try {
      const result = spawnSync(process.execPath, [CLI, '--json', 'info', '123'], {
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          CONFLUENCE_DOMAIN: '127.0.0.1:1',
          CONFLUENCE_AUTH_TYPE: 'mtls',
          CONFLUENCE_TLS_CLIENT_CERT: clientCert,
          CONFLUENCE_TLS_CLIENT_KEY: clientKey,
          CONFLUENCE_API_PATH: '/rest/api',
          NO_PROXY: '127.0.0.1',
        },
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(JSON.parse(result.stderr)).toEqual({
        error: expect.any(String),
        code: expect.any(String),
        status: null,
        details: null,
      });

      const humanResult = spawnSync(process.execPath, [CLI, 'info', '123'], {
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          CONFLUENCE_DOMAIN: '127.0.0.1:1',
          CONFLUENCE_AUTH_TYPE: 'mtls',
          CONFLUENCE_TLS_CLIENT_CERT: clientCert,
          CONFLUENCE_TLS_CLIENT_KEY: clientKey,
          CONFLUENCE_API_PATH: '/rest/api',
          NO_PROXY: '127.0.0.1',
        },
      });
      const warning = `Warning: Client key file "${clientKey}" has mode 644. ` +
        'Private keys should not be readable by other users (recommended: 0600). ' +
        `Fix with: chmod 600 "${clientKey}"\n`;

      expect(humanResult.status).toBe(1);
      expect(humanResult.stderr.startsWith(warning)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
