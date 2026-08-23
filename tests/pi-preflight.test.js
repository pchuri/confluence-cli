const { runPreflight, stableFingerprint } = require('../lib/pi/preflight');

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
        plannedTree: Array.from({ length: 13 }, (_, index) => ({
          id: String(200 + index), parentId: index === 0 ? '123' : String(199 + index), title: `Child ${index}`, version: 4,
        })),
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

test('resolves create destination from one canonical accessible space', async () => {
  const result = await runPreflight({
    operation: 'confluence_create',
    input: { title: 'New Page', spaceKey: 'eng', content: 'body' },
    invokeJson: jest.fn(async () => ({
      spaceCount: 2,
      spaces: [{ key: 'ENG', name: 'Engineering' }, { key: 'OPS', name: 'Operations' }],
    })),
  });

  expect(result.input.spaceKey).toBe('ENG');
  expect(result.targets).toEqual([{ role: 'destination', title: 'Engineering', spaceKey: 'ENG' }]);
  expect(result.summary).toContain('Engineering (SPACE: ENG)');
});

test.each([
  ['missing', [{ key: 'OPS', name: 'Operations' }]],
  ['ambiguous', [{ key: 'ENG', name: 'Engineering' }, { key: 'eng', name: 'Duplicate' }]],
])('rejects a %s create destination space', async (_label, spaces) => {
  await expect(runPreflight({
    operation: 'confluence_create',
    input: { title: 'New Page', spaceKey: 'ENG', content: 'body' },
    invokeJson: jest.fn(async () => ({ spaceCount: spaces.length, spaces })),
  })).rejects.toMatchObject({ code: expect.stringMatching(/SPACE/) });
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
    invokeJson: jest.fn(async () => ({ spaceCount: 1, spaces: [{ key: 'ENG', name: 'Engineering' }] })),
  });

  expect(result.summary).toContain('New Page');
  expect(result.summary).toContain('Engineering (SPACE: ENG)');
  expect(result.summary).toContain('11 bytes');
  expect(result.summary).toContain('markdown');
  expect(result.summary).toContain('page');
  expect(result.summary).not.toContain('secret body');
});

test('resolves comment, attachment, and property ownership through confluence_info before checking list JSON shapes', async () => {
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
  expect(invokeJson).toHaveBeenCalledWith('confluence_comments', expect.objectContaining({ pageId: '123', start: 0 }));
  expect(invokeJson).toHaveBeenCalledWith('confluence_attachments', expect.objectContaining({ pageId: '123', start: 0 }));
  expect(invokeJson).toHaveBeenCalledWith('confluence_property_list', expect.objectContaining({ pageId: '123', start: 0 }));
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
    operation: 'confluence_comment_delete',
    input: { pageId: '123', commentId: '88' },
    invokeJson: jest.fn(async (_toolName, input) => ({
      id: '123',
      title: 'Release Notes',
      space: { key: 'ENG' },
      results: input.start === 0 ? [{ id: '1' }] : [{ id: '2' }],
      nextStart: 0,
    })),
  })).rejects.toThrow(/cursor|loop/i);

  await expect(runPreflight({
    operation: 'confluence_comment_delete',
    input: { pageId: '123', commentId: '88' },
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
    plannedTreeFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
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
        plannedTree: Array.from({ length: 13 }, (_, index) => ({
          id: String(200 + index), parentId: index === 0 ? '123' : String(199 + index), title: `Child ${index}`, version: 4,
        })),
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
        rootTitle: 'Copy', childCount, plannedTree: [],
      };
    }),
  })).rejects.toMatchObject({ code: 'MALFORMED_RESULT' });
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
        rootTitle: 'Copy', childCount: 0, plannedTree: [],
      };
    }),
  })).rejects.toMatchObject({ code: 'TARGET_MISMATCH' });
});

test('copy snapshot hash changes when a planned descendant version changes', async () => {
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
        plannedTree: [{ id: '200', parentId: '123', title: 'Child', version }],
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
