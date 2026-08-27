const { runPreflight, stableFingerprint } = require('../lib/pi/preflight');

const PLANNED_TREE_FINGERPRINT = 'a'.repeat(64);

function page(id, title, spaceKey, versionNumber = 1) {
  return {
    id,
    title,
    space: { key: spaceKey },
    version: { number: versionNumber },
  };
}

function makeInvokeJson() {
  const pages = {
    '123': page('123', 'Release Notes', 'ENG', 7),
    '456': page('456', 'Operations Runbooks', 'OPS', 3),
  };

  return jest.fn(async (toolName, input) => {
    if (toolName === 'confluence_info') {
      return pages[String(input.pageId)];
    }

    if (toolName === 'confluence_comment_lookup') {
      return { id: String(input.commentId), pageId: '123', parentId: null, title: 'Comment' };
    }

    if (toolName === 'confluence_attachment_lookup') {
      return { id: String(input.attachmentId), pageId: '123', title: 'Attachment', mediaType: '', fileSize: 0, version: 1 };
    }

    if (toolName === 'confluence_comments') {
      if (String(input.start ?? 0) === '0') {
        return { pageId: '123', results: [{ id: '17' }], nextStart: 1 };
      }
      return { pageId: '123', results: [{ id: '88' }] };
    }

    if (toolName === 'confluence_attachments') {
      if (String(input.start ?? 0) === '0') {
        return { pageId: '123', results: [{ id: '2' }], nextStart: 1 };
      }
      return { pageId: '123', results: [{ id: '678' }] };
    }

    if (toolName === 'confluence_property_list') {
      if (String(input.start ?? 0) === '0') {
        return { pageId: '123', results: [{ key: 'build-number' }], nextStart: 1 };
      }
      return { pageId: '123', results: [{ key: 'release-notes' }] };
    }

    if (toolName === 'confluence_versions') {
      return {
        pageId: '123',
        versions: [
          { number: 1 },
          { number: 2 },
          { number: 3 },
          { number: 4 },
        ],
      };
    }

    if (toolName === 'confluence_copy_tree_preview') {
      return {
        sourcePageId: '123',
        sourceVersion: 7,
        targetParentId: '456',
        targetParentVersion: 3,
        rootTitle: 'Release Notes (Copy)',
        childCount: 13,
        plannedTreeFingerprint: PLANNED_TREE_FINGERPRINT,
      };
    }

    throw new Error(`unexpected tool ${toolName}`);
  });
}

test('resolves canonical page titles and both same-space move targets', async () => {
  const invokeJson = jest.fn(async (_toolName, input) => (
    String(input.pageId) === '123'
      ? page('123', 'Release Notes', 'ENG', 7)
      : page('456', 'Operations Runbooks', 'ENG', 3)
  ));
  const result = await runPreflight({
    operation: 'confluence_move',
    input: { pageId: '123', newParentId: '456' },
    invokeJson,
  });

  expect(result.targets).toEqual([
    { role: 'source', pageId: '123', title: 'Release Notes', spaceKey: 'ENG' },
    { role: 'destination', pageId: '456', title: 'Operations Runbooks', spaceKey: 'ENG' },
  ]);
  expect(result.summary).toContain('Release Notes (ID: 123, SPACE: ENG)');
  expect(result.summary).toContain('Operations Runbooks (ID: 456, SPACE: ENG)');
});

test('rejects a cross-space move before authorization or confirmation', async () => {
  await expect(runPreflight({
    operation: 'confluence_move',
    input: { pageId: '123', newParentId: '456' },
    invokeJson: makeInvokeJson(),
  })).rejects.toMatchObject({ code: 'CROSS_SPACE_MOVE' });
});

test('rewrites URL mutation targets and destructive phrases to canonical page IDs', async () => {
  const pageUrl = 'https://example.atlassian.net/wiki/pages/123/Release-Notes';
  const result = await runPreflight({
    operation: 'confluence_delete',
    input: { pageId: pageUrl },
    invokeJson: jest.fn(async () => page('123', 'Release Notes', 'ENG', 7)),
  });

  expect(result.input.pageId).toBe('123');
  expect(result.targets[0].pageId).toBe('123');
  expect(result.phrase).toBe('DELETE PAGE 123');
});

