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
});

describe('convert command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-convert-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('markdown to storage via stdin/stdout', () => {
    const output = run(
      ['convert', '--input-format', 'markdown', '--output-format', 'storage'],
      '# Hello\n\nWorld\n'
    );
    expect(output).toContain('<h1>');
    expect(output).toContain('Hello');
    expect(output).toContain('World');
  });

  test('markdown to storage via files', () => {
    const inputFile = path.join(tmpDir, 'input.md');
    const outputFile = path.join(tmpDir, 'output.xml');
    fs.writeFileSync(inputFile, '# Test\n\nParagraph\n');
    run(['convert', '--input-file', inputFile, '--output-file', outputFile, '--input-format', 'markdown', '--output-format', 'storage']);
    const output = fs.readFileSync(outputFile, 'utf-8');
    expect(output).toContain('<h1>');
    expect(output).toContain('Test');
  });

  test('storage to markdown', () => {
    const output = run(
      ['convert', '--input-format', 'storage', '--output-format', 'markdown'],
      '<h1>Title</h1><p>Content</p>'
    );
    expect(output).toContain('# Title');
    expect(output).toContain('Content');
  });

  test('markdown to html', () => {
    const output = run(
      ['convert', '--input-format', 'markdown', '--output-format', 'html'],
      '**bold**'
    );
    expect(output).toContain('<strong>bold</strong>');
  });

  test('storage to text', () => {
    const output = run(
      ['convert', '--input-format', 'storage', '--output-format', 'text'],
      '<h1>Title</h1><p>Content</p>'
    );
    expect(output.toLowerCase()).toContain('title');
    expect(output).toContain('Content');
  });

  test('errors on missing --input-format', () => {
    expect(() => run(['convert', '--output-format', 'storage'], '')).toThrow();
  });

  test('errors on missing --output-format', () => {
    expect(() => run(['convert', '--input-format', 'markdown'], '')).toThrow();
  });

  test('errors on same input and output format', () => {
    expect(() => run(['convert', '--input-format', 'markdown', '--output-format', 'markdown'], '')).toThrow();
  });

  test('errors on invalid format', () => {
    expect(() => run(['convert', '--input-format', 'xml', '--output-format', 'storage'], '')).toThrow();
  });
});
