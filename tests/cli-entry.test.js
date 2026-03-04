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
});