test('rejects canonical info records whose ID mismatches a requested page ID', async () => {
  await expect(runPreflight({
    operation: 'confluence_update',
    input: { pageId: '123' },
    invokeJson: jest.fn(async () => page('999', 'Different Page', 'ENG', 1)),
  })).rejects.toMatchObject({ code: 'TARGET_MISMATCH' });
});

test('matches create keys case-insensitively and preserves server casing in final create input', async () => {
  const unusedSpaces = Array.from({ length: 501 }, (_, index) => ({
    key: `UNUSED-${index}`,
    name: `Unused Space ${index}`,
    type: 'global',
  }));
  const invokeJson = jest.fn(async (toolName) => {
    if (toolName === 'confluence_space_lookup') {
      return { key: 'Eng', name: 'Engineering', type: 'global' };
    }
    if (toolName === 'confluence_spaces') {
      return { spaceCount: unusedSpaces.length, spaces: unusedSpaces };
    }
    throw new Error(`unexpected tool ${toolName}`);
  });

  const result = await runPreflight({
    operation: 'confluence_create',
    input: { title: 'New Page', spaceKey: ' eng ', content: 'body' },
    invokeJson,
  });

  expect(invokeJson).toHaveBeenCalledWith('confluence_space_lookup', { spaceKey: 'eng' });
  expect(invokeJson).not.toHaveBeenCalledWith('confluence_spaces', expect.anything());
  expect(result.input.spaceKey).toBe('Eng');
  expect(result.targets).toEqual([{ role: 'destination', title: 'Engineering', spaceKey: 'Eng' }]);
  expect(result.summary).toContain('Engineering (SPACE: Eng)');
});

test('rejects a create lookup whose key differs from the requested key', async () => {
  const invokeJson = jest.fn(async () => ({ key: '~Bob', name: 'Bob Personal Space', type: 'personal' }));

  await expect(runPreflight({
    operation: 'confluence_create',
    input: { title: 'New Page', spaceKey: ' ~alice ', content: 'body' },
    invokeJson,
  })).rejects.toMatchObject({ code: 'TARGET_MISMATCH' });

  expect(invokeJson).toHaveBeenCalledWith('confluence_space_lookup', { spaceKey: '~alice' });
});

test('preserves server casing in page target summaries', async () => {
  const invokeJson = jest.fn(async (_toolName, input) => (
    String(input.pageId) === '123'
      ? page('123', 'Release Notes', 'eng', 7)
      : page('456', 'Operations Runbooks', 'ENG', 3)
  ));

  const result = await runPreflight({
    operation: 'confluence_move',
    input: { pageId: '123', newParentId: '456' },
    invokeJson,
  });

  expect(result.targets).toEqual([
    { role: 'source', pageId: '123', title: 'Release Notes', spaceKey: 'eng' },
    { role: 'destination', pageId: '456', title: 'Operations Runbooks', spaceKey: 'ENG' },
  ]);
  expect(result.summary).toContain('Release Notes (ID: 123, SPACE: eng)');
  expect(result.summary).toContain('Operations Runbooks (ID: 456, SPACE: ENG)');
});

test('maps a missing direct create destination to TARGET_NOT_FOUND without space enumeration', async () => {
  const invokeJson = jest.fn(async (toolName) => {
    if (toolName === 'confluence_space_lookup') {
      return { found: false, key: 'ENG' };
    }
    if (toolName === 'confluence_spaces') {
      throw new Error('space enumeration must not run');
    }
    throw new Error(`unexpected tool ${toolName}`);
  });

  await expect(runPreflight({
    operation: 'confluence_create',
    input: { title: 'New Page', spaceKey: 'ENG', content: 'body' },
    invokeJson,
  })).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });

  expect(invokeJson).not.toHaveBeenCalledWith('confluence_spaces', expect.anything());
});

