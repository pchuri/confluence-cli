const RISK = Object.freeze({
  READ: 'read',
  WRITE: 'write',
  DESTRUCTIVE: 'destructive',
  BULK_PREVIEW: 'bulk-preview',
  BULK_WRITE: 'bulk-write',
});

const READ_TOOL_NAMES = Object.freeze([
  'confluence_read', 'confluence_search', 'confluence_info', 'confluence_spaces',
  'confluence_children', 'confluence_export', 'confluence_convert', 'confluence_find',
  'confluence_versions', 'confluence_comments', 'confluence_attachments',
  'confluence_property_list', 'confluence_property_get',
]);

const WRITE_TOOL_NAMES = Object.freeze([
  'confluence_create', 'confluence_create_child', 'confluence_update',
  'confluence_move', 'confluence_delete', 'confluence_copy_tree_preview',
  'confluence_copy_tree', 'confluence_comment_create', 'confluence_comment_delete',
  'confluence_property_set', 'confluence_property_delete',
  'confluence_attachment_upload', 'confluence_attachment_delete',
  'confluence_version_delete', 'confluence_versions_purge_preview',
  'confluence_versions_purge',
]);

function hasValue(value) {
  return value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
}

function requireText(value, name) {
  if (!hasValue(value)) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return String(value);
}

function optionalText(value) {
  return hasValue(value) ? String(value) : undefined;
}

function appendFlag(args, flag, enabled) {
  if (enabled) {
    args.push(flag);
  }
}

function appendValue(args, flag, value, name, fallback) {
  const resolved = hasValue(value) ? value : fallback;
  if (!hasValue(resolved)) return;
  args.push(flag, requireText(resolved, name));
}

function appendJsonValue(args, flag, value, name) {
  if (!hasValue(value)) return;
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  args.push(flag, requireText(serialized, name));
}

function appendBodySource(args, params) {
  const content = params.content;
  const contentFile = params.contentFile ?? params.file;
  const hasContent = hasValue(content);
  const hasFile = hasValue(contentFile);

  if (hasContent && hasFile) {
    throw new Error('Use only one of content or contentFile.');
  }
  if (hasContent) {
    args.push('--content', requireText(content, 'content'));
    return;
  }
  if (hasFile) {
    args.push('--file', requireText(contentFile, 'contentFile'));
    return;
  }
  throw new Error('Either content or contentFile is required.');
}

function appendValueSource(args, params) {
  const value = params.value;
  const valueFile = params.valueFile ?? params.file;
  const hasValueInput = hasValue(value);
  const hasFile = hasValue(valueFile);

  if (hasValueInput && hasFile) {
    throw new Error('Use only one of value or valueFile.');
  }
  if (hasValueInput) {
    appendJsonValue(args, '--value', value, 'value');
    return;
  }
  if (hasFile) {
    args.push('--file', requireText(valueFile, 'valueFile'));
    return;
  }
  throw new Error('Either value or valueFile is required.');
}

function collectFiles(params) {
  const source = params.files ?? params.file ?? params.attachmentFiles;
  if (!hasValue(source)) return [];
  return (Array.isArray(source) ? source : [source]).map((entry) => requireText(entry, 'file'));
}

function appendFiles(args, params) {
  const files = collectFiles(params);
  if (files.length === 0) {
    throw new Error('At least one file is required.');
  }
  for (const file of files) {
    args.push('--file', file);
  }
}

function appendInlineMetadata(args, params) {
  appendValue(args, '--inline-selection', optionalText(params.inlineSelection), 'inlineSelection');
  appendValue(args, '--inline-original-selection', optionalText(params.inlineOriginalSelection), 'inlineOriginalSelection');
  appendValue(args, '--inline-marker-ref', optionalText(params.inlineMarkerRef), 'inlineMarkerRef');
  appendJsonValue(args, '--inline-properties', params.inlineProperties, 'inlineProperties');
}

function createOperation(definition) {
  return Object.freeze(definition);
}

