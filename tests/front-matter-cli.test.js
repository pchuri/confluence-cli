const fs = require('fs');
const os = require('os');
const path = require('path');

describe('CLI --front-matter', () => {
  const FRONT_MATTER_DOC = [
    '---',
    'properties:',
    '  content-appearance-published: full-width',
    '---',
    '',
    '# Title',
    '',
  ].join('\n');

  function stripAnsi(value) {
    // eslint-disable-next-line no-control-regex
    return typeof value === 'string' ? value.replace(/\u001b\[[0-9;]*m/g, '') : value;
  }

  function pageResult(overrides = {}) {
    return {
      id: '555',
      title: 'Doc',
      space: { key: 'ENG', name: 'Engineering' },
      version: { number: 2 },
      _links: { webui: '/spaces/ENG/pages/555' },
      ...overrides,
    };
  }

  async function loadCli(clientOverrides = {}) {
    jest.resetModules();

    const client = {
      readPage: jest.fn(async () => '# Title\n'),
      getPageInfo: jest.fn(async () => ({ id: '100', title: 'Parent', space: { key: 'ENG', name: 'Engineering' } })),
      extractPageId: jest.fn(async (pageId) => String(pageId)),
      createPage: jest.fn(async () => pageResult()),
      createChildPage: jest.fn(async () => pageResult()),
      updatePage: jest.fn(async () => pageResult()),
      syncProperties: jest.fn(async (pageId, properties) => ({
        applied: Object.keys(properties),
        unchanged: [],
        failed: [],
      })),
      getPropertyValues: jest.fn(async () => []),
      buildUrl: jest.fn((value) => value),
      webUrlPrefix: '/wiki',
      ...clientOverrides,
    };

    jest.doMock('../lib/confluence-client', () => jest.fn(() => client));
    jest.doMock('../lib/config', () => ({
      getConfig: jest.fn(() => ({ domain: 'test.atlassian.net', token: 'test-token' })),
      initConfig: jest.fn(),
      listProfiles: jest.fn(),
      setActiveProfile: jest.fn(),
      deleteProfile: jest.fn(),
      isValidProfileName: jest.fn(() => true),
    }));
    jest.doMock('../lib/analytics', () => class Analytics { track() {} });

    let cli;
    jest.isolateModules(() => {
      cli = require('../bin/confluence.js');
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    return {
      client,
      logSpy,
      errorSpy,
      exitSpy,
      run: (args) => cli.program.parseAsync(args, { from: 'user' }),
      stdout: () => logSpy.mock.calls.map((call) => stripAnsi(call[0])).join('\n'),
      stderr: () => errorSpy.mock.calls.map((call) => call.map(stripAnsi).join(' ')).join('\n'),
    };
  }

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  describe('writes', () => {
    test('create strips front matter from the body and applies its properties after saving', async () => {
      const cli = await loadCli();

      await cli.run(['--json', 'create', 'Doc', 'ENG', '--content', FRONT_MATTER_DOC, '--format', 'markdown', '--front-matter']);

      expect(cli.exitSpy).not.toHaveBeenCalled();
      expect(cli.client.createPage).toHaveBeenCalledWith('Doc', 'ENG', '# Title\n', 'markdown', 'page');
      expect(cli.client.syncProperties).toHaveBeenCalledWith('555', { 'content-appearance-published': 'full-width' });
      expect(JSON.parse(cli.logSpy.mock.calls[0][0]).properties).toEqual({
        applied: ['content-appearance-published'],
        unchanged: [],
        failed: [],
      });
    });

    test('without --front-matter a leading "---" stays part of the body', async () => {
      const cli = await loadCli();

      await cli.run(['create', 'Doc', 'ENG', '--content', FRONT_MATTER_DOC, '--format', 'markdown']);

      expect(cli.client.createPage).toHaveBeenCalledWith('Doc', 'ENG', FRONT_MATTER_DOC, 'markdown', 'page');
      expect(cli.client.syncProperties).not.toHaveBeenCalled();
    });

    test('a document without front matter is uploaded as-is and sets no properties', async () => {
      const cli = await loadCli();

      await cli.run(['--json', 'update', '555', '--content', '# Title\n', '--format', 'markdown', '--front-matter']);

      expect(cli.client.updatePage).toHaveBeenCalledWith('555', undefined, '# Title\n', 'markdown');
      expect(cli.client.syncProperties).not.toHaveBeenCalled();
      expect(JSON.parse(cli.logSpy.mock.calls[0][0]).properties).toEqual({ applied: [], unchanged: [], failed: [] });
    });

    test.each([
      ['create', ['create', 'Doc', 'ENG']],
      ['create-child', ['create-child', 'Doc', '100']],
      ['update', ['update', '555']],
    ])('%s rejects invalid YAML before any network call', async (_name, command) => {
      const cli = await loadCli();

      await cli.run([...command, '--content', '---\nproperties: [a\n---\nBody', '--format', 'markdown', '--front-matter']);

      expect(cli.exitSpy).toHaveBeenCalledWith(1);
      expect(cli.stderr()).toMatch(/Invalid YAML in front matter/);
      expect(cli.client.getPageInfo).not.toHaveBeenCalled();
      expect(cli.client.createPage).not.toHaveBeenCalled();
      expect(cli.client.createChildPage).not.toHaveBeenCalled();
      expect(cli.client.updatePage).not.toHaveBeenCalled();
    });

    test('update refuses a document with front matter but no body', async () => {
      const cli = await loadCli();

      await cli.run(['update', '555', '--content', '---\nproperties:\n  a: b\n---\n\n', '--format', 'markdown', '--front-matter']);

      expect(cli.exitSpy).toHaveBeenCalledWith(1);
      expect(cli.stderr()).toMatch(/front matter but no body/);
      expect(cli.client.updatePage).not.toHaveBeenCalled();
    });

    test('requires --format markdown', async () => {
      const cli = await loadCli();

      await cli.run(['update', '555', '--content', FRONT_MATTER_DOC, '--front-matter']);

      expect(cli.exitSpy).toHaveBeenCalledWith(1);
      expect(cli.stderr()).toMatch(/--front-matter requires --format markdown/);
      expect(cli.client.updatePage).not.toHaveBeenCalled();
    });

    test('create rejects --front-matter with --type folder', async () => {
      const cli = await loadCli();

      await cli.run(['create', 'Docs', 'ENG', '--type', 'folder', '--format', 'markdown', '--front-matter']);

      expect(cli.exitSpy).toHaveBeenCalledWith(1);
      expect(cli.stderr()).toMatch(/--front-matter is not allowed with --type folder/);
      expect(cli.client.createPage).not.toHaveBeenCalled();
    });

    test('warns when front matter has no properties map', async () => {
      const cli = await loadCli();

      await cli.run(['update', '555', '--content', '---\ntitle: x\n---\n# Title\n', '--format', 'markdown', '--front-matter']);

      expect(cli.stderr()).toContain('Warning: front matter has no "properties" map');
      expect(cli.client.updatePage).toHaveBeenCalledWith('555', undefined, '# Title\n', 'markdown');
      expect(cli.client.syncProperties).not.toHaveBeenCalled();
    });

    test('update with blank content and no front matter keeps the existing behavior', async () => {
      const cli = await loadCli();

      await cli.run(['update', '555', '--content', '  ', '--format', 'markdown', '--front-matter']);

      expect(cli.exitSpy).not.toHaveBeenCalled();
      expect(cli.client.updatePage).toHaveBeenCalledWith('555', undefined, '  ', 'markdown');
    });

    test('create partial failure points at update instead of re-running create', async () => {
      const cli = await loadCli({
        syncProperties: jest.fn(async () => ({
          applied: [],
          unchanged: [],
          failed: [{ key: 'content-appearance-published', status: 403, error: 'scope missing' }],
        })),
      });

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'front-matter-'));
      const file = path.join(dir, 'page.md');
      fs.writeFileSync(file, FRONT_MATTER_DOC);
      try {
        await cli.run(['create', 'Doc', 'ENG', '--file', file, '--format', 'markdown', '--front-matter']);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }

      expect(cli.stdout()).toContain('Page created successfully!');
      expect(cli.stderr()).toContain('Page 555 was saved, but 1 content property failed: content-appearance-published (403: scope missing)');
      expect(cli.stderr()).toContain(`Retry the properties with "confluence update 555 --file ${file} --format markdown --front-matter"`);
      expect(cli.stderr()).not.toContain('Re-run the same command');
      expect(cli.exitSpy).toHaveBeenCalledWith(1);
    });

    test('requires body content', async () => {
      const cli = await loadCli();

      await cli.run(['update', '555', '--title', 'New', '--format', 'markdown', '--front-matter']);

      expect(cli.exitSpy).toHaveBeenCalledWith(1);
      expect(cli.stderr()).toMatch(/--front-matter requires --file or --content/);
      expect(cli.client.updatePage).not.toHaveBeenCalled();
    });

    test('create-child applies properties to the new child page', async () => {
      const cli = await loadCli();

      await cli.run(['create-child', 'Doc', '100', '--content', FRONT_MATTER_DOC, '--format', 'markdown', '--front-matter']);

      expect(cli.client.createChildPage).toHaveBeenCalledWith('Doc', 'ENG', '100', '# Title\n', 'markdown', 'page');
      expect(cli.client.syncProperties).toHaveBeenCalledWith('555', { 'content-appearance-published': 'full-width' });
      expect(cli.stdout()).toContain('Properties set: content-appearance-published');
    });

    test('text output reports properties that already match', async () => {
      const cli = await loadCli({
        syncProperties: jest.fn(async () => ({ applied: [], unchanged: ['content-appearance-published'], failed: [] })),
      });

      await cli.run(['update', '555', '--content', FRONT_MATTER_DOC, '--format', 'markdown', '--front-matter']);

      expect(cli.exitSpy).not.toHaveBeenCalled();
      expect(cli.stdout()).toContain('Properties unchanged: content-appearance-published');
    });

    test('partial failure in text mode reports the saved body and failed keys, then exits non-zero', async () => {
      const cli = await loadCli({
        syncProperties: jest.fn(async () => ({
          applied: ['a'],
          unchanged: [],
          failed: [{ key: 'content-appearance-published', status: 403, error: 'Request failed with status code 403' }],
        })),
      });

      await cli.run(['update', '555', '--content', FRONT_MATTER_DOC, '--format', 'markdown', '--front-matter']);

      expect(cli.stdout()).toContain('Page updated successfully!');
      expect(cli.stdout()).toContain('Properties set: a');
      expect(cli.stderr()).toContain('Page 555 was saved, but 1 content property failed: content-appearance-published (403: Request failed with status code 403)');
      expect(cli.stderr()).toContain('Re-run the same command to retry');
      expect(cli.exitSpy).toHaveBeenCalledWith(1);
    });

    test('partial failure in --json mode prints the result on stdout and a PARTIAL_FAILURE error on stderr', async () => {
      const syncResult = {
        applied: [],
        unchanged: [],
        failed: [{ key: 'content-appearance-published', status: 403, error: 'Request failed with status code 403' }],
      };
      const cli = await loadCli({ syncProperties: jest.fn(async () => syncResult) });

      await cli.run(['--json', 'update', '555', '--content', FRONT_MATTER_DOC, '--format', 'markdown', '--front-matter']);

      expect(JSON.parse(cli.logSpy.mock.calls[0][0])).toMatchObject({ id: '555', version: 2, properties: syncResult });
      const error = JSON.parse(cli.errorSpy.mock.calls[0][0]);
      expect(error).toMatchObject({ code: 'PARTIAL_FAILURE', status: null, details: { properties: syncResult } });
      expect(error.error).toMatch(/Page 555 was saved/);
      expect(cli.exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('read', () => {
    test('prepends the listed properties that exist, in the given order', async () => {
      const cli = await loadCli({
        getPropertyValues: jest.fn(async () => [['content-appearance-published', 'full-width']]),
      });

      await cli.run(['read', '555', '--format', 'markdown', '--front-matter', 'content-appearance-published, missing']);

      expect(cli.client.readPage).toHaveBeenCalledWith('555', 'markdown');
      expect(cli.client.getPropertyValues).toHaveBeenCalledWith('555', ['content-appearance-published', 'missing']);
      expect(cli.logSpy.mock.calls[0][0]).toBe(FRONT_MATTER_DOC);
    });

    test('emits no front matter when none of the keys exist', async () => {
      const cli = await loadCli();

      await cli.run(['read', '555', '--format', 'markdown', '--front-matter', 'missing']);

      expect(cli.logSpy.mock.calls[0][0]).toBe('# Title\n');
    });

    test('requires --format markdown', async () => {
      const cli = await loadCli();

      await cli.run(['read', '555', '--front-matter', 'content-appearance-published']);

      expect(cli.exitSpy).toHaveBeenCalledWith(1);
      expect(cli.stderr()).toMatch(/--front-matter requires --format markdown/);
      expect(cli.client.readPage).not.toHaveBeenCalled();
    });

    test('read output round-trips through update --front-matter', async () => {
      const properties = { 'content-appearance-published': 'full-width', settings: { tags: ['a'], note: null } };
      const reader = await loadCli({ getPropertyValues: jest.fn(async () => Object.entries(properties)) });
      await reader.run(['read', '555', '--format', 'markdown', '--front-matter', 'content-appearance-published,settings']);
      const exported = reader.logSpy.mock.calls[0][0];
      jest.restoreAllMocks();

      const writer = await loadCli();
      await writer.run(['update', '555', '--content', exported, '--format', 'markdown', '--front-matter']);

      expect(writer.client.updatePage).toHaveBeenCalledWith('555', undefined, '# Title\n', 'markdown');
      expect(writer.client.syncProperties).toHaveBeenCalledWith('555', properties);
    });
  });
});