test.each([
  ['missing key', { name: 'Operations', type: 'global' }],
  ['missing name', { key: 'ENG', type: 'global' }],
])('rejects malformed direct create destination lookup (%s)', async (_label, space) => {
  await expect(runPreflight({
    operation: 'confluence_create',
    input: { title: 'New Page', spaceKey: 'ENG', content: 'body' },
    invokeJson: jest.fn(async () => space),
  })).rejects.toMatchObject({ code: 'MALFORMED_RESULT' });
});

test.each([
  ['confluence_create_child', { title: 'Child', parentId: '456' }, 'Operations Runbooks (ID: 456, SPACE: OPS)'],
  ['confluence_update', { pageId: '123' }, 'Release Notes (ID: 123, SPACE: ENG)'],
  ['confluence_delete', { pageId: '123' }, 'Release Notes (ID: 123, SPACE: ENG)'],
  ['confluence_comment_create', { pageId: '123' }, 'Release Notes (ID: 123, SPACE: ENG)'],
  ['confluence_property_set', { pageId: '123', key: 'release-notes', value: 'ready' }, 'Release Notes (ID: 123, SPACE: ENG)'],
  ['confluence_attachment_upload', { pageId: '123', files: ['guide.pdf'] }, 'Release Notes (ID: 123, SPACE: ENG)'],
])('uses canonical page titles for %s', async (operation, input, expected) => {
  const invokeJson = makeInvokeJson();
  const result = await runPreflight({ operation, input, invokeJson });

  expect(result.summary).toContain(expected);
});

test.each([
  ['confluence_create_child', { title: 'Child Draft', parentId: '123', content: 'body', bodyBytes: 4, format: 'markdown', type: 'page' }, ['Child Draft', '4 bytes', 'markdown', 'page']],
  ['confluence_update', { pageId: '123', title: 'Release Notes v2', content: 'body', bodyBytes: 4, format: 'storage' }, ['Release Notes v2', '4 bytes', 'storage']],
  ['confluence_move', { pageId: '123', newParentId: '456', title: 'Moved Notes' }, ['Moved Notes']],
  ['confluence_comment_create', { pageId: '123', content: 'body', bodyBytes: 4, format: 'markdown', parent: '88', location: 'inline', inlineSelection: 'selected' }, ['4 bytes', 'markdown', 'parent 88', 'inline', 'inline metadata: yes']],
  ['confluence_property_set', { pageId: '123', key: 'release-notes', value: '{"ready":true}', propertyBytes: 14 }, ['release-notes', '14 bytes', 'replace existing: yes']],
  ['confluence_attachment_upload', { pageId: '123', files: ['guide.pdf'], comment: 'Release asset', replace: true, minorEdit: true }, ['guide.pdf', 'Release asset', 'replace existing files', 'minor edit: yes']],
])('includes normalized operation metadata in the %s confirmation summary', async (operation, input, expectedParts) => {
  const invokeJson = jest.fn(async (toolName, readInput) => {
    if (toolName === 'confluence_info') {
      if (String(readInput.pageId) === '456') return page('456', 'Destination', 'ENG', 3);
      return page('123', 'Release Notes', 'ENG', 7);
    }
    if (toolName === 'confluence_property_list') {
      return { pageId: '123', results: [{ key: 'release-notes' }] };
    }
    throw new Error(`unexpected tool ${toolName}`);
  });
  const result = await runPreflight({ operation, input, invokeJson });

  for (const expected of expectedParts) expect(result.summary).toContain(expected);
  expect(result.summary).not.toContain('body');
  expect(result.summary).not.toContain('{"ready":true}');
});