const OPERATIONS = Object.freeze(Object.assign(Object.create(null), {
  confluence_read: createOperation({
    toolName: 'confluence_read',
    cliCommand: 'read',
    risk: RISK.READ,
    timeoutMs: 30_000,
    mutation: false,
    expectJson: false,
    buildArgs(params = {}) {
      const args = ['read', requireText(params.pageId, 'pageId')];
      appendValue(args, '--format', params.format, 'format', 'text');
      return args;
    },
  }),
  confluence_search: createOperation({
    toolName: 'confluence_search',
    cliCommand: 'search',
    risk: RISK.READ,
    timeoutMs: 30_000,
    mutation: false,
    expectJson: false,
    buildArgs(params = {}) {
      const args = ['search', requireText(params.query, 'query')];
      appendValue(args, '--limit', params.limit, 'limit', 10);
      appendValue(args, '--start', params.start, 'start', 0);
      appendFlag(args, '--cql', params.cql);
      return args;
    },
  }),
  confluence_info: createOperation({
    toolName: 'confluence_info',
    cliCommand: 'info',
    risk: RISK.READ,
    timeoutMs: 30_000,
    mutation: false,
    expectJson: true,
    buildArgs(params = {}) {
      return ['--json', 'info', requireText(params.pageId, 'pageId')];
    },
  }),
  confluence_spaces: createOperation({
    toolName: 'confluence_spaces',
    cliCommand: 'spaces',
    risk: RISK.READ,
    timeoutMs: 30_000,
    mutation: false,
    expectJson: true,
    buildArgs(params = {}) {
      const args = ['--json', 'spaces'];
      if (params.all) {
        args.push('--all');
      } else {
        appendValue(args, '--limit', params.limit, 'limit', 500);
      }
      return args;
    },
  }),
  confluence_children: createOperation({
    toolName: 'confluence_children',
    cliCommand: 'children',
    risk: RISK.READ,
    timeoutMs: 30_000,
    mutation: false,
    expectJson: true,
    buildArgs(params = {}) {
      const args = ['--json', 'children', requireText(params.pageId, 'pageId')];
      appendFlag(args, '--recursive', params.recursive);
      appendValue(args, '--max-depth', params.maxDepth, 'maxDepth', 10);
      appendValue(args, '--type', params.type, 'type', 'pages');
      appendValue(args, '--format', params.format, 'format', 'list');
      appendFlag(args, '--show-url', params.showUrl);
      appendFlag(args, '--show-id', params.showId);
      return args;
    },
  }),
  confluence_export: createOperation({
    toolName: 'confluence_export',
    cliCommand: 'export',
    risk: RISK.READ,
    timeoutMs: 30_000,
    mutation: false,
    expectJson: false,
    buildArgs(params = {}) {
      const args = ['export', requireText(params.pageId, 'pageId')];
      appendValue(args, '--dest', params.destination ?? params.dest, 'destination', '.');
      appendValue(args, '--format', params.format, 'format', 'markdown');
      args.push('--skip-attachments');
      appendValue(args, '--file', params.file, 'file');
      appendFlag(args, '--recursive', params.recursive);
      appendValue(args, '--max-depth', params.maxDepth, 'maxDepth', 10);
      appendFlag(args, '--dry-run', params.dryRun);
      appendFlag(args, '--referenced-only', params.referencedOnly);
      return args;
    },
  }),
  confluence_convert: createOperation({
    toolName: 'confluence_convert',
    cliCommand: 'convert',
    risk: RISK.READ,
    timeoutMs: 30_000,
    mutation: false,
    expectJson: false,
    buildArgs(params = {}) {
      const args = ['convert', '--input-file', requireText(params.inputFile, 'inputFile')];
      appendValue(args, '--output-file', params.outputFile, 'outputFile');
      appendValue(args, '--input-format', params.inputFormat, 'inputFormat');
      appendValue(args, '--output-format', params.outputFormat, 'outputFormat');
      return args;
    },
  }),
  confluence_find: createOperation({
    toolName: 'confluence_find',
    cliCommand: 'find',
    risk: RISK.READ,
    timeoutMs: 30_000,
    mutation: false,
    expectJson: true,
    buildArgs(params = {}) {
      const args = ['--json', 'find', requireText(params.title, 'title')];
      appendValue(args, '--space', params.space, 'space');
      return args;
    },
  }),
  confluence_versions: createOperation({
    toolName: 'confluence_versions',
    cliCommand: 'versions',
    risk: RISK.READ,
    timeoutMs: 30_000,
    mutation: false,
    expectJson: true,
    buildArgs(params = {}) {
      return ['--json', 'versions', requireText(params.pageId, 'pageId')];
    },
  }),
  confluence_comments: createOperation({
    toolName: 'confluence_comments',
    cliCommand: 'comments',
    risk: RISK.READ,
    timeoutMs: 30_000,
    mutation: false,
    expectJson: true,
    buildArgs(params = {}) {
      const args = ['--json', 'comments', requireText(params.pageId, 'pageId')];
      appendValue(args, '--limit', params.limit, 'limit', 25);
      appendValue(args, '--start', params.start, 'start', 0);
      appendValue(args, '--location', params.location, 'location');
      appendValue(args, '--depth', params.depth, 'depth');
      appendFlag(args, '--all', params.all);
      return args;
    },
  }),
  confluence_attachments: createOperation({
    toolName: 'confluence_attachments',
    cliCommand: 'attachments',
    risk: RISK.READ,
    timeoutMs: 30_000,
    mutation: false,
    expectJson: true,
    buildArgs(params = {}) {
      const args = ['--json', 'attachments', requireText(params.pageId, 'pageId')];
      appendValue(args, '--limit', params.limit, 'limit');
      appendValue(args, '--pattern', params.pattern, 'pattern');
      if (params.download) {
        args.push('--download');
        appendValue(args, '--dest', params.destination ?? params.dest, 'destination', '.');
      }
      return args;
    },
  }),
  confluence_property_list: createOperation({
    toolName: 'confluence_property_list',
    cliCommand: 'property-list',
    risk: RISK.READ,
    timeoutMs: 30_000,
    mutation: false,
    expectJson: true,
    buildArgs(params = {}) {
      const args = ['--json', 'property-list', requireText(params.pageId, 'pageId')];
      appendValue(args, '--start', params.start, 'start', 0);
      appendValue(args, '--limit', params.limit, 'limit', 25);
      appendFlag(args, '--all', params.all);
      return args;
    },
  }),
  confluence_property_get: createOperation({
    toolName: 'confluence_property_get',
    cliCommand: 'property-get',
    risk: RISK.READ,
    timeoutMs: 30_000,
    mutation: false,
    expectJson: true,
    buildArgs(params = {}) {
      return ['--json', 'property-get', requireText(params.pageId, 'pageId'), requireText(params.key, 'key')];
    },
  }),
  confluence_create: createOperation({
    toolName: 'confluence_create',
    cliCommand: 'create',
    risk: RISK.WRITE,
    timeoutMs: 30_000,
    mutation: true,
    expectJson: true,
    buildArgs(params = {}) {
      const args = ['--json', 'create', requireText(params.title, 'title'), requireText(params.spaceKey, 'spaceKey')];
      if (params.type !== 'folder') {
        appendBodySource(args, params);
      }
      appendValue(args, '--format', params.format, 'format', 'storage');
      appendValue(args, '--type', params.type, 'type', 'page');
      return args;
    },
  }),
  confluence_create_child: createOperation({
    toolName: 'confluence_create_child',
    cliCommand: 'create-child',
    risk: RISK.WRITE,
    timeoutMs: 30_000,
    mutation: true,
    expectJson: true,
    buildArgs(params = {}) {
      const args = ['--json', 'create-child', requireText(params.title, 'title'), requireText(params.parentId, 'parentId')];
      if (params.type !== 'folder') {
        appendBodySource(args, params);
      }
      appendValue(args, '--format', params.format, 'format', 'storage');
      appendValue(args, '--type', params.type, 'type', 'page');
      return args;
    },
  }),
  confluence_update: createOperation({
    toolName: 'confluence_update',
    cliCommand: 'update',
    risk: RISK.WRITE,
    timeoutMs: 30_000,
    mutation: true,
    expectJson: true,
    buildArgs(params = {}) {
      const args = ['--json', 'update', requireText(params.pageId, 'pageId')];
      const hasTitle = hasValue(params.title);
      const hasBody = hasValue(params.content) || hasValue(params.contentFile) || hasValue(params.file);
      if (!hasTitle && !hasBody) {
        throw new Error('At least one of title, content, or contentFile is required.');
      }
      appendValue(args, '--title', params.title, 'title');
      if (hasBody) {
        appendBodySource(args, params);
      }
      appendValue(args, '--format', params.format, 'format', 'storage');
      return args;
    },
  }),
  confluence_move: createOperation({
    toolName: 'confluence_move',
    cliCommand: 'move',
    risk: RISK.WRITE,
    timeoutMs: 30_000,
    mutation: true,
    expectJson: true,
    buildArgs(params = {}) {
      const parentId = params.newParentId ?? params.parentId;
      const args = ['--json', 'move', requireText(params.pageId, 'pageId'), requireText(parentId, 'newParentId')];
      appendValue(args, '--title', params.title, 'title');
      return args;
    },
  }),
  confluence_delete: createOperation({
    toolName: 'confluence_delete',
    cliCommand: 'delete',
    risk: RISK.DESTRUCTIVE,
    timeoutMs: 30_000,
    mutation: true,
    expectJson: true,
    buildArgs(params = {}) {
      return ['--json', 'delete', requireText(params.pageId, 'pageId'), '--yes'];
    },
  }),
  confluence_copy_tree_preview: createOperation({
    toolName: 'confluence_copy_tree_preview',
    cliCommand: 'copy-tree',
    risk: RISK.BULK_PREVIEW,
    timeoutMs: 30_000,
    mutation: false,
    expectJson: true,
    buildArgs(params = {}) {
      const args = ['--json', 'copy-tree', requireText(params.sourcePageId, 'sourcePageId'), requireText(params.targetParentId, 'targetParentId')];
      if (hasValue(params.title)) {
        args.push(requireText(params.title, 'title'));
      }
      appendValue(args, '--max-depth', params.maxDepth, 'maxDepth', 10);
      appendValue(args, '--exclude', params.exclude, 'exclude');
      appendValue(args, '--delay-ms', params.delayMs, 'delayMs', 100);
      appendValue(args, '--copy-suffix', params.copySuffix, 'copySuffix', ' (Copy)');
      args.push('--dry-run', '--quiet');
      return args;
    },
  }),
  confluence_copy_tree: createOperation({
    toolName: 'confluence_copy_tree',
    cliCommand: 'copy-tree',
    risk: RISK.BULK_WRITE,
    timeoutMs: 300_000,
    mutation: true,
    expectJson: true,
    buildArgs(params = {}) {
      const args = ['--json', 'copy-tree', requireText(params.sourcePageId, 'sourcePageId'), requireText(params.targetParentId, 'targetParentId')];
      if (hasValue(params.title)) {
        args.push(requireText(params.title, 'title'));
      }
      appendValue(args, '--max-depth', params.maxDepth, 'maxDepth', 10);
      appendValue(args, '--exclude', params.exclude, 'exclude');
      appendValue(args, '--delay-ms', params.delayMs, 'delayMs', 100);
      appendValue(args, '--copy-suffix', params.copySuffix, 'copySuffix', ' (Copy)');
      args.push('--fail-on-error', '--quiet');
      return args;
    },
  }),
  confluence_comment_create: createOperation({
    toolName: 'confluence_comment_create',
    cliCommand: 'comment',
    risk: RISK.WRITE,
    timeoutMs: 30_000,
    mutation: true,
    expectJson: true,
    buildArgs(params = {}) {
      const args = ['--json', 'comment', requireText(params.pageId, 'pageId')];
      appendBodySource(args, params);
      appendValue(args, '--format', params.format, 'format', 'storage');
      appendValue(args, '--parent', params.parent, 'parent');
      appendValue(args, '--location', params.location, 'location', 'footer');
      appendInlineMetadata(args, params);
      return args;
    },
  }),
  confluence_comment_delete: createOperation({
    toolName: 'confluence_comment_delete',
    cliCommand: 'comment-delete',
    risk: RISK.DESTRUCTIVE,
    timeoutMs: 30_000,
    mutation: true,
    expectJson: true,
    buildArgs(params = {}) {
      return ['--json', 'comment-delete', requireText(params.commentId, 'commentId'), '--yes'];
    },
  }),
  confluence_property_set: createOperation({
    toolName: 'confluence_property_set',
    cliCommand: 'property-set',
    risk: RISK.WRITE,
    timeoutMs: 30_000,
    mutation: true,
    expectJson: true,
    buildArgs(params = {}) {
      const args = ['--json', 'property-set', requireText(params.pageId, 'pageId'), requireText(params.key, 'key')];
      appendValueSource(args, params);
      return args;
    },
  }),
  confluence_property_delete: createOperation({
    toolName: 'confluence_property_delete',
    cliCommand: 'property-delete',
    risk: RISK.DESTRUCTIVE,
    timeoutMs: 30_000,
    mutation: true,
    expectJson: true,
    buildArgs(params = {}) {
      return ['--json', 'property-delete', requireText(params.pageId, 'pageId'), requireText(params.key, 'key'), '--yes'];
    },
  }),
  confluence_attachment_upload: createOperation({
    toolName: 'confluence_attachment_upload',
    cliCommand: 'attachment-upload',
    risk: RISK.WRITE,
    timeoutMs: 120_000,
    mutation: true,
    expectJson: true,
    buildArgs(params = {}) {
      const args = ['--json', 'attachment-upload', requireText(params.pageId, 'pageId')];
      appendFiles(args, params);
      appendValue(args, '--comment', params.comment, 'comment');
      appendFlag(args, '--replace', params.replace);
      appendFlag(args, '--minor-edit', params.minorEdit);
      return args;
    },
  }),
  confluence_attachment_delete: createOperation({
    toolName: 'confluence_attachment_delete',
    cliCommand: 'attachment-delete',
    risk: RISK.DESTRUCTIVE,
    timeoutMs: 30_000,
    mutation: true,
    expectJson: true,
    buildArgs(params = {}) {
      return ['--json', 'attachment-delete', requireText(params.pageId, 'pageId'), requireText(params.attachmentId, 'attachmentId'), '--yes'];
    },
  }),
  confluence_version_delete: createOperation({
    toolName: 'confluence_version_delete',
    cliCommand: 'version-delete',
    risk: RISK.DESTRUCTIVE,
    timeoutMs: 30_000,
    mutation: true,
    expectJson: true,
    buildArgs(params = {}) {
      return ['--json', 'version-delete', requireText(params.pageId, 'pageId'), requireText(params.versionNumber, 'versionNumber'), '--yes'];
    },
  }),
  confluence_versions_purge_preview: createOperation({
    toolName: 'confluence_versions_purge_preview',
    cliCommand: 'versions',
    risk: RISK.BULK_PREVIEW,
    timeoutMs: 30_000,
    mutation: false,
    expectJson: true,
    buildArgs(params = {}) {
      return ['--json', 'versions', requireText(params.pageId, 'pageId')];
    },
  }),
  confluence_versions_purge: createOperation({
    toolName: 'confluence_versions_purge',
    cliCommand: 'versions-purge',
    risk: RISK.BULK_WRITE,
    timeoutMs: 300_000,
    mutation: true,
    expectJson: true,
    buildArgs(params = {}) {
      const args = ['--json', 'versions-purge', requireText(params.pageId, 'pageId'), '--yes'];
      appendValue(args, '--throttle', params.throttle, 'throttle', 0);
      return args;
    },
  }),
}));

const TOOL_NAMES = Object.freeze([...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES]);

function getOperation(name) {
  if (!Object.prototype.hasOwnProperty.call(OPERATIONS, name)) {
    throw new Error(`Confluence operation "${name}" is not allowed.`);
  }
  return OPERATIONS[name];
}

function listToolNames({ includeWrites = false } = {}) {
  return Object.freeze(includeWrites ? [...TOOL_NAMES] : [...READ_TOOL_NAMES]);
}

function buildArgs(name, input = {}) {
  return getOperation(name).buildArgs(input);
}

module.exports = {
  RISK,
  OPERATIONS,
  getOperation,
  listToolNames,
  buildArgs,
};
