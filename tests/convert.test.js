const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ConfluenceClient = require('../lib/confluence-client');

const CLI = path.resolve(__dirname, '../bin/index.js');

function run(args, input, env) {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    input,
    timeout: 10000,
    env: env ? { ...process.env, ...env } : undefined,
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

  test('reads input from stdin when --input-file is omitted', () => {
    const output = run(
      ['convert', '--input-format', 'markdown', '--output-format', 'storage'],
      '# Piped\n\nbody\n'
    );
    expect(output).toContain('<h1>');
    expect(output).toContain('Piped');
    expect(output).toContain('body');
  });

  test('handles empty stdin without hanging or crashing', () => {
    const output = run(
      ['convert', '--input-format', 'markdown', '--output-format', 'storage'],
      ''
    );
    expect(output).toBe('');
  });

  test('markdown to storage via files', () => {
    const inputFile = writeInput('input.md', '# Test\n\nParagraph\n');
    const outputFile = path.join(tmpDir, 'output.xml');
    run(['convert', '--input-file', inputFile, '--output-file', outputFile, '--input-format', 'markdown', '--output-format', 'storage']);
    const output = fs.readFileSync(outputFile, 'utf-8');
    expect(output).toContain('<h1>');
    expect(output).toContain('Test');
  });

  test('markdown to storage emits the plain plantuml macro by default', () => {
    const inputFile = writeInput('input.md', '```plantuml\nA -> B\n```\n');
    const output = run(['convert', '--input-file', inputFile, '--input-format', 'markdown', '--output-format', 'storage']);
    expect(output).toContain('<ac:structured-macro ac:name="plantuml">');
    expect(output).not.toContain('plantumlcloud');
  });

  test('--plantuml-format plantumlcloud emits the cloud macro', () => {
    const inputFile = writeInput('input.md', '```plantuml\nA -> B\n```\n');
    const output = run([
      'convert', '--input-file', inputFile,
      '--input-format', 'markdown', '--output-format', 'storage',
      '--plantuml-format', 'plantumlcloud',
    ]);
    expect(output).toContain('<ac:structured-macro ac:name="plantumlcloud">');
    expect(output).toContain('<ac:parameter ac:name="filename">plantuml-diagram-1.svg</ac:parameter>');
  });

  test('CONFLUENCE_PLANTUML_FORMAT=plantumlcloud is honoured by convert', () => {
    const inputFile = writeInput('input.md', '```plantuml\nA -> B\n```\n');
    const output = run(
      ['convert', '--input-file', inputFile, '--input-format', 'markdown', '--output-format', 'storage'],
      undefined,
      { CONFLUENCE_PLANTUML_FORMAT: 'plantumlcloud' }
    );
    expect(output).toContain('<ac:structured-macro ac:name="plantumlcloud">');
  });

  test('CONFLUENCE_PLANTUML_FORMAT is case-insensitive and trimmed for convert', () => {
    const inputFile = writeInput('input.md', '```plantuml\nA -> B\n```\n');
    const output = run(
      ['convert', '--input-file', inputFile, '--input-format', 'markdown', '--output-format', 'storage'],
      undefined,
      { CONFLUENCE_PLANTUML_FORMAT: '  PlantUmlCloud  ' }
    );
    expect(output).toContain('<ac:structured-macro ac:name="plantumlcloud">');
  });

  test('invalid CONFLUENCE_PLANTUML_FORMAT warns once and falls back to plantuml for convert', () => {
    const inputFile = writeInput('input.md', '```plantuml\nA -> B\n```\n');
    const result = spawnSync(
      process.execPath,
      [CLI, 'convert', '--input-file', inputFile, '--input-format', 'markdown', '--output-format', 'storage'],
      { encoding: 'utf8', timeout: 10000, env: { ...process.env, CONFLUENCE_PLANTUML_FORMAT: 'puml' } }
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('<ac:structured-macro ac:name="plantuml">');
    expect(result.stdout).not.toContain('plantumlcloud');
    expect(result.stderr.match(/Invalid plantumlFormat from CONFLUENCE_PLANTUML_FORMAT "puml"/g)).toHaveLength(1);
  });

  test('--plantuml-format is case-insensitive', () => {
    const inputFile = writeInput('input.md', '```plantuml\nA -> B\n```\n');
    const output = run([
      'convert', '--input-file', inputFile,
      '--input-format', 'markdown', '--output-format', 'storage',
      '--plantuml-format', 'PlantUmlCloud',
    ]);
    expect(output).toContain('<ac:structured-macro ac:name="plantumlcloud">');
  });

  test('--plantuml-format overrides CONFLUENCE_PLANTUML_FORMAT', () => {
    const inputFile = writeInput('input.md', '```plantuml\nA -> B\n```\n');
    const output = run(
      [
        'convert', '--input-file', inputFile,
        '--input-format', 'markdown', '--output-format', 'storage',
        '--plantuml-format', 'plantuml',
      ],
      undefined,
      { CONFLUENCE_PLANTUML_FORMAT: 'plantumlcloud' }
    );
    expect(output).toContain('<ac:structured-macro ac:name="plantuml">');
    expect(output).not.toContain('plantumlcloud');
  });

  test('an empty --plantuml-format is rejected even when the env var is set', () => {
    const inputFile = writeInput('input.md', '```plantuml\nA -> B\n```\n');
    const result = spawnSync(
      process.execPath,
      [CLI, 'convert', '--input-file', inputFile, '--input-format', 'markdown', '--output-format', 'storage', '--plantuml-format', ''],
      { encoding: 'utf8', timeout: 10000, env: { ...process.env, CONFLUENCE_PLANTUML_FORMAT: 'plantumlcloud' } }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invalid --plantuml-format "". Valid: plantuml, plantumlcloud');
  });

  test('invalid --plantuml-format fails with the valid values listed', () => {
    const inputFile = writeInput('input.md', '```plantuml\nA -> B\n```\n');
    let thrown = null;
    try {
      run([
        'convert', '--input-file', inputFile,
        '--input-format', 'markdown', '--output-format', 'storage',
        '--plantuml-format', 'puml',
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.stderr.toString()).toContain('Invalid --plantuml-format "puml". Valid: plantuml, plantumlcloud');
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

  test('html to markdown preserves fenced code blocks with language', () => {
    // Multi-line <pre><code class="language-*"> is the discriminating case
    // between htmlToMarkdown and storageToMarkdown: the former emits a
    // fenced block with the language tag, the latter collapses the body
    // into inline `code` and drops the language. This test fails if the
    // html → markdown path is ever routed back through storageToMarkdown.
    const html = '<p><strong>bold</strong></p>\n<pre><code class="language-js">const x = 1;\nconst y = 2;</code></pre>';
    const inputFile = writeInput('input.html', html);
    const output = run(['convert', '--input-file', inputFile, '--input-format', 'html', '--output-format', 'markdown']);
    expect(output).toContain('**bold**');
    expect(output).toMatch(/```js\nconst x = 1;\nconst y = 2;\n```/);
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