test('create confirmation includes canonical destination, title, type, format, and body byte count', async () => {
  const result = await runPreflight({
    operation: 'confluence_create',
    input: { title: 'New Page', spaceKey: 'ENG', content: 'secret body', bodyBytes: 11, format: 'markdown', type: 'page' },
    invokeJson: jest.fn(async () => ({ key: 'ENG', name: 'Engineering', type: 'global' })),
  });

  expect(result.summary).toContain('New Page');
  expect(result.summary).toContain('Engineering (SPACE: ENG)');
  expect(result.summary).toContain('11 bytes');
  expect(result.summary).toContain('markdown');
  expect(result.summary).toContain('page');
  expect(result.summary).not.toContain('secret body');
});

test('resolves comment, attachment, and property ownership through confluence_info before checking ownership response shapes', async () => {
  const invokeJson = makeInvokeJson();

  const comment = await runPreflight({
    operation: 'confluence_comment_delete',
    input: { pageId: '123', commentId: '88' },
    invokeJson,
  });
  const attachment = await runPreflight({
    operation: 'confluence_attachment_delete',
    input: { pageId: '123', attachmentId: '678' },
    invokeJson,
  });
  const property = await runPreflight({
    operation: 'confluence_property_delete',
    input: { pageId: '123', key: 'release-notes' },
    invokeJson,
  });

  expect(comment.phrase).toBe('DELETE COMMENT 88 FROM 123');
  expect(comment.summary).toContain('Release Notes (ID: 123, SPACE: ENG)');
  expect(attachment.phrase).toBe('DELETE ATTACHMENT 678 FROM 123');
  expect(attachment.summary).toContain('Release Notes (ID: 123, SPACE: ENG)');
  expect(property.phrase).toBe('DELETE PROPERTY release-notes FROM 123');
  expect(property.summary).toContain('Release Notes (ID: 123, SPACE: ENG)');
  expect(invokeJson).toHaveBeenCalledWith('confluence_info', { pageId: '123' });
  expect(invokeJson).toHaveBeenCalledWith('confluence_comment_lookup', { commentId: '88' });
  expect(invokeJson).toHaveBeenCalledWith('confluence_attachment_lookup', { attachmentId: '678' });
  expect(invokeJson).toHaveBeenCalledWith('confluence_property_list', expect.objectContaining({ pageId: '123', start: 0 }));
});

test('resolves reply-comment ownership through a direct lookup without enumerating comments', async () => {
  const invokeJson = jest.fn(async (toolName, input) => {
    if (toolName === 'confluence_info') return page('123', 'Release Notes', 'ENG', 7);
    if (toolName === 'confluence_comment_lookup') {
      expect(input).toEqual({ commentId: 'reply-456' });
      return { id: 'reply-456', pageId: '123', parentId: 'parent-123', title: 'A reply' };
    }
    if (toolName === 'confluence_comments') {
      return { pageId: '123', results: [{ id: 'reply-456' }] };
    }
    throw new Error(`unexpected tool ${toolName}`);
  });

  const result = await runPreflight({
    operation: 'confluence_comment_delete',
    input: { pageId: '123', commentId: 'reply-456' },
    invokeJson,
  });

  expect(result.phrase).toBe('DELETE COMMENT reply-456 FROM 123');
  expect(result.summary).toContain('Release Notes (ID: 123, SPACE: ENG)');
  expect(invokeJson).toHaveBeenCalledWith('confluence_comment_lookup', { commentId: 'reply-456' });
  expect(invokeJson).not.toHaveBeenCalledWith('confluence_comments', expect.anything());
});

test('rejects a reply-comment direct lookup whose page ownership does not match', async () => {
  const invokeJson = jest.fn(async (toolName) => {
    if (toolName === 'confluence_info') return page('123', 'Release Notes', 'ENG', 7);
    if (toolName === 'confluence_comment_lookup') {
      return { id: 'reply-456', pageId: '999', parentId: 'parent-999', title: 'A reply' };
    }
    if (toolName === 'confluence_comments') {
      return { pageId: '123', results: [{ id: 'reply-456' }] };
    }
    throw new Error(`unexpected tool ${toolName}`);
  });

  await expect(runPreflight({
    operation: 'confluence_comment_delete',
    input: { pageId: '123', commentId: 'reply-456' },
    invokeJson,
  })).rejects.toMatchObject({ code: 'TARGET_MISMATCH' });

  expect(invokeJson).toHaveBeenCalledWith('confluence_comment_lookup', { commentId: 'reply-456' });
  expect(invokeJson).not.toHaveBeenCalledWith('confluence_comments', expect.anything());
});

