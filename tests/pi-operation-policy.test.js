const {
  RISK,
  OPERATIONS,
  getOperation,
  listToolNames,
  buildArgs,
} = require('../lib/pi/operation-policy');

const READ_TOOLS = [
  'confluence_read', 'confluence_search', 'confluence_info', 'confluence_spaces',
  'confluence_children', 'confluence_export', 'confluence_convert', 'confluence_find',
  'confluence_versions', 'confluence_comments', 'confluence_attachments',
  'confluence_property_list', 'confluence_property_get',
];
const WRITE_TOOLS = [
  'confluence_create', 'confluence_create_child', 'confluence_update',
  'confluence_move', 'confluence_delete', 'confluence_copy_tree_preview',
  'confluence_copy_tree', 'confluence_comment_create', 'confluence_comment_delete',
  'confluence_property_set', 'confluence_property_delete',
  'confluence_attachment_upload', 'confluence_attachment_delete',
  'confluence_version_delete', 'confluence_versions_purge_preview',
  'confluence_versions_purge',
];

const CASES = [
  {
    toolName: 'confluence_read',
    input: { pageId: '123', format: 'markdown' },
    args: ['read', '123', '--format', 'markdown'],
    meta: { cliCommand: 'read', risk: RISK.READ, timeoutMs: 30_000, mutation: false, expectJson: false },
  },
  {
    toolName: 'confluence_search',
    input: { query: 'release notes', limit: 20, start: 5, cql: true },
    args: ['search', 'release notes', '--limit', '20', '--start', '5', '--cql'],
    meta: { cliCommand: 'search', risk: RISK.READ, timeoutMs: 30_000, mutation: false, expectJson: false },
  },
  {
    toolName: 'confluence_info',
    input: { pageId: '123' },
    args: ['--json', 'info', '123'],
    meta: { cliCommand: 'info', risk: RISK.READ, timeoutMs: 30_000, mutation: false, expectJson: true },
  },
  {
    toolName: 'confluence_spaces',
    input: { limit: 25 },
    args: ['--json', 'spaces', '--limit', '25'],
    meta: { cliCommand: 'spaces', risk: RISK.READ, timeoutMs: 30_000, mutation: false, expectJson: true },
  },
  {
    toolName: 'confluence_children',
    input: {
      pageId: '123', recursive: true, maxDepth: 3, type: 'all', format: 'tree', showUrl: true, showId: true,
    },
    args: ['--json', 'children', '123', '--recursive', '--max-depth', '3', '--type', 'all', '--format', 'tree', '--show-url', '--show-id'],
    meta: { cliCommand: 'children', risk: RISK.READ, timeoutMs: 30_000, mutation: false, expectJson: true },
  },
  {
    toolName: 'confluence_export',
    input: {
      pageId: '123', destination: 'exports', format: 'markdown', file: 'page.md', recursive: true,
      maxDepth: 2, dryRun: true, referencedOnly: true,
    },
    args: ['export', '123', '--dest', 'exports', '--format', 'markdown', '--skip-attachments', '--file', 'page.md', '--recursive', '--max-depth', '2', '--dry-run', '--referenced-only'],
    meta: { cliCommand: 'export', risk: RISK.READ, timeoutMs: 30_000, mutation: false, expectJson: false },
  },
  {
    toolName: 'confluence_convert',
    input: {
      inputFile: 'input.md', outputFile: 'output.xml', inputFormat: 'markdown', outputFormat: 'storage',
    },
    args: ['convert', '--input-file', 'input.md', '--output-file', 'output.xml', '--input-format', 'markdown', '--output-format', 'storage'],
    meta: { cliCommand: 'convert', risk: RISK.READ, timeoutMs: 30_000, mutation: false, expectJson: false },
  },
  {
    toolName: 'confluence_find',
    input: { title: 'Project Documentation', space: 'MYTEAM' },
    args: ['--json', 'find', 'Project Documentation', '--space', 'MYTEAM'],
    meta: { cliCommand: 'find', risk: RISK.READ, timeoutMs: 30_000, mutation: false, expectJson: true },
  },
  {
    toolName: 'confluence_versions',
    input: { pageId: '123' },
    args: ['--json', 'versions', '123'],
    meta: { cliCommand: 'versions', risk: RISK.READ, timeoutMs: 30_000, mutation: false, expectJson: true },
  },
  {
    toolName: 'confluence_comments',
    input: { pageId: '123', limit: 12, start: 3, location: 'inline,footer', depth: 'all', all: true },
    args: ['--json', 'comments', '123', '--limit', '12', '--start', '3', '--location', 'inline,footer', '--depth', 'all', '--all'],
    meta: { cliCommand: 'comments', risk: RISK.READ, timeoutMs: 30_000, mutation: false, expectJson: true },
  },
  {
    toolName: 'confluence_attachments',
    input: { pageId: '123', limit: 5, pattern: '*.png', download: true, destination: 'downloads' },
    args: ['--json', 'attachments', '123', '--limit', '5', '--pattern', '*.png', '--download', '--dest', 'downloads'],
    meta: { cliCommand: 'attachments', risk: RISK.READ, timeoutMs: 30_000, mutation: false, expectJson: true },
  },
  {
    toolName: 'confluence_property_list',
    input: { pageId: '123', start: 7, limit: 10, all: true },
    args: ['--json', 'property-list', '123', '--start', '7', '--limit', '10', '--all'],
    meta: { cliCommand: 'property-list', risk: RISK.READ, timeoutMs: 30_000, mutation: false, expectJson: true },
  },
  {
    toolName: 'confluence_property_get',
    input: { pageId: '123', key: 'my-key' },
    args: ['--json', 'property-get', '123', 'my-key'],
    meta: { cliCommand: 'property-get', risk: RISK.READ, timeoutMs: 30_000, mutation: false, expectJson: true },
  },
  {
    toolName: 'confluence_create',
    input: { title: 'My Page', spaceKey: 'ENG', content: 'Hello', format: 'markdown', type: 'page' },
    args: ['--json', 'create', 'My Page', 'ENG', '--content', 'Hello', '--format', 'markdown', '--type', 'page'],
    meta: { cliCommand: 'create', risk: RISK.WRITE, timeoutMs: 30_000, mutation: true, expectJson: true },
  },
  {
    toolName: 'confluence_create_child',
    input: { title: 'My Folder', parentId: '123', contentFile: 'content.md', format: 'markdown', type: 'folder' },
    args: ['--json', 'create-child', 'My Folder', '123', '--file', 'content.md', '--format', 'markdown', '--type', 'folder'],
    meta: { cliCommand: 'create-child', risk: RISK.WRITE, timeoutMs: 30_000, mutation: true, expectJson: true },
  },
  {
    toolName: 'confluence_update',
    input: { pageId: '123', title: 'Updated Title', contentFile: 'updated.md', format: 'markdown' },
    args: ['--json', 'update', '123', '--title', 'Updated Title', '--file', 'updated.md', '--format', 'markdown'],
    meta: { cliCommand: 'update', risk: RISK.WRITE, timeoutMs: 30_000, mutation: true, expectJson: true },
  },
  {
    toolName: 'confluence_move',
    input: { pageId: '123', newParentId: '456', title: 'Relocated Title' },
    args: ['--json', 'move', '123', '456', '--title', 'Relocated Title'],
    meta: { cliCommand: 'move', risk: RISK.WRITE, timeoutMs: 30_000, mutation: true, expectJson: true },
  },
  {
    toolName: 'confluence_delete',
    input: { pageId: '123' },
    args: ['--json', 'delete', '123', '--yes'],
    meta: { cliCommand: 'delete', risk: RISK.DESTRUCTIVE, timeoutMs: 30_000, mutation: true, expectJson: true },
  },
  {
    toolName: 'confluence_copy_tree_preview',
    input: { sourcePageId: '123', targetParentId: '456', title: 'Project Copy', maxDepth: 3, exclude: 'temp*,draft*', delayMs: 150, copySuffix: ' (Backup)' },
    args: ['--json', 'copy-tree', '123', '456', 'Project Copy', '--max-depth', '3', '--exclude', 'temp*,draft*', '--delay-ms', '150', '--copy-suffix', ' (Backup)', '--dry-run', '--quiet'],
    meta: { cliCommand: 'copy-tree', risk: RISK.BULK_PREVIEW, timeoutMs: 30_000, mutation: false, expectJson: true },
  },
  {
    toolName: 'confluence_copy_tree',
    input: { sourcePageId: '123', targetParentId: '456', maxDepth: 3, exclude: 'temp*,draft*', delayMs: 150, copySuffix: ' (Backup)' },
    args: ['--json', 'copy-tree', '123', '456', '--max-depth', '3', '--exclude', 'temp*,draft*', '--delay-ms', '150', '--copy-suffix', ' (Backup)', '--quiet'],
    meta: { cliCommand: 'copy-tree', risk: RISK.BULK_WRITE, timeoutMs: 300_000, mutation: true, expectJson: true },
  },
  {
    toolName: 'confluence_comment_create',
    input: {
      pageId: '123',
      contentFile: 'comment.md',
      format: 'markdown',
      parent: '998877',
      location: 'inline',
      inlineSelection: 'foo',
      inlineOriginalSelection: 'foo',
      inlineMarkerRef: 'marker-1',
      inlineProperties: { matchIndex: 1, lastFetchTime: 2, serializedHighlights: 'abc' },
    },
    args: [
      '--json', 'comment', '123', '--file', 'comment.md', '--format', 'markdown', '--parent', '998877', '--location', 'inline',
      '--inline-selection', 'foo', '--inline-original-selection', 'foo', '--inline-marker-ref', 'marker-1',
      '--inline-properties', '{"matchIndex":1,"lastFetchTime":2,"serializedHighlights":"abc"}',
    ],
    meta: { cliCommand: 'comment', risk: RISK.WRITE, timeoutMs: 30_000, mutation: true, expectJson: true },
  },
  {
    toolName: 'confluence_comment_delete',
    input: { commentId: '998877' },
    args: ['--json', 'comment-delete', '998877', '--yes'],
    meta: { cliCommand: 'comment-delete', risk: RISK.DESTRUCTIVE, timeoutMs: 30_000, mutation: true, expectJson: true },
  },
  {
    toolName: 'confluence_property_set',
    input: { pageId: '123', key: 'my-key', value: { color: '#ff0000' } },
    args: ['--json', 'property-set', '123', 'my-key', '--value', '{"color":"#ff0000"}'],
    meta: { cliCommand: 'property-set', risk: RISK.WRITE, timeoutMs: 30_000, mutation: true, expectJson: true },
  },
  {
    toolName: 'confluence_property_delete',
    input: { pageId: '123', key: 'my-key' },
    args: ['--json', 'property-delete', '123', 'my-key', '--yes'],
    meta: { cliCommand: 'property-delete', risk: RISK.DESTRUCTIVE, timeoutMs: 30_000, mutation: true, expectJson: true },
  },
  {
    toolName: 'confluence_attachment_upload',
    input: { pageId: '123', files: ['a.pdf', 'b.png'], comment: 'v2', replace: true, minorEdit: true },
    args: ['--json', 'attachment-upload', '123', '--file', 'a.pdf', '--file', 'b.png', '--comment', 'v2', '--replace', '--minor-edit'],
    meta: { cliCommand: 'attachment-upload', risk: RISK.WRITE, timeoutMs: 120_000, mutation: true, expectJson: true },
  },
  {
    toolName: 'confluence_attachment_delete',
    input: { pageId: '123', attachmentId: '456' },
    args: ['--json', 'attachment-delete', '123', '456', '--yes'],
    meta: { cliCommand: 'attachment-delete', risk: RISK.DESTRUCTIVE, timeoutMs: 30_000, mutation: true, expectJson: true },
  },
  {
    toolName: 'confluence_version_delete',
    input: { pageId: '123', versionNumber: 7 },
    args: ['--json', 'version-delete', '123', '7', '--yes'],
    meta: { cliCommand: 'version-delete', risk: RISK.DESTRUCTIVE, timeoutMs: 30_000, mutation: true, expectJson: true },
  },
  {
    toolName: 'confluence_versions_purge_preview',
    input: { pageId: '123', throttle: 0.25 },
    args: ['--json', 'versions', '123'],
    meta: { cliCommand: 'versions', risk: RISK.BULK_PREVIEW, timeoutMs: 30_000, mutation: false, expectJson: true },
  },
  {
    toolName: 'confluence_versions_purge',
    input: { pageId: '123', throttle: 0.5 },
    args: ['--json', 'versions-purge', '123', '--yes', '--throttle', '0.5'],
    meta: { cliCommand: 'versions-purge', risk: RISK.BULK_WRITE, timeoutMs: 300_000, mutation: true, expectJson: true },
  },
];

