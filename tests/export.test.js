const fs = require('fs');
const os = require('os');
const path = require('path');
const { Command } = require('commander');
const { PassThrough } = require('stream');

const {
  EXPORT_MARKER,
  writeExportMarker,
  isExportDirectory,
  uniquePathFor,
  exportRecursive,
  sanitizeTitle,
  filterAttachments,
} = require('../bin/commands/export.js');
const { sanitizeFilename } = require('../lib/file-utils');

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

  test('strips directory traversal from filename before joining', () => {
    const fs = createMockFs();
    const result = uniquePathFor(fs, path, '/dir', '../../etc/passwd');
    expect(result).toBe(path.join('/dir', 'passwd'));
  });

  test('strips windows-style directory traversal', () => {
    const fs = createMockFs();
    const result = uniquePathFor(fs, path, '/dir', '..\\..\\windows\\system.ini');
    expect(result).toBe(path.join('/dir', 'system.ini'));
  });
});

// ---------------------------------------------------------------------------
// sanitizeFilename
// ---------------------------------------------------------------------------
describe('sanitizeFilename', () => {
  test('returns unnamed for null/undefined/non-string input', () => {
    expect(sanitizeFilename(null)).toBe('unnamed');
    expect(sanitizeFilename(undefined)).toBe('unnamed');
    expect(sanitizeFilename(42)).toBe('unnamed');
    expect(sanitizeFilename('')).toBe('unnamed');
  });

  test('preserves ordinary filenames', () => {
    expect(sanitizeFilename('report.pdf')).toBe('report.pdf');
    expect(sanitizeFilename('design notes.md')).toBe('design notes.md');
  });

  test('strips path components (posix)', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('/abs/path/file.txt')).toBe('file.txt');
  });

  test('strips path components (windows-style)', () => {
    expect(sanitizeFilename('..\\..\\system.ini')).toBe('system.ini');
    expect(sanitizeFilename('C:\\Users\\x\\doc.txt')).toBe('doc.txt');
  });

  test('defeats single-pass regex bypass like ".a."', () => {
    expect(sanitizeFilename('.a.')).toBe('a.');
    expect(sanitizeFilename('....')).toBe('unnamed');
    expect(sanitizeFilename('.../foo')).toBe('foo');
  });

  test('replaces reserved filesystem characters', () => {
    expect(sanitizeFilename('a:b?c*d"e<f>g|h.txt')).toBe('a_b_c_d_e_f_g_h.txt');
  });

  test('strips leading dots so hidden files cannot be created', () => {
    expect(sanitizeFilename('.bashrc')).toBe('bashrc');
  });

  test('falls back when sanitization leaves empty string', () => {
    expect(sanitizeFilename('..')).toBe('unnamed');
    expect(sanitizeFilename('   ')).toBe('unnamed');
  });
});

// ---------------------------------------------------------------------------
// sanitizeTitle
// ---------------------------------------------------------------------------
describe('sanitizeTitle', () => {
  test('returns "page" fallback for invalid input', () => {
    expect(sanitizeTitle(null)).toBe('page');
    expect(sanitizeTitle('')).toBe('page');
    expect(sanitizeTitle(0)).toBe('page');
  });

  test('preserves ordinary titles unchanged', () => {
    expect(sanitizeTitle('Architecture Decisions')).toBe('Architecture Decisions');
  });

  test('replaces reserved chars with space (backward compatible)', () => {
    expect(sanitizeTitle('Foo/Bar:Baz')).toBe('Foo Bar Baz');
    expect(sanitizeTitle('a<b>c|d"e')).toBe('a b c d e');
  });

  test('removes path separators so traversal is impossible after path.join', () => {
    const out = sanitizeTitle('../../etc/passwd');
    expect(out).not.toMatch(/[\\/]/);
    expect(path.join('/safe', out).startsWith('/safe/')).toBe(true);
  });

  test('handles windows-style separators too', () => {
    const out = sanitizeTitle('..\\..\\etc\\passwd');
    expect(out).not.toMatch(/[\\/]/);
  });

  test('strips leading dots so hidden export dirs cannot be created', () => {
    expect(sanitizeTitle('.hidden')).toBe('hidden');
    expect(sanitizeTitle('..')).toBe('page');
  });

  test('strips control characters', () => {
    expect(sanitizeTitle('foo\x00bar')).toBe('foo bar');
  });
});

