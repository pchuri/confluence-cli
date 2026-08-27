const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_LIMITS,
  LIMIT_ENV,
  readWriteConfig,
  assertWriteEnabled,
  assertAllowedSpaces,
  resolveProjectInputFile,
  resolveProjectOutputPath,
  snapshotFile,
  verifyFileSnapshots,
  validateAndNormalizePayload,
  confirmWrite,
} = require('../lib/pi/write-authorization');

function makeProjectFixture() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-write-auth-project-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-write-auth-outside-'));
  const siblingOutsideFile = path.join(path.dirname(projectRoot), 'outside.txt');
  const escapeLink = path.join(projectRoot, 'escape');
  const insideFile = path.join(projectRoot, 'inside.txt');
  const bodyFile = path.join(projectRoot, 'body.md');
  const valueFile = path.join(projectRoot, 'value.json');
  const attachmentFile = path.join(projectRoot, 'attachment.bin');

  fs.writeFileSync(siblingOutsideFile, 'outside project');
  fs.writeFileSync(path.join(outsideRoot, 'secret.txt'), 'top secret');
  fs.writeFileSync(insideFile, 'Hello project');
  fs.writeFileSync(bodyFile, 'Body from file');
  fs.writeFileSync(valueFile, '{"flag":true}');
  fs.writeFileSync(attachmentFile, 'attachment');
  fs.symlinkSync(outsideRoot, escapeLink, 'dir');

  return {
    projectRoot,
    outsideRoot,
    siblingOutsideFile,
    insideFile,
    bodyFile,
    valueFile,
    attachmentFile,
    cleanup() {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      fs.rmSync(outsideRoot, { recursive: true, force: true });
      fs.rmSync(siblingOutsideFile, { force: true });
    },
  };
}

