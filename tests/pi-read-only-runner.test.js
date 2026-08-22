const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  READ_ONLY_COMMANDS,
  resolveProjectPath,
  buildArgs,
  redactText,
  runReadOnlyCommand,
} = require('../lib/pi/read-only-runner');
const { TOOL_OPERATIONS, TOOL_TO_OPERATION } = require('../lib/pi/tool-policy');

const packageRoot = path.resolve(__dirname, '..');
let projectRoot;

function makeFakePackage(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-confluence-package-'));
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'index.js'), source);
  return root;
}

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-confluence-project-'));
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test('allows exactly the read-only operations', () => {
  expect([...READ_ONLY_COMMANDS]).toEqual([
    'read', 'search', 'info', 'spaces', 'children', 'export', 'convert',
  ]);
  expect(() => buildArgs('delete', { pageId: '123' }, projectRoot)).toThrow(/not allowed/i);
  expect(() => buildArgs('api', { endpoint: 'content' }, projectRoot)).toThrow(/not allowed/i);
});

test('exposes exactly the typed read-only Pi tools', () => {
  expect(TOOL_OPERATIONS).toEqual([
    'confluence_read', 'confluence_search', 'confluence_info', 'confluence_spaces',
    'confluence_children', 'confluence_export', 'confluence_convert',
  ]);
  expect(TOOL_TO_OPERATION.confluence_read).toBe('read');
  expect(TOOL_TO_OPERATION.confluence_convert).toBe('convert');
  expect(TOOL_OPERATIONS).not.toContain('confluence_delete');
  expect(TOOL_OPERATIONS).not.toContain('confluence_api');
});

test('rejects paths outside the current project', () => {
  expect(() => resolveProjectPath(projectRoot, '../outside')).toThrow(/project directory/i);
  expect(() => resolveProjectPath(projectRoot, path.join(projectRoot, '..', 'outside'))).toThrow(/project directory/i);
});

test('builds fixed argv for every supported remote operation', () => {
  expect(buildArgs('read', { pageId: '123', format: 'markdown' }, projectRoot))
    .toEqual(['read', '123', '--format', 'markdown']);
  expect(buildArgs('search', { query: 'release notes', limit: 20, start: 5, cql: true }, projectRoot))
    .toEqual(['search', 'release notes', '--limit', '20', '--start', '5', '--cql']);
  expect(buildArgs('info', { pageId: '123' }, projectRoot)).toEqual(['info', '123']);
  expect(buildArgs('spaces', { limit: 25 }, projectRoot)).toEqual(['spaces', '--limit', '25']);
  expect(buildArgs('children', {
    pageId: '123', recursive: true, maxDepth: 3, type: 'all', format: 'tree', showUrl: true, showId: true,
  }, projectRoot)).toEqual([
    'children', '123', '--recursive', '--max-depth', '3', '--type', 'all', '--format', 'tree', '--show-url', '--show-id',
  ]);
  expect(buildArgs('export', {
    pageId: '123', destination: 'exports', format: 'markdown', file: 'page.md', recursive: true,
    maxDepth: 2, dryRun: true, referencedOnly: true,
  }, projectRoot)).toEqual([
    'export', '123', '--dest', path.join(projectRoot, 'exports'), '--format', 'markdown', '--skip-attachments',
    '--file', 'page.md', '--recursive', '--max-depth', '2', '--dry-run', '--referenced-only',
  ]);
});

test('builds package-local conversion argv and constrains input and output files', () => {
  fs.writeFileSync(path.join(projectRoot, 'input.md'), '# Hello');
  expect(buildArgs('convert', {
    inputFile: 'input.md', outputFile: 'output.xml', inputFormat: 'markdown', outputFormat: 'storage',
  }, projectRoot)).toEqual([
    'convert', '--input-file', path.join(projectRoot, 'input.md'), '--output-file', path.join(projectRoot, 'output.xml'),
    '--input-format', 'markdown', '--output-format', 'storage',
  ]);
  expect(() => buildArgs('convert', {
    inputFile: '../secret.md', inputFormat: 'markdown', outputFormat: 'storage',
  }, projectRoot)).toThrow(/project directory/i);
});

test('runs package-local conversion when confluence is absent from PATH', async () => {
  fs.writeFileSync(path.join(projectRoot, 'input.md'), '# Hello');
  const result = await runReadOnlyCommand({
    packageRoot,
    projectRoot,
    operation: 'convert',
    input: { inputFile: 'input.md', inputFormat: 'markdown', outputFormat: 'storage' },
    env: { PATH: '' },
    timeoutMs: 10_000,
    maxOutputBytes: 16_384,
  });
  expect(result.stdout).toContain('<h1>');
  expect(result.truncated).toBe(false);
});

test('requires direct configuration before issuing a remote request', async () => {
  await expect(runReadOnlyCommand({
    packageRoot,
    projectRoot,
    operation: 'read',
    input: { pageId: '123' },
    env: { PATH: '' },
    timeoutMs: 10_000,
    maxOutputBytes: 16_384,
  })).rejects.toThrow(/Confluence configuration/i);
});

test('truncates oversized subprocess output', async () => {
  const fakePackage = makeFakePackage('process.stdout.write(\'x\'.repeat(4096));');
  await expect(runReadOnlyCommand({
    packageRoot: fakePackage,
    projectRoot,
    operation: 'convert',
    input: { inputFile: 'input.md', inputFormat: 'markdown', outputFormat: 'storage' },
    env: { PATH: '' },
    timeoutMs: 10_000,
    maxOutputBytes: 128,
  })).resolves.toMatchObject({ truncated: true });
  fs.rmSync(fakePackage, { recursive: true, force: true });
});

test('terminates a timed-out subprocess', async () => {
  const fakePackage = makeFakePackage('setTimeout(() => {}, 60_000);');
  await expect(runReadOnlyCommand({
    packageRoot: fakePackage,
    projectRoot,
    operation: 'convert',
    input: { inputFile: 'input.md', inputFormat: 'markdown', outputFormat: 'storage' },
    env: { PATH: '' },
    timeoutMs: 25,
    maxOutputBytes: 16_384,
  })).rejects.toThrow(/timed out/i);
  fs.rmSync(fakePackage, { recursive: true, force: true });
});

test('redacts Confluence credentials from reported errors', async () => {
  const fakePackage = makeFakePackage('process.stderr.write(process.env.CONFLUENCE_API_TOKEN); process.exit(3);');
  const env = { PATH: '', CONFLUENCE_DOMAIN: 'example.internal', CONFLUENCE_API_TOKEN: 'secret-token' };
  expect(redactText('failed: secret-token', env)).toBe('failed: [REDACTED]');
  await expect(runReadOnlyCommand({
    packageRoot: fakePackage,
    projectRoot,
    operation: 'read',
    input: { pageId: '123' },
    env,
    timeoutMs: 10_000,
    maxOutputBytes: 16_384,
  })).rejects.not.toThrow(/secret-token/);
  fs.rmSync(fakePackage, { recursive: true, force: true });
});