test('lists the exact allowed tool surface', () => {
  expect(listToolNames({ includeWrites: false })).toEqual(READ_TOOLS);
  expect(listToolNames({ includeWrites: true })).toEqual([...READ_TOOLS, ...WRITE_TOOLS]);
  expect(OPERATIONS.confluence_api).toBeUndefined();
  expect(() => getOperation('confluence_api')).toThrow(/not allowed/i);
  expect(() => buildArgs('confluence_api', {})).toThrow(/not allowed/i);
  expect(() => getOperation('__proto__')).toThrow(/not allowed/i);
  expect(() => getOperation('constructor')).toThrow(/not allowed/i);
  expect(RISK).toEqual({
    READ: 'read', WRITE: 'write', DESTRUCTIVE: 'destructive',
    BULK_PREVIEW: 'bulk-preview', BULK_WRITE: 'bulk-write',
  });
});

test('uses the exact copy-tree timeout', () => {
  expect(getOperation('confluence_copy_tree').timeoutMs).toBe(300_000);
  expect(getOperation('confluence_copy_tree_preview').timeoutMs).toBe(30_000);
});

test.each(CASES)('$toolName maps to fixed policy metadata and argv', ({ toolName, input, args, meta }) => {
  const operation = getOperation(toolName);

  expect(operation).toMatchObject({ toolName, ...meta });
  expect(OPERATIONS[toolName]).toBe(operation);
  expect(operation.buildArgs(input)).toEqual(args);
  expect(buildArgs(toolName, input)).toEqual(args);
});

