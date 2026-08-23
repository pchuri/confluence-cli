const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CONFIG_ENV_KEYS,
  ConfluencePiError,
  buildCliEnvironment,
  redactText,
  runCommand,
} = require('../lib/pi/command-runner');

function fakePackage(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-command-runner-'));
  fs.mkdirSync(path.join(root, 'bin'));
  fs.writeFileSync(path.join(root, 'bin/index.js'), source);
  return root;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('executes package-local argv and parses complete JSON', async () => {
  const packageRoot = fakePackage(`
    process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));
  `);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-project-'));

  try {
    const result = await runCommand({
      packageRoot,
      projectRoot,
      args: ['--json', 'info', '123; echo unsafe'],
      env: { PATH: '' },
      timeoutMs: 1000,
      maxOutputBytes: 4096,
      expectJson: true,
      mutation: false,
    });

    expect(result.json.argv).toEqual(['--json', 'info', '123; echo unsafe']);
    expect(result.json.cwd).toBe(fs.realpathSync(projectRoot));
  } finally {
    cleanup(packageRoot);
    cleanup(projectRoot);
  }
});

test('rejects malformed JSON with INVALID_JSON', async () => {
  const packageRoot = fakePackage('process.stdout.write(\'{not json\');');
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-project-'));

  try {
    await expect(runCommand({
      packageRoot,
      projectRoot,
      args: ['--json', 'info', '123'],
      env: { PATH: '' },
      timeoutMs: 1000,
      maxOutputBytes: 4096,
      expectJson: true,
      mutation: false,
    })).rejects.toMatchObject({ code: 'INVALID_JSON' });
  } finally {
    cleanup(packageRoot);
    cleanup(projectRoot);
  }
});

test('rejects truncated JSON output with OUTPUT_TRUNCATED', async () => {
  const packageRoot = fakePackage('process.stdout.write(\'x\'.repeat(4096));');
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-project-'));

  try {
    await expect(runCommand({
      packageRoot,
      projectRoot,
      args: ['--json', 'info', '123'],
      env: { PATH: '' },
      timeoutMs: 1000,
      maxOutputBytes: 64,
      expectJson: true,
      mutation: false,
    })).rejects.toMatchObject({ code: 'OUTPUT_TRUNCATED' });
  } finally {
    cleanup(packageRoot);
    cleanup(projectRoot);
  }
});

test('marks a truncated mutation result as unknown', async () => {
  const packageRoot = fakePackage('process.stdout.write(\'x\'.repeat(4096));');
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-project-'));

  try {
    await expect(runCommand({
      packageRoot,
      projectRoot,
      args: ['--json', 'update', '123'],
      env: { PATH: '' },
      timeoutMs: 1000,
      maxOutputBytes: 64,
      expectJson: true,
      mutation: true,
    })).rejects.toMatchObject({ code: 'UNKNOWN_RESULT', unknownResult: true });
  } finally {
    cleanup(packageRoot);
    cleanup(projectRoot);
  }
});

test('kills the child when the caller aborts', async () => {
  const packageRoot = fakePackage('setTimeout(() => {}, 60000);');
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-project-'));
  const controller = new AbortController();

  try {
    const pending = runCommand({
      packageRoot,
      projectRoot,
      args: ['read', '123'],
      env: { PATH: '' },
      signal: controller.signal,
      timeoutMs: 10000,
      maxOutputBytes: 4096,
      expectJson: false,
      mutation: false,
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
  } finally {
    cleanup(packageRoot);
    cleanup(projectRoot);
  }
});

test('rejects timed out commands with TIMEOUT', async () => {
  const packageRoot = fakePackage('setTimeout(() => {}, 60000);');
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-project-'));

  try {
    await expect(runCommand({
      packageRoot,
      projectRoot,
      args: ['read', '123'],
      env: { PATH: '' },
      timeoutMs: 25,
      maxOutputBytes: 4096,
      expectJson: false,
      mutation: false,
    })).rejects.toMatchObject({ code: 'TIMEOUT' });
  } finally {
    cleanup(packageRoot);
    cleanup(projectRoot);
  }
});

test('rejects spawn failures with SPAWN_FAILED', async () => {
  const packageRoot = fakePackage('process.stdout.write(\'ok\');');
  const projectRoot = path.join(os.tmpdir(), `missing-project-${Date.now()}-${Math.random()}`);

  await expect(runCommand({
    packageRoot,
    projectRoot,
    args: ['read', '123'],
    env: { PATH: '' },
    timeoutMs: 1000,
    maxOutputBytes: 4096,
    expectJson: false,
    mutation: false,
  })).rejects.toMatchObject({ code: 'SPAWN_FAILED' });

  cleanup(packageRoot);
});

test('does not start a child when the signal is already aborted', async () => {
  jest.resetModules();
  const spawn = jest.fn(() => {
    throw new Error('spawn should not be called');
  });
  jest.doMock('child_process', () => ({ spawn }));
  const { runCommand: isolatedRunCommand } = require('../lib/pi/command-runner');
  const packageRoot = fakePackage('process.stdout.write(\'started\');');
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-project-'));
  const controller = new AbortController();
  controller.abort();

  try {
    await expect(isolatedRunCommand({
      packageRoot,
      projectRoot,
      args: ['read', '123'],
      env: { PATH: '' },
      signal: controller.signal,
      timeoutMs: 1000,
      maxOutputBytes: 4096,
      expectJson: false,
      mutation: false,
    })).rejects.toMatchObject({ code: 'ABORTED' });
    expect(spawn).not.toHaveBeenCalled();
  } finally {
    cleanup(packageRoot);
    cleanup(projectRoot);
    jest.dontMock('child_process');
    jest.resetModules();
  }
});

test('escalates an uncooperative child to SIGKILL and settles', async () => {
  jest.setTimeout(4000);
  const packageRoot = fakePackage(`
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  `);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-project-'));
  const startedAt = Date.now();

  try {
    await expect(runCommand({
      packageRoot,
      projectRoot,
      args: ['read', '123'],
      env: { PATH: '' },
      timeoutMs: 250,
      maxOutputBytes: 4096,
      expectJson: false,
      mutation: false,
    })).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(Date.now() - startedAt).toBeLessThan(1500);
  } finally {
    cleanup(packageRoot);
    cleanup(projectRoot);
  }
});

test('rejects truncated non-JSON failures', async () => {
  const packageRoot = fakePackage(`
    process.on('SIGTERM', () => {});
    process.stdout.write('x'.repeat(4096));
    setTimeout(() => process.exit(3), 25);
  `);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-project-'));

  try {
    await expect(runCommand({
      packageRoot,
      projectRoot,
      args: ['read', '123'],
      env: { PATH: '' },
      timeoutMs: 1000,
      maxOutputBytes: 64,
      expectJson: false,
      mutation: false,
    })).rejects.toMatchObject({ code: 'CLI_FAILED' });
  } finally {
    cleanup(packageRoot);
    cleanup(projectRoot);
  }
});

test('redacts tokens, cookies, emails, usernames, and private key paths', () => {
  const env = {
    CONFLUENCE_API_TOKEN: 'api-token-123',
    CONFLUENCE_PASSWORD: 'password-456',
    CONFLUENCE_EMAIL: 'user@example.com',
    CONFLUENCE_USERNAME: 'legacy-user',
    CONFLUENCE_COOKIE: 'JSESSIONID=secret-cookie',
    CONFLUENCE_TLS_CLIENT_KEY: '/private/client-key.pem',
  };
  const text = redactText(
    'token=api-token-123 password=password-456 email=user@example.com username=legacy-user cookie=JSESSIONID=secret-cookie key=/private/client-key.pem',
    env,
  );

  expect(text).toBe('token=[REDACTED] password=[REDACTED] email=[REDACTED] username=[REDACTED] cookie=[REDACTED] key=[REDACTED]');
});

test('builds a minimal CLI environment from known config keys', () => {
  const env = {
    CONFLUENCE_DOMAIN: 'example.atlassian.net',
    CONFLUENCE_API_TOKEN: 'token',
    CONFLUENCE_COOKIE: 'cookie',
    CONFLUENCE_TLS_CLIENT_KEY: '/tmp/key.pem',
    PATH: '/usr/bin',
    UNRELATED: 'ignore-me',
  };

  const result = buildCliEnvironment(env);

  expect(result.CONFLUENCE_DOMAIN).toBe('example.atlassian.net');
  expect(result.CONFLUENCE_API_TOKEN).toBe('token');
  expect(result.CONFLUENCE_COOKIE).toBe('cookie');
  expect(result.CONFLUENCE_TLS_CLIENT_KEY).toBe('/tmp/key.pem');
  expect(result.UNRELATED).toBeUndefined();
  expect(CONFIG_ENV_KEYS).toContain('CONFLUENCE_COOKIE');
});

test('exports the custom error type', () => {
  const error = new ConfluencePiError('boom', { code: 'CLI_FAILED' });
  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(ConfluencePiError);
  expect(error.code).toBe('CLI_FAILED');
});
