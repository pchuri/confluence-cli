#!/usr/bin/env bash
set -euo pipefail

# Generate an npm-shrinkwrap.json that locks only production dependencies.
# We derive it by filtering the checked-in package-lock.json (removing
# entries with "dev": true and clearing root.devDependencies) instead of
# re-resolving from the registry. Re-resolving would let runtime packages
# drift to newer semver-compatible versions than what CI verified, which
# defeats the supply-chain hardening the shrinkwrap is meant to provide.

node -e '
const fs = require("fs");

const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));

if (lock.lockfileVersion !== 3) {
  console.error("Expected lockfileVersion 3, got " + lock.lockfileVersion);
  process.exit(1);
}

const packages = {};
for (const [key, value] of Object.entries(lock.packages)) {
  if (value.dev) continue;
  if (key === "") {
    const { devDependencies, ...rest } = value;
    packages[key] = rest;
  } else {
    packages[key] = value;
  }
}

const out = { ...lock, packages };
fs.writeFileSync("npm-shrinkwrap.json", JSON.stringify(out, null, 2) + "\n");
console.log("Generated npm-shrinkwrap.json with " + (Object.keys(packages).length - 1) + " prod packages");
'