// ---------------------------------------------------------------------------
// Attachment filtering
// ---------------------------------------------------------------------------
describe('filterAttachments', () => {
  const attachments = [
    { id: '1', title: 'video.mp4' },
    { id: '2', title: 'diagram.png' },
    { id: '3', title: 'archive.zip' },
  ];

  function matchesPattern(value, patterns) {
    const list = Array.isArray(patterns) ? patterns : [patterns];
    return list.some((pattern) => {
      if (pattern === '*') return true;
      if (pattern === '*.mp4') return value.toLowerCase().endsWith('.mp4');
      if (pattern === '*.png') return value.toLowerCase().endsWith('.png');
      if (pattern === '*.zip') return value.toLowerCase().endsWith('.zip');
      return value.toLowerCase() === pattern.toLowerCase();
    });
  }

  test('preserves existing behavior when no attachment exclusions are provided', () => {
    const client = { matchesPattern: jest.fn(matchesPattern) };

    expect(filterAttachments(client, attachments, {})).toEqual(attachments);
  });

  test('ignores empty attachment exclusion patterns', () => {
    const client = { matchesPattern: jest.fn(matchesPattern) };

    expect(filterAttachments(client, attachments, {
      excludeAttachments: ' ,  , ',
    })).toEqual(attachments);
  });

  test('applies attachment exclusions after an include pattern', () => {
    const client = { matchesPattern: jest.fn(matchesPattern) };

    const filtered = filterAttachments(client, attachments, {
      pattern: '*',
      excludeAttachments: '*.mp4, *.zip',
    });

    expect(filtered).toEqual([{ id: '2', title: 'diagram.png' }]);
  });

  test('applies attachment exclusions after referenced-only filtering', () => {
    const client = { matchesPattern: jest.fn(matchesPattern) };
    const referenced = new Set(['video.mp4', 'diagram.png']);

    const filtered = filterAttachments(client, attachments, {
      referencedOnly: true,
      excludeAttachments: '*.mp4',
    }, referenced);

    expect(filtered).toEqual([{ id: '2', title: 'diagram.png' }]);
  });

  test('supports multiple comma-separated exclusion patterns', () => {
    const client = { matchesPattern: jest.fn(matchesPattern) };

    const filtered = filterAttachments(client, attachments, {
      excludeAttachments: '*.mp4, *.zip',
    });

    expect(filtered).toEqual([{ id: '2', title: 'diagram.png' }]);
  });

  test('can exclude every attachment', () => {
    const client = { matchesPattern: jest.fn(matchesPattern) };

    const filtered = filterAttachments(client, attachments, {
      excludeAttachments: '*',
    });

    expect(filtered).toEqual([]);
  });
});

