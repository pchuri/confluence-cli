const { execFileSync } = require('child_process');
const path = require('path');

describe('CLI entry point', () => {
  test('confluence.js exports program with a parse method', () => {
    const { program } = require('../bin/confluence.js');
    expect(program).toBeDefined();
    expect(typeof program.parse).toBe('function');
  });

  test('bin/index.js --version prints version', () => {
    const output = execFileSync(
      process.execPath,
      [path.resolve(__dirname, '../bin/index.js'), '--version'],
      { encoding: 'utf8' }
    ).trim();
    expect(output).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('search --help documents start pagination option', () => {
    const output = execFileSync(
      process.execPath,
      [path.resolve(__dirname, '../bin/index.js'), 'search', '--help'],
      { encoding: 'utf8' }
    );
    expect(output).toContain('--start <start>');
    expect(output).toContain('Start index for results');
  });
});

describe('create/create-child --type validation', () => {
  const { _test } = require('../bin/confluence.js');
  const { assertValidType, assertNoBodyForFolder } = _test;

  test('assertValidType accepts "page" and "folder"', () => {
    expect(() => assertValidType('page')).not.toThrow();
    expect(() => assertValidType('folder')).not.toThrow();
  });

  test('assertValidType rejects unknown types with a helpful message', () => {
    expect(() => assertValidType('bogus')).toThrow(/Invalid type "bogus"\. Valid: page, folder/);
  });

  test('assertNoBodyForFolder allows pages with content', () => {
    expect(() => assertNoBodyForFolder('page', { content: 'hi' })).not.toThrow();
    expect(() => assertNoBodyForFolder('page', { file: '/tmp/x' })).not.toThrow();
  });

  test('assertNoBodyForFolder allows folders with no body', () => {
    expect(() => assertNoBodyForFolder('folder', {})).not.toThrow();
  });

  test('assertNoBodyForFolder rejects --type folder with --content', () => {
    expect(() => assertNoBodyForFolder('folder', { content: 'hi' }))
      .toThrow(/--file\/--content is not allowed with --type folder/);
  });

  test('assertNoBodyForFolder rejects --type folder with --file', () => {
    expect(() => assertNoBodyForFolder('folder', { file: '/tmp/x' }))
      .toThrow(/--file\/--content is not allowed with --type folder/);
  });
});
