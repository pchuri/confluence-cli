#!/usr/bin/env bash
set -euo pipefail

# Generate an npm-shrinkwrap.json that locks only production dependencies.
# `npm prune --omit=dev` does not remove dev entries from package-lock.json,
# so we resolve a fresh lockfile from a package.json with devDependencies
# stripped. This keeps the published shrinkwrap free of devDependency
# metadata, which npm would otherwise install under the consumer's
# node_modules/<pkg>/node_modules as extraneous packages.

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
delete pkg.devDependencies;
fs.writeFileSync(process.argv[1] + '/package.json', JSON.stringify(pkg, null, 2));
" "$tmpdir"

(cd "$tmpdir" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null)

rm -f npm-shrinkwrap.json
mv "$tmpdir/package-lock.json" ./npm-shrinkwrap.json

echo "Generated npm-shrinkwrap.json with $(node -e "console.log(Object.keys(require('./npm-shrinkwrap.json').packages).length)") prod packages"