test('resolves attachment ownership through a direct lookup without enumerating 141 attachments', async () => {
  const attachments = Array.from({ length: 141 }, (_, index) => ({ id: `attachment-${index + 1}` }));
  const invokeJson = jest.fn(async (toolName, input) => {
    if (toolName === 'confluence_info') return page('123', 'Release Notes', 'ENG', 7);
    if (toolName === 'confluence_attachment_lookup') {
      expect(input).toEqual({ attachmentId: 'attachment-141' });
      return {
        id: 'attachment-141', pageId: '123', title: 'release.pdf',
        mediaType: 'application/pdf', fileSize: 204800, version: 7,
      };
    }
    if (toolName === 'confluence_attachments') {
      return { pageId: '123', results: attachments };
    }
    throw new Error(`unexpected tool ${toolName}`);
  });

  const result = await runPreflight({
    operation: 'confluence_attachment_delete',
    input: { pageId: '123', attachmentId: 'attachment-141' },
    invokeJson,
  });

  expect(result.phrase).toBe('DELETE ATTACHMENT attachment-141 FROM 123');
  expect(result.summary).toContain('Release Notes (ID: 123, SPACE: ENG)');
  expect(invokeJson).toHaveBeenCalledWith('confluence_attachment_lookup', { attachmentId: 'attachment-141' });
  expect(invokeJson).not.toHaveBeenCalledWith('confluence_attachments', expect.anything());
});

test('rejects an attachment direct lookup whose page ownership does not match', async () => {
  const invokeJson = jest.fn(async (toolName) => {
    if (toolName === 'confluence_info') return page('123', 'Release Notes', 'ENG', 7);
    if (toolName === 'confluence_attachment_lookup') {
      return {
        id: 'attachment-141', pageId: '999', title: 'release.pdf',
        mediaType: 'application/pdf', fileSize: 204800, version: 7,
      };
    }
    if (toolName === 'confluence_attachments') {
      return { pageId: '123', results: [{ id: 'attachment-141' }] };
    }
    throw new Error(`unexpected tool ${toolName}`);
  });

  await expect(runPreflight({
    operation: 'confluence_attachment_delete',
    input: { pageId: '123', attachmentId: 'attachment-141' },
    invokeJson,
  })).rejects.toMatchObject({ code: 'TARGET_MISMATCH' });

  expect(invokeJson).toHaveBeenCalledWith('confluence_attachment_lookup', { attachmentId: 'attachment-141' });
  expect(invokeJson).not.toHaveBeenCalledWith('confluence_attachments', expect.anything());
});

test.each([
  ['comment', 'confluence_comment_delete', 'commentId', 'reply-456', 'confluence_comment_lookup', 'confluence_comments'],
  ['attachment', 'confluence_attachment_delete', 'attachmentId', 'attachment-141', 'confluence_attachment_lookup', 'confluence_attachments'],
])('maps a missing direct %s target to TARGET_NOT_FOUND without enumeration', async (_label, operation, idKey, id, lookupTool, listTool) => {
  const invokeJson = jest.fn(async (toolName) => {
    if (toolName === 'confluence_info') return page('123', 'Release Notes', 'ENG', 7);
    if (toolName === lookupTool) return { found: false, id };
    if (toolName === listTool) throw new Error('target enumeration must not run');
    throw new Error(`unexpected tool ${toolName}`);
  });

  await expect(runPreflight({
    operation,
    input: { pageId: '123', [idKey]: id },
    invokeJson,
  })).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });

  expect(invokeJson).not.toHaveBeenCalledWith(listTool, expect.anything());
});