function makeUi() {
  return {
    confirm: jest.fn(),
    input: jest.fn(),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('exports the exact defaults and environment variable names', () => {
  expect(DEFAULT_LIMITS).toEqual({
    maxBodyBytes: 1_048_576,
    maxPropertyBytes: 262_144,
    maxAttachmentFiles: 10,
    maxAttachmentFileBytes: 26_214_400,
    maxAttachmentTotalBytes: 104_857_600,
  });
  expect(LIMIT_ENV).toEqual({
    maxBodyBytes: 'CONFLUENCE_PI_MAX_BODY_BYTES',
    maxPropertyBytes: 'CONFLUENCE_PI_MAX_PROPERTY_BYTES',
    maxAttachmentFiles: 'CONFLUENCE_PI_MAX_ATTACHMENT_FILES',
    maxAttachmentFileBytes: 'CONFLUENCE_PI_MAX_ATTACHMENT_FILE_BYTES',
    maxAttachmentTotalBytes: 'CONFLUENCE_PI_MAX_ATTACHMENT_TOTAL_BYTES',
  });
});

test('requires exact write opt-in and an explicit space list', () => {
  expect(readWriteConfig({}).enabled).toBe(false);
  expect(readWriteConfig({ CONFLUENCE_PI_WRITES: 'TRUE', CONFLUENCE_PI_WRITE_SPACES: 'ENG' }).enabled).toBe(false);
  expect(readWriteConfig({ CONFLUENCE_PI_WRITES: 'true', CONFLUENCE_PI_WRITE_SPACES: ' eng, OPS,eng ' }))
    .toMatchObject({ enabled: true });
  expect(Array.from(readWriteConfig({ CONFLUENCE_PI_WRITES: 'true', CONFLUENCE_PI_WRITE_SPACES: ' eng, OPS,eng ' }).spaces))
    .toEqual(['ENG', 'OPS']);
});

test('rejects wildcard space keys but keeps registration eligible with invalid execution limits', () => {
  expect(readWriteConfig({
    CONFLUENCE_PI_WRITES: 'true',
    CONFLUENCE_PI_WRITE_SPACES: 'ENG,*',
  }).enabled).toBe(false);

  for (const invalidLimit of [
    { CONFLUENCE_PI_MAX_BODY_BYTES: '0' },
    { CONFLUENCE_PI_MAX_PROPERTY_BYTES: '1.2' },
    { CONFLUENCE_PI_MAX_ATTACHMENT_TOTAL_BYTES: '9007199254740992' },
  ]) {
    const env = {
      CONFLUENCE_PI_WRITES: 'true',
      CONFLUENCE_PI_WRITE_SPACES: 'ENG',
      ...invalidLimit,
    };
    expect(readWriteConfig(env)).toMatchObject({ enabled: true, limitsValid: false });
    expect(() => assertWriteEnabled(env)).toThrow(expect.objectContaining({ code: 'INVALID_LIMITS' }));
  }
});

test.each(['1', 'true', 'TRUE', 'yes', 'On'])(
  'blocks writes for true-like CONFLUENCE_READ_ONLY=%s',
  (value) => {
    expect(() => assertWriteEnabled({
      CONFLUENCE_PI_WRITES: 'true',
      CONFLUENCE_PI_WRITE_SPACES: 'ENG',
      CONFLUENCE_READ_ONLY: value,
    })).toThrow(/read.only/i);
  },
);

test('returns parsed spaces and limits when writes are enabled', () => {
  const config = assertWriteEnabled({
    CONFLUENCE_PI_WRITES: 'true',
    CONFLUENCE_PI_WRITE_SPACES: ' eng, OPS,eng ',
    CONFLUENCE_PI_MAX_BODY_BYTES: '2048',
    CONFLUENCE_PI_MAX_PROPERTY_BYTES: '1024',
    CONFLUENCE_PI_MAX_ATTACHMENT_FILES: '2',
    CONFLUENCE_PI_MAX_ATTACHMENT_FILE_BYTES: '64',
    CONFLUENCE_PI_MAX_ATTACHMENT_TOTAL_BYTES: '96',
  });

  expect(Array.from(config.spaces)).toEqual(['ENG', 'OPS']);
  expect(config.limits).toEqual({
    maxBodyBytes: 2048,
    maxPropertyBytes: 1024,
    maxAttachmentFiles: 2,
    maxAttachmentFileBytes: 64,
    maxAttachmentTotalBytes: 96,
  });
});

test('requires every resolved target space to be allowed and normalizes Set entries', () => {
  expect(() => assertAllowedSpaces([
    { role: 'source', spaceKey: 'ENG' },
    { role: 'destination', spaceKey: 'OPS' },
  ], new Set(['ENG']))).toThrow(/OPS/);
  expect(() => assertAllowedSpaces([
    { role: 'source', spaceKey: 'ENG' },
  ], new Set(['eng']))).not.toThrow();
});

test('keeps personal-space allowlists case-insensitive', () => {
  expect(() => assertAllowedSpaces([
    { role: 'destination', spaceKey: '~alice' },
  ], new Set(['~ALICE']))).not.toThrow();
});

test('rejects project escapes for input and output paths', () => {
  const fixture = makeProjectFixture();
  try {
    expect(() => resolveProjectInputFile(fixture.projectRoot, '../outside.txt')).toThrow(/project/i);
    expect(() => resolveProjectInputFile(fixture.projectRoot, 'escape/secret.txt')).toThrow(/project/i);
    expect(() => resolveProjectOutputPath(fixture.projectRoot, 'escape/new.txt')).toThrow(/project/i);
  } finally {
    fixture.cleanup();
  }
});

test('rejects dangling symlink ancestors for output paths', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-write-auth-project-'));
  const danglingTarget = path.join(os.tmpdir(), `pi-write-auth-dangling-${Date.now()}-${Math.random()}`);
  const danglingLink = path.join(projectRoot, 'dangling');
  fs.symlinkSync(danglingTarget, danglingLink, 'dir');

  try {
    expect(() => resolveProjectOutputPath(projectRoot, 'dangling/new.txt')).toThrow(/project/i);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('canonicalizes project-contained input files and output paths', () => {
  const fixture = makeProjectFixture();
  try {
    expect(resolveProjectInputFile(fixture.projectRoot, 'inside.txt')).toBe(fs.realpathSync(fixture.insideFile));
    expect(resolveProjectOutputPath(fixture.projectRoot, 'new-folder/new-page.txt'))
      .toBe(path.join(fs.realpathSync(fixture.projectRoot), 'new-folder/new-page.txt'));
  } finally {
    fixture.cleanup();
  }
});

test('captures and verifies immutable file snapshots', () => {
  const fixture = makeProjectFixture();
  try {
    const snapshot = snapshotFile(fixture.insideFile);
    expect(snapshot).toMatchObject({
      path: fs.realpathSync(fixture.insideFile),
      size: fs.statSync(fixture.insideFile).size,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => verifyFileSnapshots([snapshot])).not.toThrow();

    fs.writeFileSync(fixture.insideFile, 'Hello altered');
    expect(() => verifyFileSnapshots([snapshot])).toThrow(/snapshot/i);
  } finally {
    fixture.cleanup();
  }
});

test('rejects unknown operations fail closed', () => {
  const fixture = makeProjectFixture();
  try {
    expect(() => validateAndNormalizePayload(
      'not_a_real_operation',
      { title: 'Release Notes' },
      fixture.projectRoot,
      DEFAULT_LIMITS,
    )).toThrow(/not allowed/i);
  } finally {
    fixture.cleanup();
  }
});

test('normalizes create payloads and snapshots body files', () => {
  const fixture = makeProjectFixture();
  try {
    const result = validateAndNormalizePayload(
      'confluence_create',
      { title: 'Release Notes', spaceKey: 'ENG', contentFile: 'body.md', type: 'page' },
      fixture.projectRoot,
      DEFAULT_LIMITS,
    );

    expect(result.input).toMatchObject({
      title: 'Release Notes',
      spaceKey: 'ENG',
      contentFile: fs.realpathSync(fixture.bodyFile),
      bodyBytes: Buffer.byteLength('Body from file'),
      type: 'page',
    });
    expect(result.fileSnapshots).toHaveLength(1);
    expect(result.fileSnapshots[0]).toMatchObject({ path: fs.realpathSync(fixture.bodyFile) });
  } finally {
    fixture.cleanup();
  }
});

test('rejects create payloads with both inline and file bodies or folder bodies', () => {
  const fixture = makeProjectFixture();
  try {
    expect(() => validateAndNormalizePayload(
      'confluence_create',
      { title: 'Release Notes', spaceKey: 'ENG', content: 'body', contentFile: 'body.md', type: 'page' },
      fixture.projectRoot,
      DEFAULT_LIMITS,
    )).toThrow(/only one/i);

    expect(() => validateAndNormalizePayload(
      'confluence_create',
      { title: 'Release Notes', spaceKey: 'ENG', content: 'body', type: 'folder' },
      fixture.projectRoot,
      DEFAULT_LIMITS,
    )).toThrow(/folder/i);
  } finally {
    fixture.cleanup();
  }
});

test('enforces update title/body presence and UTF-8 byte limits', () => {
  const fixture = makeProjectFixture();
  try {
    expect(() => validateAndNormalizePayload(
      'confluence_update',
      { pageId: '123', format: 'storage' },
      fixture.projectRoot,
      DEFAULT_LIMITS,
    )).toThrow(/title|content/i);

    expect(() => validateAndNormalizePayload(
      'confluence_update',
      { pageId: '123', content: 'éé', format: 'storage' },
      fixture.projectRoot,
      { ...DEFAULT_LIMITS, maxBodyBytes: 3 },
    )).toThrow(/body/i);

    const result = validateAndNormalizePayload(
      'confluence_update',
      { pageId: '123', title: 'Changed', content: 'Body', format: 'storage' },
      fixture.projectRoot,
      DEFAULT_LIMITS,
    );
    expect(result.input).toMatchObject({ title: 'Changed', content: 'Body', bodyBytes: 4 });
  } finally {
    fixture.cleanup();
  }
});

test('normalizes property values and enforces serialized JSON byte limits', () => {
  const fixture = makeProjectFixture();
  try {
    const result = validateAndNormalizePayload(
      'confluence_property_set',
      { pageId: '123', key: 'meta', value: { greeting: 'hi' } },
      fixture.projectRoot,
      DEFAULT_LIMITS,
    );
    expect(result.input.value).toBe('{"greeting":"hi"}');
    expect(result.fileSnapshots).toHaveLength(0);

    expect(() => validateAndNormalizePayload(
      'confluence_property_set',
      { pageId: '123', key: 'meta', value: { emoji: 'é' } },
      fixture.projectRoot,
      { ...DEFAULT_LIMITS, maxPropertyBytes: 10 },
    )).toThrow(/property/i);
  } finally {
    fixture.cleanup();
  }
});

test('parses property JSON files during normalization before confirmation', () => {
  const fixture = makeProjectFixture();
  try {
    const result = validateAndNormalizePayload(
      'confluence_property_set',
      { pageId: '123', key: 'meta', valueFile: 'value.json' },
      fixture.projectRoot,
      DEFAULT_LIMITS,
    );
    expect(result.input).toMatchObject({
      valueFile: fs.realpathSync(fixture.valueFile),
      propertyBytes: Buffer.byteLength('{"flag":true}'),
    });

    fs.writeFileSync(fixture.valueFile, '{not json');
    expect(() => validateAndNormalizePayload(
      'confluence_property_set',
      { pageId: '123', key: 'meta', valueFile: 'value.json' },
      fixture.projectRoot,
      DEFAULT_LIMITS,
    )).toThrow(expect.objectContaining({ code: 'PAYLOAD_INVALID' }));
  } finally {
    fixture.cleanup();
  }
});

test('enforces attachment count, per-file, and total size limits', () => {
  const fixture = makeProjectFixture();
  try {
    expect(() => validateAndNormalizePayload(
      'confluence_attachment_upload',
      { pageId: '123', files: ['attachment.bin', 'body.md'] },
      fixture.projectRoot,
      { ...DEFAULT_LIMITS, maxAttachmentFiles: 1 },
    )).toThrow(/attachment/i);

    expect(() => validateAndNormalizePayload(
      'confluence_attachment_upload',
      { pageId: '123', files: ['attachment.bin'] },
      fixture.projectRoot,
      { ...DEFAULT_LIMITS, maxAttachmentFileBytes: 3 },
    )).toThrow(/attachment/i);

    expect(() => validateAndNormalizePayload(
      'confluence_attachment_upload',
      { pageId: '123', files: ['attachment.bin', 'body.md'] },
      fixture.projectRoot,
      { ...DEFAULT_LIMITS, maxAttachmentTotalBytes: 15 },
    )).toThrow(/attachment/i);
  } finally {
    fixture.cleanup();
  }
});

test('requires a UI and honors cancellation and exact confirmation phrases', async () => {
  const signal = new AbortController().signal;
  const ctx = { hasUI: false, ui: makeUi() };
  await expect(confirmWrite({
    ctx,
    signal,
    title: 'Confluence write confirmation',
    message: 'Release Notes (ID: 12345, SPACE: ENG)',
  })).rejects.toMatchObject({ code: 'NO_UI' });
});

test('confirms non-destructive writes with canonical page text', async () => {
  const signal = new AbortController().signal;
  const ctx = { hasUI: true, ui: makeUi() };
  ctx.ui.confirm.mockResolvedValue(true);

  await expect(confirmWrite({
    ctx,
    signal,
    title: 'Confluence write confirmation',
    message: 'Release Notes (ID: 12345, SPACE: ENG)',
  })).resolves.toBeUndefined();

  expect(ctx.ui.confirm).toHaveBeenCalledWith(
    'Confluence write confirmation',
    expect.stringContaining('Release Notes (ID: 12345, SPACE: ENG)'),
    expect.objectContaining({ signal }),
  );
});

test('cancels non-destructive confirmations when the user says no', async () => {
  const signal = new AbortController().signal;
  const ctx = { hasUI: true, ui: makeUi() };
  ctx.ui.confirm.mockResolvedValue(false);

  await expect(confirmWrite({
    ctx,
    signal,
    title: 'Confluence write confirmation',
    message: 'Release Notes (ID: 12345, SPACE: ENG)',
  })).rejects.toMatchObject({ code: 'CANCELLED' });
});

test('requires an exact destructive phrase', async () => {
  const signal = new AbortController().signal;
  const ctx = { hasUI: true, ui: makeUi() };
  ctx.ui.input.mockResolvedValue('delete page 12345');

  await expect(confirmWrite({
    ctx,
    signal,
    title: 'Confluence write confirmation',
    message: 'Release Notes (ID: 12345, SPACE: ENG)',
    phrase: 'DELETE PAGE 12345',
  })).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' });

  expect(ctx.ui.input).toHaveBeenCalledWith(
    'Confluence destructive confirmation\nRelease Notes (ID: 12345, SPACE: ENG)',
    'Type exactly: DELETE PAGE 12345',
    expect.objectContaining({ signal }),
  );
});

test('accepts an exact destructive confirmation phrase', async () => {
  const signal = new AbortController().signal;
  const ctx = { hasUI: true, ui: makeUi() };
  ctx.ui.input.mockResolvedValue('DELETE PAGE 12345');

  await expect(confirmWrite({
    ctx,
    signal,
    title: 'Confluence write confirmation',
    message: 'Release Notes (ID: 12345, SPACE: ENG)',
    phrase: 'DELETE PAGE 12345',
  })).resolves.toBeUndefined();
});
