const path = require('path');

// Require the CLI module (guarded by require.main check, won't parse argv)
const {
  _test: {
    EXPORT_MARKER,
    writeExportMarker,
    isExportDirectory,
    uniquePathFor,
    exportRecursive,
    sanitizeTitle,
  },
} = require('../bin/confluence.js');

// ---------------------------------------------------------------------------
// Helpers: in-memory fs mock
// ---------------------------------------------------------------------------
function createMockFs(files = {}) {
  const store = { ...files };
  return {
    _store: store,
    existsSync(p) {
      return Object.prototype.hasOwnProperty.call(store, p);
    },
    mkdirSync() {},
    writeFileSync(p, data) {
      store[p] = data;
    },
    rmSync(p) {
      for (const key of Object.keys(store)) {
        if (key === p || key.startsWith(p + '/') || key.startsWith(p + path.sep)) {
          delete store[key];
        }
      }
    },
    createWriteStream() {
      // Return a minimal writable for attachment download mocks
      const { PassThrough } = require('stream');
      const pt = new PassThrough();
      pt.on('data', () => {});
      return pt;
    },
  };
}

function createMockClient(overrides = {}) {
  return {
    getPageInfo: jest.fn(async (id) => ({ id, title: `Page ${id}` })),
    readPage: jest.fn(async () => '# content'),
    getAllDescendantPages: jest.fn(async () => []),
    getAllAttachments: jest.fn(async () => []),
    downloadAttachment: jest.fn(async () => {
      const { PassThrough } = require('stream');
      const s = new PassThrough();
      s.end('data');
      return s;
    }),
    shouldExcludePage: jest.fn((title, patterns) =>
      patterns.some((p) => title.toLowerCase().includes(p.toLowerCase()))
    ),
    buildPageTree: jest.fn((pages) =>
      pages
        .filter((p) => p.parentId === '1')
        .map((p) => ({ ...p, children: [] }))
    ),
    matchesPattern: jest.fn(() => true),
    _referencedAttachments: new Set(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// writeExportMarker / isExportDirectory
// ---------------------------------------------------------------------------
describe('writeExportMarker', () => {
  test('writes marker JSON into the export directory', () => {
    const fs = createMockFs();
    writeExportMarker(fs, path, '/export/dir', { pageId: '42', title: 'My Page' });

    const markerPath = path.join('/export/dir', EXPORT_MARKER);
    expect(fs._store[markerPath]).toBeDefined();

    const parsed = JSON.parse(fs._store[markerPath]);
    expect(parsed.pageId).toBe('42');
    expect(parsed.title).toBe('My Page');
    expect(parsed.tool).toBe('confluence-cli');
    expect(parsed.exportedAt).toBeDefined();
  });
});

describe('isExportDirectory', () => {
  test('returns true when marker file exists', () => {
    const markerPath = path.join('/export/dir', EXPORT_MARKER);
    const fs = createMockFs({ [markerPath]: '{}' });
    expect(isExportDirectory(fs, path, '/export/dir')).toBe(true);
  });

  test('returns false when marker file is missing', () => {
    const fs = createMockFs();
    expect(isExportDirectory(fs, path, '/export/dir')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// uniquePathFor
// ---------------------------------------------------------------------------
describe('uniquePathFor', () => {
  test('returns original path when no conflict', () => {
    const fs = createMockFs();
    const result = uniquePathFor(fs, path, '/dir', 'file.png');
    expect(result).toBe(path.join('/dir', 'file.png'));
  });

  test('appends counter when file exists', () => {
    const fs = createMockFs({ [path.join('/dir', 'file.png')]: 'data' });
    const result = uniquePathFor(fs, path, '/dir', 'file.png');
    expect(result).toBe(path.join('/dir', 'file (1).png'));
  });
});

// ---------------------------------------------------------------------------
// exportRecursive
// ---------------------------------------------------------------------------
describe('exportRecursive', () => {
  let client;
  let fs;

  beforeEach(() => {
    client = createMockClient({
      getPageInfo: jest.fn(async () => ({ id: '1', title: 'Root' })),
      getAllDescendantPages: jest.fn(async () => [
        { id: '2', title: 'Child A', parentId: '1' },
        { id: '3', title: 'Child B', parentId: '1' },
      ]),
      buildPageTree: jest.fn((pages) =>
        pages
          .filter((p) => p.parentId === '1')
          .map((p) => ({ ...p, children: [] }))
      ),
    });
    fs = createMockFs();
  });

  test('dry-run prints tree without writing files', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await exportRecursive(client, fs, path, '1', {
      dest: '/tmp/out',
      dryRun: true,
      delayMs: 0,
      skipAttachments: true,
    });

    // No files written (only mock fs store entries would exist from writeFileSync)
    expect(Object.keys(fs._store).length).toBe(0);
    // readPage should not have been called
    expect(client.readPage).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  test('overwrite succeeds when marker file is present', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const rootExportDir = path.join(path.resolve('/tmp/out'), 'Root');
    const markerPath = path.join(rootExportDir, EXPORT_MARKER);
    // Pre-populate the directory with a marker file
    fs._store[rootExportDir] = true;
    fs._store[markerPath] = '{}';

    await exportRecursive(client, fs, path, '1', {
      dest: '/tmp/out',
      overwrite: true,
      delayMs: 0,
      skipAttachments: true,
    });

    // Should have exported pages (readPage called for root + 2 children)
    expect(client.readPage).toHaveBeenCalledTimes(3);

    consoleSpy.mockRestore();
  });

  test('overwrite throws when marker file is missing', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const rootExportDir = path.join(path.resolve('/tmp/out'), 'Root');
    // Directory exists but without marker
    fs._store[rootExportDir] = true;

    await expect(
      exportRecursive(client, fs, path, '1', {
        dest: '/tmp/out',
        overwrite: true,
        delayMs: 0,
        skipAttachments: true,
      })
    ).rejects.toThrow(/Refusing to overwrite/);

    consoleSpy.mockRestore();
  });

  test('exclude filtering removes matching pages', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await exportRecursive(client, fs, path, '1', {
      dest: '/tmp/out',
      exclude: 'Child B',
      dryRun: true,
      delayMs: 0,
      skipAttachments: true,
    });

    // shouldExcludePage should have been called
    expect(client.shouldExcludePage).toHaveBeenCalled();
    // buildPageTree receives only non-excluded descendants
    const buildTreeArg = client.buildPageTree.mock.calls[0][0];
    const titles = buildTreeArg.map((p) => p.title);
    expect(titles).not.toContain('Child B');

    consoleSpy.mockRestore();
  });

  test('partial failures are captured without aborting', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Make readPage fail for the second child
    let callCount = 0;
    client.readPage.mockImplementation(async (id) => {
      callCount++;
      if (id === '3') throw new Error('network error');
      return '# content';
    });

    await exportRecursive(client, fs, path, '1', {
      dest: '/tmp/out',
      delayMs: 0,
      skipAttachments: true,
    });

    // Should have logged a failure for Child B
    const errorCalls = consoleErrSpy.mock.calls.map((c) => c.join(' '));
    expect(errorCalls.some((msg) => msg.includes('Failed'))).toBe(true);

    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
  });

  test('writes marker file into root export directory', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Use a simple single-page export (no descendants)
    client.getAllDescendantPages.mockResolvedValue([]);
    client.buildPageTree.mockReturnValue([]);

    await exportRecursive(client, fs, path, '1', {
      dest: '/tmp/out',
      delayMs: 0,
      skipAttachments: true,
    });

    const rootExportDir = path.join(path.resolve('/tmp/out'), 'Root');
    const markerPath = path.join(rootExportDir, EXPORT_MARKER);
    expect(fs._store[markerPath]).toBeDefined();

    const marker = JSON.parse(fs._store[markerPath]);
    expect(marker.tool).toBe('confluence-cli');
    expect(marker.pageId).toBe('1');

    consoleSpy.mockRestore();
  });
});