test.each([
  ['confluence_comment_delete', 'commentId', 'reply-456', 'confluence_comment_lookup'],
  ['confluence_attachment_delete', 'attachmentId', 'attachment-141', 'confluence_attachment_lookup'],
])('rejects missing direct ownership page metadata as MALFORMED_RESULT', async (operation, idKey, id, lookupTool) => {
  const invokeJson = jest.fn(async (toolName) => {
    if (toolName === 'confluence_info') return page('123', 'Release Notes', 'ENG', 7);
    if (toolName === lookupTool) return { id, pageId: null };
    throw new Error(`unexpected tool ${toolName}`);
  });

  await expect(runPreflight({
    operation,
    input: { pageId: '123', [idKey]: id },
    invokeJson,
  })).rejects.toMatchObject({ code: 'MALFORMED_RESULT' });
});

test('rejects missing ownership targets, missing property keys, current versions, malformed metadata, and truncated output', async () => {
  await expect(runPreflight({
    operation: 'confluence_comment_delete',
    input: { pageId: '123', commentId: '999' },
    invokeJson: jest.fn(async () => ({
      id: '123',
      title: 'Release Notes',
      space: { key: 'ENG' },
      results: [{ id: '1' }],
    })),
  })).rejects.toThrow(/comment|ownership|not found/i);

  await expect(runPreflight({
    operation: 'confluence_property_delete',
    input: { pageId: '123', key: 'missing-key' },
    invokeJson: jest.fn(async () => ({
      id: '123',
      title: 'Release Notes',
      space: { key: 'ENG' },
      results: [{ key: 'build-number' }],
    })),
  })).rejects.toThrow(/property|key|not found/i);

  await expect(runPreflight({
    operation: 'confluence_version_delete',
    input: { pageId: '123', versionNumber: 4 },
    invokeJson: jest.fn(async (toolName) => {
      if (toolName === 'confluence_info') {
        return { id: '123', title: 'Release Notes', space: { key: 'ENG' } };
      }
      return { pageId: '123', versions: [{ number: 4 }] };
    }),
  })).rejects.toThrow(/current version/i);

  await expect(runPreflight({
    operation: 'confluence_versions_purge_preview',
    input: { pageId: '123' },
    invokeJson: jest.fn(async (toolName) => {
      if (toolName === 'confluence_info') {
        return { id: '123', title: 'Release Notes', space: { key: 'ENG' } };
      }
      return { pageId: '123', versions: [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }] };
    }),
  })).resolves.toMatchObject({
    facts: {
      currentVersion: 4,
      historicalVersions: [1, 2, 3],
      historicalCount: 3,
    },
  });

  await expect(runPreflight({
    operation: 'confluence_update',
    input: { pageId: '123' },
    invokeJson: jest.fn(async () => ({
      id: '123',
      title: 'Release Notes',
    })),
  })).rejects.toThrow(/space/i);

  await expect(runPreflight({
    operation: 'confluence_update',
    input: { pageId: '123' },
    invokeJson: jest.fn(async () => ({
      truncated: true,
      json: { id: '123', title: 'Release Notes', space: { key: 'ENG' } },
    })),
  })).rejects.toThrow(/truncated/i);
});

test('rejects repeated pagination cursors and pagination loops', async () => {
  await expect(runPreflight({
    operation: 'confluence_property_delete',
    input: { pageId: '123', key: 'missing-key' },
    invokeJson: jest.fn(async (_toolName, input) => ({
      id: '123',
      title: 'Release Notes',
      space: { key: 'ENG' },
      results: input.start === 0 ? [{ key: 'one' }] : [{ key: 'two' }],
      nextStart: 0,
    })),
  })).rejects.toThrow(/cursor|loop/i);

  await expect(runPreflight({
    operation: 'confluence_property_delete',
    input: { pageId: '123', key: 'missing-key' },
    invokeJson: jest.fn(async (_toolName, input) => ({
      id: '123',
      title: 'Release Notes',
      space: { key: 'ENG' },
      results: [],
      nextStart: Number(input.start ?? 0) + 1,
    })),
  })).rejects.toThrow(/100|limit|pagination/i);
});

