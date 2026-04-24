describe('CLI metadata and storage output', () => {
  function stripAnsi(value) {
    if (typeof value !== 'string') {
      return value;
    }

    let output = '';
    for (let index = 0; index < value.length; index += 1) {
      if (value.charCodeAt(index) === 27 && value[index + 1] === '[') {
        index += 2;
        while (index < value.length && value[index] !== 'm') {
          index += 1;
        }
        continue;
      }
      output += value[index];
    }

    return output;
  }

  async function loadCli(clientOverrides = {}) {
    jest.resetModules();

    const client = {
      readPage: jest.fn(),
      getPageInfo: jest.fn(),
      extractPageId: jest.fn(async (pageId) => String(pageId)),
      getChildPages: jest.fn(),
      getAllDescendantPages: jest.fn(),
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

    return {
      program: cli.program,
      client,
      getConfig,
      track
    };
  }

  async function runCli(program, args) {
    return program.parseAsync(args, { from: 'user' });
  }

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('info --format json prints structured metadata', async () => {
    const { program } = await loadCli({
      getPageInfo: jest.fn(async () => ({
        id: '123',
        title: 'Architecture Overview',
        type: 'page',
        status: 'current',
        space: { key: 'ENG', name: 'Engineering' },
        spaceKey: 'ENG',
        parentId: '100',
        version: 7,
        url: 'https://test.atlassian.net/wiki/spaces/ENG/pages/123/Architecture+Overview',
        ancestors: [{ id: '100', type: 'page', title: 'Parent' }],
        createdAt: '2025-01-01T10:00:00.000Z',
        updatedAt: '2025-01-02T12:00:00.000Z',
        author: { displayName: 'Ada Lovelace' },
        lastUpdatedBy: { displayName: 'Grace Hopper' }
      }))
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(program, ['info', '123', '--format', 'json']);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toMatchObject({
      id: '123',
      title: 'Architecture Overview',
      type: 'page',
      status: 'current',
      space: { key: 'ENG', name: 'Engineering' },
      spaceKey: 'ENG',
      parentId: '100',
      version: 7,
      url: 'https://test.atlassian.net/wiki/spaces/ENG/pages/123/Architecture+Overview'
    });
  });

  test('info default text output remains human-readable', async () => {
    const { program, client } = await loadCli({
      getPageInfo: jest.fn(async () => ({
        id: '123',
        title: 'Architecture Overview',
        type: 'page',
        status: 'current',
        space: { key: 'ENG', name: 'Engineering' }
      }))
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(program, ['info', '123']);

    const lines = logSpy.mock.calls.map((call) => stripAnsi(call[0]));
    expect(lines).toContain('Page Information:');
    expect(lines).toContain('Title: Architecture Overview');
    expect(lines).toContain('ID: 123');
    expect(lines).toContain('Type: page');
    expect(lines).toContain('Status: current');
    expect(lines).toContain('Space: Engineering (ENG)');
    expect(client.getPageInfo).toHaveBeenCalledWith('123');
  });

  test('info exits non-zero on invalid page IDs', async () => {
    const { program } = await loadCli({
      getPageInfo: jest.fn(async () => {
        throw new Error('Page not found');
      })
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    await expect(runCli(program, ['info', '999', '--format', 'json'])).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0].map((value) => stripAnsi(value))).toEqual(['Error:', 'Page not found']);
  });

  test('read --format storage prints storage content', async () => {
    const { program, client } = await loadCli({
      readPage: jest.fn(async () => '<ac:structured-macro ac:name="info" />')
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(program, ['read', '123', '--format', 'storage']);

    expect(client.readPage).toHaveBeenCalledWith('123', 'storage');
    expect(logSpy).toHaveBeenCalledWith('<ac:structured-macro ac:name="info" />');
  });

  test('children --format json returns structured direct children', async () => {
    const { program } = await loadCli({
      getChildPages: jest.fn(async () => ([
        {
          id: '200',
          title: 'Child Page',
          type: 'page',
          status: 'current',
          spaceKey: 'ENG',
          parentId: '123',
          version: 4,
          url: 'https://test.atlassian.net/wiki/spaces/ENG/pages/200/Child+Page',
          depth: 1,
          ancestors: [{ id: '123', type: 'page', title: 'Parent Page' }]
        }
      ]))
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(program, ['children', '123', '--format', 'json']);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output).toEqual({
      pageId: '123',
      childCount: 1,
      children: [
        {
          id: '200',
          title: 'Child Page',
          type: 'page',
          status: 'current',
          spaceKey: 'ENG',
          parentId: '123',
          version: 4,
          url: 'https://test.atlassian.net/wiki/spaces/ENG/pages/200/Child+Page'
        }
      ]
    });
    expect(output.children[0].depth).toBeUndefined();
    expect(output.children[0].ancestors).toBeUndefined();
  });

  test('children --recursive --format json includes depth and ancestors', async () => {
    const getAllDescendantPages = jest.fn(async () => ([
      {
        id: '200',
        title: 'Child Page',
        type: 'page',
        status: 'current',
        spaceKey: 'ENG',
        parentId: '123',
        version: 4,
        depth: 1,
        url: 'https://test.atlassian.net/wiki/spaces/ENG/pages/200/Child+Page',
        ancestors: [{ id: '123', type: 'page', title: 'Parent' }]
      },
      {
        id: '300',
        title: 'Nested Page',
        type: 'page',
        status: 'current',
        spaceKey: 'ENG',
        parentId: '200',
        version: 2,
        depth: 2,
        url: 'https://test.atlassian.net/wiki/spaces/ENG/pages/300/Nested+Page',
        ancestors: [
          { id: '123', type: 'page', title: 'Parent' },
          { id: '200', type: 'page', title: 'Child Page' }
        ]
      }
    ]));
    const { program } = await loadCli({
      getAllDescendantPages
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(program, ['children', '123', '--recursive', '--format', 'json']);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.childCount).toBe(2);
    expect(output.children[0]).toMatchObject({
      id: '200',
      depth: 1,
      parentId: '123',
      version: 4,
      ancestors: [{ id: '123', type: 'page', title: 'Parent' }]
    });
    expect(output.children[1]).toMatchObject({
      id: '300',
      depth: 2,
      parentId: '200',
      version: 2,
      ancestors: [
        { id: '123', type: 'page', title: 'Parent' },
        { id: '200', type: 'page', title: 'Child Page' }
      ]
    });
    expect(getAllDescendantPages).toHaveBeenCalledWith('123', 10, { includeAncestors: true });
  });
});