test('ignores model-provided yes, argv, and api fields', () => {
  expect(buildArgs('confluence_find', {
    title: 'Project Documentation',
    space: 'MYTEAM',
    yes: true,
    argv: ['--yes', '--json'],
    api: 'confluence_api',
  })).toEqual(['--json', 'find', 'Project Documentation', '--space', 'MYTEAM']);
});

test.each([
  {
    toolName: 'confluence_create',
    input: { title: 'New Page', spaceKey: 'ENG', contentFile: 'body.md', format: 'markdown', type: 'page' },
    args: ['--json', 'create', 'New Page', 'ENG', '--file', 'body.md', '--format', 'markdown', '--type', 'page'],
  },
  {
    toolName: 'confluence_update',
    input: { pageId: '123', title: 'Changed Title', content: 'Updated body', format: 'storage' },
    args: ['--json', 'update', '123', '--title', 'Changed Title', '--content', 'Updated body', '--format', 'storage'],
  },
  {
    toolName: 'confluence_comment_create',
    input: { pageId: '123', content: 'Looks good', format: 'storage', location: 'footer' },
    args: ['--json', 'comment', '123', '--content', 'Looks good', '--format', 'storage', '--location', 'footer'],
  },
  {
    toolName: 'confluence_property_set',
    input: { pageId: '123', key: 'my-key', valueFile: 'value.json' },
    args: ['--json', 'property-set', '123', 'my-key', '--file', 'value.json'],
  },
  {
    toolName: 'confluence_attachment_upload',
    input: { pageId: '123', file: 'single.pdf' },
    args: ['--json', 'attachment-upload', '123', '--file', 'single.pdf'],
  },
])('supports alternate normalized inputs for $toolName', ({ toolName, input, args }) => {
  expect(buildArgs(toolName, input)).toEqual(args);
});