test('returns version purge facts and phrase from canonical versions', async () => {
  const invokeJson = makeInvokeJson();
  const result = await runPreflight({
    operation: 'confluence_versions_purge_preview',
    input: { pageId: '123' },
    invokeJson,
  });

  expect(result.facts).toEqual({
    currentVersion: 4,
    historicalVersions: [1, 2, 3],
    historicalCount: 3,
  });
  expect(result.phrase).toBe('PURGE 3 VERSIONS FROM 123');
  expect(result.summary).toContain('Release Notes (ID: 123, SPACE: ENG)');
});

test('purge summary includes the approved throttle flag', async () => {
  const result = await runPreflight({
    operation: 'confluence_versions_purge_preview',
    input: { pageId: '123', throttle: 0.25 },
    invokeJson: makeInvokeJson(),
  });
  expect(result.summary).toContain('throttle: 0.25 seconds');
});

test('returns copy tree facts from the preview response rootTitle', async () => {
  const invokeJson = makeInvokeJson();
  const result = await runPreflight({
    operation: 'confluence_copy_tree_preview',
    input: {
      sourcePageId: '123', targetParentId: '456', title: 'Launch Notes',
      maxDepth: 3, exclude: 'Draft*', delayMs: 25, copySuffix: ' (Clone)',
    },
    invokeJson,
  });

  expect(result.facts).toEqual({
    rootTitle: 'Release Notes (Copy)',
    childCount: 13,
    totalCreateCount: 14,
    sourceVersion: 7,
    destinationVersion: 3,
    plannedTreeFingerprint: PLANNED_TREE_FINGERPRINT,
  });
  expect(result.phrase).toBe('COPY 14 PAGES FROM 123 TO 456');
  expect(result.summary).toContain('Release Notes (ID: 123, SPACE: ENG)');
  expect(result.summary).toContain('Operations Runbooks (ID: 456, SPACE: OPS)');
  expect(result.summary).toContain('Release Notes (Copy)');
  expect(result.summary).toContain('max depth: 3');
  expect(result.summary).toContain('exclude: Draft*');
  expect(result.summary).toContain('delay: 25 ms');
  expect(result.summary).toContain('copy suffix: " (Clone)"');
});

test('copy tree summary keeps canonical source and destination titles when planned root title differs', async () => {
  const invokeJson = jest.fn(async (toolName, input) => {
    if (toolName === 'confluence_info') {
      if (String(input.pageId) === '123') return page('123', 'Release Notes', 'ENG', 7);
      if (String(input.pageId) === '456') return page('456', 'Operations Runbooks', 'OPS', 3);
    }
    if (toolName === 'confluence_copy_tree_preview') {
      return {
        sourcePageId: '123', sourceVersion: 7,
        targetParentId: '456', targetParentVersion: 3,
        rootTitle: 'Cloned Launch Plan', childCount: 13,
        plannedTreeFingerprint: PLANNED_TREE_FINGERPRINT,
      };
    }
    throw new Error(`unexpected tool ${toolName}`);
  });

  const result = await runPreflight({
    operation: 'confluence_copy_tree_preview',
    input: { sourcePageId: '123', targetParentId: '456' },
    invokeJson,
  });

  expect(result.summary).toContain('Release Notes (ID: 123, SPACE: ENG)');
  expect(result.summary).toContain('Operations Runbooks (ID: 456, SPACE: OPS)');
  expect(result.summary).toContain('Cloned Launch Plan');
  expect(result.phrase).toBe('COPY 14 PAGES FROM 123 TO 456');
});

