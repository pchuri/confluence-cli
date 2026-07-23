describe('Global --json output flag', () => {
  async function loadCli(clientOverrides = {}) {
    jest.resetModules();

    const client = {
      readPage: jest.fn(),
      getPageInfo: jest.fn(),
      extractPageId: jest.fn(async (pageId) => String(pageId)),
      search: jest.fn(),
      getSpaces: jest.fn(),
      findPageByTitle: jest.fn(),
      buildUrl: jest.fn((value) => value),
      webUrlPrefix: '/wiki',
      ...clientOverrides
    };

    const ConfluenceClient = jest.fn(() => client);
    const getConfig = jest.fn(() => ({
      domain: 'test.atlassian.net',
      token: 'test-token'
    }));
    const track = jest.fn();

    jest.doMock('../lib/confluence-client', () => ConfluenceClient);
    jest.doMock('../lib/config', () => ({
      getConfig,
      initConfig: jest.fn(),
      listProfiles: jest.fn(),
      setActiveProfile: jest.fn(),
      deleteProfile: jest.fn(),
      isValidProfileName: jest.fn(() => true)
    }));
    jest.doMock('../lib/analytics', () => {
      return class Analytics {
        track(...args) {
          track(...args);
        }
      };
    });

    let cli;
    jest.isolateModules(() => {
      cli = require('../bin/confluence.js');
    });

    return { program: cli.program, client, getConfig, track };
  }

  async function runCli(program, args) {
    return program.parseAsync(args, { from: 'user' });
  }

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('info --json prints structured metadata with no deprecation warning', async () => {
    const { program } = await loadCli({
      getPageInfo: jest.fn(async () => ({
        id: '123', title: 'Page', type: 'page', status: 'current',
        space: { key: 'ENG', name: 'Engineering' }
      }))
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await runCli(program, ['info', '123', '--json']);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toMatchObject({ id: '123', title: 'Page' });
    const warned = errSpy.mock.calls.some(call => String(call[0]).includes('deprecated'));
    expect(warned).toBe(false);
  });

  test('info --format json still works but warns on stderr (deprecated), stdout stays clean JSON', async () => {
    const { program } = await loadCli({
      getPageInfo: jest.fn(async () => ({ id: '123', title: 'Page' }))
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await runCli(program, ['info', '123', '--format', 'json']);

    // stdout: the very first console.log is valid, parseable JSON (no preamble)
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toMatchObject({ id: '123', title: 'Page' });
    // stderr: a deprecation warning pointing at --json
    const warning = errSpy.mock.calls.map(c => String(c[0])).find(m => m.includes('deprecated'));
    expect(warning).toBeDefined();
    expect(warning).toContain('--json');
  });

  test('search --json wraps results with a count', async () => {
    const { program } = await loadCli({
      search: jest.fn(async () => [
        { id: '1', title: 'Alpha' },
        { id: '2', title: 'Beta' }
      ])
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(program, ['search', 'hello', '--json']);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toMatchObject({ query: 'hello', resultCount: 2 });
    expect(output.results).toHaveLength(2);
  });

  test('search --json emits an empty result set cleanly (no "No results" preamble)', async () => {
    const { program } = await loadCli({ search: jest.fn(async () => []) });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(program, ['search', 'nothing', '--json']);

    expect(logSpy.mock.calls).toHaveLength(1);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toMatchObject({ resultCount: 0, results: [] });
  });

  test('spaces --json wraps spaces with a count', async () => {
    const { program } = await loadCli({
      getSpaces: jest.fn(async () => [{ key: 'ENG', name: 'Engineering' }])
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(program, ['spaces', '--json']);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toMatchObject({ spaceCount: 1 });
    expect(output.spaces[0]).toMatchObject({ key: 'ENG' });
  });

  test('--json on an unsupported command fails loudly instead of being silently ignored', async () => {
    const { program } = await loadCli();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    await expect(runCli(program, ['read', '123', '--json'])).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const msg = errSpy.mock.calls.map(c => String(c[0])).find(m => m.includes('--json'));
    expect(msg).toContain('not supported');
  });

  test('find --json prints the page object directly', async () => {
    const { program } = await loadCli({
      findPageByTitle: jest.fn(async () => ({
        id: '999', title: 'Found', space: { key: 'ENG', name: 'Engineering' }, url: '/x'
      }))
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(program, ['find', 'Found', '--json']);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toMatchObject({ id: '999', title: 'Found' });
  });

  test('create --json emits the created page as JSON', async () => {
    const { program } = await loadCli({
      createPage: jest.fn(async () => ({
        id: '500', title: 'New Page',
        space: { key: 'ENG', name: 'Engineering' },
        _links: { webui: '/pages/500' },
      })),
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(program, ['create', 'New Page', 'ENG', '--content', 'hi', '--json']);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toMatchObject({ id: '500', title: 'New Page', type: 'page', spaceKey: 'ENG' });
  });

  test('delete --yes --json emits a deletion confirmation as JSON', async () => {
    const { program } = await loadCli({
      getPageInfo: jest.fn(async () => ({ id: '600', title: 'Doomed', space: { key: 'ENG' } })),
      deletePage: jest.fn(async () => ({ id: '600' })),
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(program, ['delete', '600', '--yes', '--json']);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toEqual({ id: '600', title: 'Doomed', deleted: true });
  });

  test('auth failure under --json emits one structured error object on stderr, nothing on stdout', async () => {
    const authError = Object.assign(new Error('Authentication failed (401 Unauthorized).'), {
      response: { status: 401, data: { message: 'Unauthorized', 'status-code': 401 } },
    });
    const { program } = await loadCli({ search: jest.fn(async () => { throw authError; }) });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(runCli(program, ['search', 'foo', '--json'])).rejects.toThrow('exit');

    // stdout carries no data on failure
    expect(logSpy).not.toHaveBeenCalled();
    // exactly one JSON object on stderr, fully parseable
    expect(errSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(errSpy.mock.calls[0][0]);
    expect(payload).toEqual({
      error: 'Authentication failed (401 Unauthorized).',
      code: 'AUTH_FAILED',
      status: 401,
      details: { message: 'Unauthorized', 'status-code': 401 },
    });
  });

  test('API error with a response body under --json surfaces code, status and details', async () => {
    const apiError = Object.assign(new Error('Request failed with status code 500'), {
      response: { status: 500, data: { message: 'Internal Server Error' } },
    });
    const { program } = await loadCli({ getSpaces: jest.fn(async () => { throw apiError; }) });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(runCli(program, ['spaces', '--json'])).rejects.toThrow('exit');

    const payload = JSON.parse(errSpy.mock.calls[0][0]);
    expect(payload).toMatchObject({
      code: 'API_ERROR',
      status: 500,
      details: { message: 'Internal Server Error' },
    });
  });

  test('validation error (no HTTP response) under --json maps to VALIDATION with null status/details', async () => {
    const { program } = await loadCli({
      getPageInfo: jest.fn(async () => { throw new Error('Page 123 has no readable body.'); }),
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(runCli(program, ['info', '123', '--json'])).rejects.toThrow('exit');

    const payload = JSON.parse(errSpy.mock.calls[0][0]);
    expect(payload).toEqual({
      error: 'Page 123 has no readable body.',
      code: 'VALIDATION',
      status: null,
      details: null,
    });
  });

  test('without --json, failures stay human-readable prose (no JSON emitted)', async () => {
    const authError = Object.assign(new Error('Authentication failed (401 Unauthorized).'), {
      response: { status: 401, data: { message: 'Unauthorized' } },
    });
    const { program } = await loadCli({ search: jest.fn(async () => { throw authError; }) });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(runCli(program, ['search', 'foo'])).rejects.toThrow('exit');

    // First stderr line is the chalk prose "Error:" label + message, not JSON
    const first = errSpy.mock.calls[0];
    expect(String(first[0])).toContain('Error:');
    expect(String(first[1])).toBe('Authentication failed (401 Unauthorized).');
    // Nothing on stderr is a parseable JSON object
    const parsedAny = errSpy.mock.calls.some(c => {
      try { JSON.parse(c[0]); return true; } catch { return false; }
    });
    expect(parsedAny).toBe(false);
  });

  test('delete --json without --yes refuses instead of prompting', async () => {
    const deletePage = jest.fn();
    const { program } = await loadCli({
      getPageInfo: jest.fn(async () => ({ id: '600', title: 'Doomed' })),
      deletePage,
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    await expect(runCli(program, ['delete', '600', '--json'])).rejects.toThrow('process.exit called');
    expect(deletePage).not.toHaveBeenCalled();
    const msg = errSpy.mock.calls.map(c => `${c[0]} ${c[1] ?? ''}`).find(m => /Refusing to delete/.test(m));
    expect(msg).toBeDefined();
  });
});
