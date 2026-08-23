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
        pageId: '123',
        rootTitle: 'Release Notes (Copy)',
        childCount: 13,
      };
    }

    throw new Error(`unexpected tool ${toolName}`);
  });
}

test('resolves page titles and both move spaces', async () => {
  const invokeJson = makeInvokeJson();
  const result = await runPreflight({
    operation: 'confluence_move',
    input: { pageId: '123', newParentId: '456' },
    invokeJson,
  });

  expect(result.targets).toEqual([
    { role: 'source', pageId: '123', title: 'Release Notes', spaceKey: 'ENG' },
    { role: 'destination', pageId: '456', title: 'Operations Runbooks', spaceKey: 'OPS' },
  ]);
  expect(result.summary).toContain('Release Notes (ID: 123, SPACE: ENG)');
  expect(result.summary).toContain('Operations Runbooks (ID: 456, SPACE: OPS)');
});

test.each([
  ['confluence_create_child', { parentId: '456' }, 'Operations Runbooks (ID: 456, SPACE: OPS)'],
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

test('returns copy tree facts from the preview response rootTitle', async () => {
  const invokeJson = makeInvokeJson();
  const result = await runPreflight({
    operation: 'confluence_copy_tree_preview',
    input: { sourcePageId: '123', targetParentId: '456', title: 'Launch Notes', copySuffix: ' (Clone)' },
    invokeJson,
  });

  expect(result.facts).toEqual({
    rootTitle: 'Release Notes (Copy)',
    childCount: 13,
    totalCreateCount: 14,
  });
  expect(result.phrase).toBe('COPY 14 PAGES FROM 123 TO 456');
  expect(result.summary).toContain('Release Notes (ID: 123, SPACE: ENG)');
  expect(result.summary).toContain('Operations Runbooks (ID: 456, SPACE: OPS)');
  expect(result.summary).toContain('Release Notes (Copy)');
});

test('copy tree summary keeps canonical source and destination titles when planned root title differs', async () => {
  const invokeJson = jest.fn(async (toolName, input) => {
    if (toolName === 'confluence_info') {
      if (String(input.pageId) === '123') return page('123', 'Release Notes', 'ENG', 7);
      if (String(input.pageId) === '456') return page('456', 'Operations Runbooks', 'OPS', 3);
    }
    if (toolName === 'confluence_copy_tree_preview') {
      return { pageId: '123', rootTitle: 'Cloned Launch Plan', childCount: 13 };
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