test.each([-1, 1.5, NaN, Infinity])('rejects invalid copy-tree child count %s', async (childCount) => {
  await expect(runPreflight({
    operation: 'confluence_copy_tree_preview',
    input: { sourcePageId: '123', targetParentId: '456' },
    invokeJson: jest.fn(async (toolName, input) => {
      if (toolName === 'confluence_info') {
        return String(input.pageId) === '123'
          ? page('123', 'Release Notes', 'ENG', 7)
          : page('456', 'Operations Runbooks', 'OPS', 3);
      }
      return {
        sourcePageId: '123', sourceVersion: 7,
        targetParentId: '456', targetParentVersion: 3,
        rootTitle: 'Copy', childCount, plannedTreeFingerprint: PLANNED_TREE_FINGERPRINT,
      };
    }),
  })).rejects.toMatchObject({ code: 'MALFORMED_RESULT' });
});

test.each([
  undefined,
  'not-a-fingerprint',
  'A'.repeat(64),
  'a'.repeat(63),
])('rejects invalid copy-tree planned fingerprint %p', async (plannedTreeFingerprint) => {
  await expect(runPreflight({
    operation: 'confluence_copy_tree_preview',
    input: { sourcePageId: '123', targetParentId: '456' },
    invokeJson: jest.fn(async (toolName, input) => {
      if (toolName === 'confluence_info') {
        return String(input.pageId) === '123'
          ? page('123', 'Release Notes', 'ENG', 7)
          : page('456', 'Operations Runbooks', 'OPS', 3);
      }
      return {
        sourcePageId: '123', sourceVersion: 7,
        targetParentId: '456', targetParentVersion: 3,
        rootTitle: 'Copy', childCount: 1, plannedTreeFingerprint,
      };
    }),
  })).rejects.toThrow(/fingerprint/i);
});

test('rejects copy preview identity that differs from canonical source or destination', async () => {
  await expect(runPreflight({
    operation: 'confluence_copy_tree_preview',
    input: { sourcePageId: '123', targetParentId: '456' },
    invokeJson: jest.fn(async (toolName, input) => {
      if (toolName === 'confluence_info') {
        return String(input.pageId) === '123'
          ? page('123', 'Release Notes', 'ENG', 7)
          : page('456', 'Operations Runbooks', 'OPS', 3);
      }
      return {
        sourcePageId: '999', sourceVersion: 7,
        targetParentId: '456', targetParentVersion: 3,
        rootTitle: 'Copy', childCount: 0, plannedTreeFingerprint: PLANNED_TREE_FINGERPRINT,
      };
    }),
  })).rejects.toMatchObject({ code: 'TARGET_MISMATCH' });
});

test('copy snapshot hash changes when the supplied planned-tree fingerprint changes', async () => {
  const run = (version) => runPreflight({
    operation: 'confluence_copy_tree_preview',
    input: { sourcePageId: '123', targetParentId: '456' },
    invokeJson: jest.fn(async (toolName, input) => {
      if (toolName === 'confluence_info') {
        return String(input.pageId) === '123'
          ? page('123', 'Release Notes', 'ENG', 7)
          : page('456', 'Operations Runbooks', 'OPS', 3);
      }
      return {
        sourcePageId: '123', sourceVersion: 7,
        targetParentId: '456', targetParentVersion: 3,
        rootTitle: 'Copy', childCount: 1,
        plannedTreeFingerprint: version === 4 ? PLANNED_TREE_FINGERPRINT : 'b'.repeat(64),
      };
    }),
  });

  const before = await run(4);
  const after = await run(5);
  expect(before.facts.plannedTreeFingerprint).not.toBe(after.facts.plannedTreeFingerprint);
  expect(before.snapshotHash).not.toBe(after.snapshotHash);
});

test('produces stable hashes from recursively sorted records', () => {
  const left = stableFingerprint({
    z: [{ y: 2, x: 1 }, 3],
    a: { b: 1, a: 2 },
  });
  const right = stableFingerprint({
    a: { a: 2, b: 1 },
    z: [{ x: 1, y: 2 }, 3],
  });

  expect(left).toMatch(/^[a-f0-9]{64}$/);
  expect(left).toBe(right);
});
