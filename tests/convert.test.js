const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ConfluenceClient = require('../lib/confluence-client');

const CLI = path.resolve(__dirname, '../bin/index.js');

function run(args, input) {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    input,
    timeout: 10000,
  });
}

describe('createLocalConverter', () => {
  test('creates instance without server config', () => {
    const converter = ConfluenceClient.createLocalConverter();
    expect(converter).toBeInstanceOf(ConfluenceClient);
    expect(converter.markdown).toBeDefined();
  });

  test('converts markdown to storage format', () => {
    const converter = ConfluenceClient.createLocalConverter();
    const result = converter.markdownToStorage('# Hello');
    expect(result).toContain('<h1>');
    expect(result).toContain('Hello');
  });

  test('converts storage to markdown', () => {
    const converter = ConfluenceClient.createLocalConverter();
    const result = converter.storageToMarkdown('<h1>Hello</h1><p>World</p>');
    expect(result).toContain('# Hello');
    expect(result).toContain('World');
  });

  test('preserves htmlToMarkdown surface', () => {
    const converter = ConfluenceClient.createLocalConverter();
    expect(typeof converter.htmlToMarkdown).toBe('function');
    const result = converter.htmlToMarkdown('<p><strong>bold</strong></p>');
    expect(result).toContain('**bold**');
  });

  test('preserves NAMED_ENTITIES export', () => {
    expect(ConfluenceClient.NAMED_ENTITIES).toBeDefined();
    expect(ConfluenceClient.NAMED_ENTITIES.aring).toBe('å');
  });
});

describe('convert command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-convert-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeInput(name, content) {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  test('markdown to storage via stdout', () => {
    const inputFile = writeInput('input.md', '# Hello\n\nWorld\n');
    const output = run(['convert', '--input-file', inputFile, '--input-format', 'markdown', '--output-format', 'storage']);
    expect(output).toContain('<h1>');
    expect(output).toContain('Hello');
    expect(output).toContain('World');
  });

  test('markdown to storage via files', () => {
    const inputFile = writeInput('input.md', '# Test\n\nParagraph\n');
    const outputFile = path.join(tmpDir, 'output.xml');
    run(['convert', '--input-file', inputFile, '--output-file', outputFile, '--input-format', 'markdown', '--output-format', 'storage']);
    const output = fs.readFileSync(outputFile, 'utf-8');
    expect(output).toContain('<h1>');
    expect(output).toContain('Test');
  });

  test('storage to markdown', () => {
    const inputFile = writeInput('input.xml', '<h1>Title</h1><p>Content</p>');
    const output = run(['convert', '--input-file', inputFile, '--input-format', 'storage', '--output-format', 'markdown']);
    expect(output).toContain('# Title');
    expect(output).toContain('Content');
  });

  test('markdown to html', () => {
    const inputFile = writeInput('input.md', '**bold**');
    const output = run(['convert', '--input-file', inputFile, '--input-format', 'markdown', '--output-format', 'html']);
    expect(output).toContain('<strong>bold</strong>');
  });

  test('storage to text', () => {
    const inputFile = writeInput('input.xml', '<h1>Title</h1><p>Content</p>');
    const output = run(['convert', '--input-file', inputFile, '--input-format', 'storage', '--output-format', 'text']);
    expect(output.toLowerCase()).toContain('title');
    expect(output).toContain('Content');
  });

  test('errors on missing --input-format', () => {
    const inputFile = writeInput('input.md', '');
    expect(() => run(['convert', '--input-file', inputFile, '--output-format', 'storage'])).toThrow();
  });

  test('errors on missing --output-format', () => {
    const inputFile = writeInput('input.md', '');
    expect(() => run(['convert', '--input-file', inputFile, '--input-format', 'markdown'])).toThrow();
  });

  test('errors on same input and output format', () => {
    const inputFile = writeInput('input.md', '');
    expect(() => run(['convert', '--input-file', inputFile, '--input-format', 'markdown', '--output-format', 'markdown'])).toThrow();
  });

  test('errors on invalid format', () => {
    const inputFile = writeInput('input.md', '');
    expect(() => run(['convert', '--input-file', inputFile, '--input-format', 'xml', '--output-format', 'storage'])).toThrow();
  });
});
