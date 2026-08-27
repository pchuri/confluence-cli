const { program } = require('../bin/confluence');
const { buildArgs } = require('../lib/pi/operation-policy');

const INPUTS = Object.freeze({
  confluence_read: { pageId: '123', format: 'markdown' },
  confluence_search: { query: 'release', limit: 10, start: 0, cql: true },
  confluence_info: { pageId: '123' },
  confluence_spaces: { limit: 500 },
  confluence_children: { pageId: '123', recursive: true, maxDepth: 2, type: 'all', format: 'tree', showUrl: true, showId: true },
  confluence_export: { pageId: '123', destination: 'exports', format: 'markdown', file: 'page.md', recursive: true, maxDepth: 2, dryRun: true, referencedOnly: true },
  confluence_convert: { inputFile: 'input.md', outputFile: 'output.xml', inputFormat: 'markdown', outputFormat: 'storage' },
  confluence_find: { title: 'Release Notes', space: 'ENG' },
  confluence_versions: { pageId: '123' },
  confluence_comments: { pageId: '123', limit: 25, start: 0, location: 'footer', depth: 'all', all: true },
  confluence_attachments: { pageId: '123', limit: 5, pattern: '*.png', download: true, destination: 'downloads' },
  confluence_property_list: { pageId: '123', start: 0, limit: 25, all: true },
  confluence_property_get: { pageId: '123', key: 'meta' },
  confluence_create: { title: 'Folder', spaceKey: 'ENG', type: 'folder', format: 'storage' },
  confluence_create_child: { title: 'Child Folder', parentId: '123', type: 'folder', format: 'storage' },
  confluence_update: { pageId: '123', title: 'Updated' },
  confluence_move: { pageId: '123', newParentId: '456', title: 'Moved' },
  confluence_delete: { pageId: '123' },
  confluence_copy_tree_preview: { sourcePageId: '123', targetParentId: '456', title: 'Copy', maxDepth: 2, exclude: 'Draft*', delayMs: 0, copySuffix: ' (Copy)' },
  confluence_copy_tree: { sourcePageId: '123', targetParentId: '456', title: 'Copy', maxDepth: 2, exclude: 'Draft*', delayMs: 0, copySuffix: ' (Copy)' },
  confluence_comment_create: { pageId: '123', content: 'Comment', format: 'storage', parent: '88', location: 'inline' },
  confluence_comment_delete: { commentId: '88' },
  confluence_property_set: { pageId: '123', key: 'meta', value: { ready: true } },
  confluence_property_delete: { pageId: '123', key: 'meta' },
  confluence_attachment_upload: { pageId: '123', files: ['a.txt', 'b.txt'], comment: 'upload', replace: true, minorEdit: true },
  confluence_attachment_delete: { pageId: '123', attachmentId: '99' },
  confluence_version_delete: { pageId: '123', versionNumber: 2 },
  confluence_versions_purge_preview: { pageId: '123' },
  confluence_versions_purge: { pageId: '123', throttle: 0.25 },
});

function parseWithRealCommand(argv) {
  const args = [...argv];
  if (args[0] === '--json') args.shift();
  const commandName = args.shift();
  const command = program.commands.find((candidate) => candidate.name() === commandName);
  if (!command) throw new Error(`Real CLI command not found: ${commandName}`);
  return { commandName, parsed: command.parseOptions(args) };
}

test.each(Object.entries(INPUTS))('%s generated argv is accepted by the real Commander definition', (toolName, input) => {
  const argv = buildArgs(toolName, input);
  const { parsed } = parseWithRealCommand(argv);

  expect(parsed.unknown).toEqual([]);
});

test('bulk copy execution enables real CLI partial-failure signaling', () => {
  const argv = buildArgs('confluence_copy_tree', INPUTS.confluence_copy_tree);
  expect(argv).toContain('--fail-on-error');
  expect(parseWithRealCommand(argv).parsed.unknown).toEqual([]);
});
