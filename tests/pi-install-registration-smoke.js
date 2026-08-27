#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createJiti } = require('jiti');

const packageRoot = path.resolve(__dirname, '..');
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-pi-agent-'));
const piExecutable = process.env.PI_EXECUTABLE || 'pi';
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('CONFLUENCE_')),
);
const env = {
  ...cleanEnv,
  PI_CODING_AGENT_DIR: agentDir,
  PI_OFFLINE: '1',
  PI_SKIP_VERSION_CHECK: '1',
  PI_TELEMETRY: '0',
};

function runPi(args) {
  const result = spawnSync(piExecutable, args, {
    cwd: packageRoot,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`pi ${args.join(' ')} failed (${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result.stdout;
}

function inventory(extensionModule, extensionEnv) {
  const names = [];
  extensionModule.createConfluenceExtension({ env: extensionEnv })({
    registerTool(tool) {
      names.push(tool.name);
    },
  });
  return names;
}

(async () => {
  try {
    runPi(['install', packageRoot]);
    const listed = runPi(['list']);
    const settings = JSON.parse(fs.readFileSync(path.join(agentDir, 'settings.json'), 'utf8'));
    assert.ok(Array.isArray(settings.packages));
    assert.ok(settings.packages.some((entry) => (
      typeof entry === 'string' ? path.resolve(entry) === packageRoot : path.resolve(entry.source) === packageRoot
    )));
    assert.match(listed, /confluence-cli|confluence/i);

    const jiti = createJiti(__filename);
    const extensionModule = await jiti.import(path.join(packageRoot, '.pi/extensions/confluence-cli.ts'));
    const readOnly = inventory(extensionModule, {});
    const protectedWrites = inventory(extensionModule, {
      CONFLUENCE_PI_WRITES: 'true',
      CONFLUENCE_PI_WRITE_SPACES: 'ENG',
      CONFLUENCE_PI_MAX_BODY_BYTES: 'invalid',
    });

    assert.equal(readOnly.length, 13);
    assert.equal(protectedWrites.length, 29);
    assert.ok(!protectedWrites.includes('confluence_api'));
    process.stdout.write(`${JSON.stringify({ installed: true, readTools: readOnly.length, protectedTools: protectedWrites.length, apiEscape: false })}\n`);
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