describe('registered non-recursive export command', () => {
  test('dry-run avoids reading content, downloading attachments, and creating export artifacts', async () => {
    const client = {
      getPageInfo: jest.fn(async () => ({ id: '123', title: 'Dry Run Page' })),
      readPage: jest.fn(async () => '# content'),
      getAllAttachments: jest.fn(async () => [{ id: 'attachment-1', title: 'diagram.png' }]),
      downloadAttachment: jest.fn(async () => {
        const stream = new PassThrough();
        stream.end('attachment');
        return stream;
      }),
      matchesPattern: jest.fn(() => true),
      _referencedAttachments: new Set(),
    };
    const analytics = { track: jest.fn() };
    const program = new Command();
    const registerExportCommand = require('../bin/commands/export.js');
    registerExportCommand(program, {
      withClient: (_command, handler) => async (...args) => handler({ client, analytics }, ...args),
    });
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-export-dry-run-'));
    const destination = path.join(temporaryRoot, 'destination');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await program.parseAsync(['export', '123', '--dest', destination, '--dry-run'], { from: 'user' });

      expect(client.readPage).not.toHaveBeenCalled();
      expect(client.downloadAttachment).not.toHaveBeenCalled();
      expect(fs.existsSync(destination)).toBe(false);
      expect(fs.existsSync(path.join(destination, 'Dry Run Page', EXPORT_MARKER))).toBe(false);
    } finally {
      logSpy.mockRestore();
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('exclude-attachments skips matching downloads without affecting other attachments', async () => {
    const attachments = [
      { id: 'attachment-1', title: 'video.mp4' },
      { id: 'attachment-2', title: 'diagram.png' },
      { id: 'attachment-3', title: 'recording.MOV' },
    ];
    const client = {
      getPageInfo: jest.fn(async () => ({ id: '123', title: 'Export Page' })),
      readPage: jest.fn(async () => '# content'),
      getAllAttachments: jest.fn(async () => attachments),
      downloadAttachment: jest.fn(async () => {
        const stream = new PassThrough();
        stream.end('attachment');
        return stream;
      }),
      matchesPattern: jest.fn((value, patterns) => {
        const list = Array.isArray(patterns) ? patterns : [patterns];
        return list.some((pattern) => {
          if (pattern === '*.mp4') return value.toLowerCase().endsWith('.mp4');
          if (pattern === '*.mov') return value.toLowerCase().endsWith('.mov');
          return false;
        });
      }),
      _referencedAttachments: new Set(),
    };
    const analytics = { track: jest.fn() };
    const program = new Command();
    const registerExportCommand = require('../bin/commands/export.js');
    registerExportCommand(program, {
      withClient: (_command, handler) => async (...args) => handler({ client, analytics }, ...args),
    });
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-export-exclude-'));
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await program.parseAsync([
        'export',
        '123',
        '--dest', temporaryRoot,
        '--exclude-attachments', '*.mp4, *.mov',
      ], { from: 'user' });

      expect(client.getAllAttachments).toHaveBeenCalledWith('123');
      expect(client.downloadAttachment).toHaveBeenCalledTimes(1);
      expect(client.downloadAttachment).toHaveBeenCalledWith('123', attachments[1]);
      expect(fs.existsSync(path.join(temporaryRoot, 'Export Page', 'attachments', 'diagram.png'))).toBe(true);
      expect(fs.existsSync(path.join(temporaryRoot, 'Export Page', 'attachments', 'video.mp4'))).toBe(false);
      expect(fs.existsSync(path.join(temporaryRoot, 'Export Page', 'attachments', 'recording.MOV'))).toBe(false);
    } finally {
      logSpy.mockRestore();
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('skip-attachments still bypasses attachment listing when exclusions are also provided', async () => {
    const client = {
      getPageInfo: jest.fn(async () => ({ id: '123', title: 'Export Page' })),
      readPage: jest.fn(async () => '# content'),
      getAllAttachments: jest.fn(async () => []),
      downloadAttachment: jest.fn(),
      matchesPattern: jest.fn(),
      _referencedAttachments: new Set(),
    };
    const analytics = { track: jest.fn() };
    const program = new Command();
    const registerExportCommand = require('../bin/commands/export.js');
    registerExportCommand(program, {
      withClient: (_command, handler) => async (...args) => handler({ client, analytics }, ...args),
    });
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-export-skip-'));
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await program.parseAsync([
        'export',
        '123',
        '--dest', temporaryRoot,
        '--skip-attachments',
        '--exclude-attachments', '*.mp4',
      ], { from: 'user' });

      expect(client.getAllAttachments).not.toHaveBeenCalled();
      expect(client.downloadAttachment).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
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
    client.readPage.mockImplementation(async (id) => {
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

  test('exclude-attachments applies during recursive export', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    client.getAllDescendantPages.mockResolvedValue([]);
    client.buildPageTree.mockReturnValue([]);
    client.getAllAttachments.mockResolvedValue([
      { id: 'attachment-1', title: 'video.mp4' },
      { id: 'attachment-2', title: 'diagram.png' },
    ]);
    client.matchesPattern.mockImplementation((value, patterns) => {
      const list = Array.isArray(patterns) ? patterns : [patterns];
      return list.some(pattern => pattern === '*.mp4' && value.toLowerCase().endsWith('.mp4'));
    });

    await exportRecursive(client, fs, path, '1', {
      dest: '/tmp/out',
      delayMs: 0,
      excludeAttachments: '*.mp4',
    });

    expect(client.downloadAttachment).toHaveBeenCalledTimes(1);
    expect(client.downloadAttachment).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ title: 'diagram.png' })
    );

    consoleSpy.mockRestore();
  });
});
