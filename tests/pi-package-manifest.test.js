const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');
const packageRoot = path.resolve(__dirname, '..');

test('declares the bundled Confluence skill and Pi extension', () => {
  expect(packageJson.pi).toEqual({
    skills: ['./plugins/confluence/skills'],
    extensions: ['./.pi/extensions/confluence-cli.ts'],
  });
});

test('publishes the Pi extension and declares Pi runtime peers', () => {
  expect(packageJson.files).toContain('.pi/');
  expect(packageJson.peerDependencies['@earendil-works/pi-coding-agent']).toBe('*');
  expect(packageJson.peerDependencies.typebox).toBe('*');
  expect(fs.existsSync(path.join(__dirname, '../.pi/extensions/confluence-cli.ts'))).toBe(true);
});

test('includes Pi resources in the npm package tarball', () => {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: packageRoot,
    encoding: 'utf8',
  }));
  const names = packed[0].files.map((file) => file.path);
  expect(names).toEqual(expect.arrayContaining([
    '.pi/extensions/confluence-cli.ts',
    'plugins/confluence/skills/confluence/SKILL.md',
    'bin/index.js',
    'lib/pi/read-only-runner.js',
    'lib/pi/tool-policy.js',
  ]));
});
