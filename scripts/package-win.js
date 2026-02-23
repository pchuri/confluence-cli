#!/usr/bin/env node

/**
 * Windows Package Builder for Winget Distribution
 *
 * This script creates a ZIP archive containing the confluence-cli application
 * with all production dependencies for Windows package managers.
 *
 * Usage: npm run package:win
 *
 * Output: confluence-cli-{version}-win.zip in the dist/ directory
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packageJson = require('../package.json');
const archiver = require('archiver');

const VERSION = packageJson.version;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const OUTPUT_FILE = path.join(DIST_DIR, `confluence-cli-${VERSION}-win.zip`);

// Files and directories to include in the archive
const INCLUDE_PATTERNS = [
  'bin/**/*',
  'lib/**/*',
  'node_modules/**/*',
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE'
];

// Files and directories to exclude
const EXCLUDE_PATTERNS = [
  'node_modules/.bin',
  'node_modules/.cache',
  '**/.DS_Store',
  '**/test/**',
  '**/tests/**',
  '**/*.test.js',
  '**/*.spec.js'
];

async function createZipArchive() {
  console.log(`Building Windows package for confluence-cli v${VERSION}...`);

  // Ensure dist directory exists
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
    console.log(`Created dist directory: ${DIST_DIR}`);
  }

  // Remove existing archive if it exists
  if (fs.existsSync(OUTPUT_FILE)) {
    fs.unlinkSync(OUTPUT_FILE);
    console.log(`Removed existing archive: ${OUTPUT_FILE}`);
  }

  // Create write stream for ZIP
  const output = fs.createWriteStream(OUTPUT_FILE);
  const archive = archiver('zip', {
    zlib: { level: 9 } // Maximum compression
  });

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      const sizeInMB = (archive.pointer() / 1024 / 1024).toFixed(2);
      console.log(`\n✅ Package created successfully!`);
      console.log(`   File: ${OUTPUT_FILE}`);
      console.log(`   Size: ${sizeInMB} MB (${archive.pointer()} bytes)`);

      // Calculate SHA256 for Winget manifest
      const sha256 = execSync(`shasum -a 256 "${OUTPUT_FILE}" | cut -d ' ' -f 1`, { encoding: 'utf-8' }).trim();
      console.log(`   SHA256: ${sha256}`);

      resolve({ file: OUTPUT_FILE, size: archive.pointer(), sha256 });
    });

    output.on('error', reject);
    archive.on('error', reject);

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn(`Warning: ${err.message}`);
      } else {
        reject(err);
      }
    });

    // Pipe archive data to the file
    archive.pipe(output);

    // Add files to archive
    console.log('\nAdding files to archive...');

    // Add package.json
    archive.file('package.json', { name: 'package.json' });
    console.log('  ✓ package.json');

    // Add package-lock.json if it exists
    if (fs.existsSync('package-lock.json')) {
      archive.file('package-lock.json', { name: 'package-lock.json' });
      console.log('  ✓ package-lock.json');
    }

    // Add README.md
    if (fs.existsSync('README.md')) {
      archive.file('README.md', { name: 'README.md' });
      console.log('  ✓ README.md');
    }

    // Add LICENSE
    if (fs.existsSync('LICENSE')) {
      archive.file('LICENSE', { name: 'LICENSE' });
      console.log('  ✓ LICENSE');
    }

    // Add bin directory
    if (fs.existsSync('bin')) {
      archive.directory('bin/', 'bin');
      console.log('  ✓ bin/');
    }

    // Add lib directory
    if (fs.existsSync('lib')) {
      archive.directory('lib/', 'lib');
      console.log('  ✓ lib/');
    }

    // Add node_modules (production only - should be already cleaned by npm ci --omit=dev)
    if (fs.existsSync('node_modules')) {
      archive.directory('node_modules/', 'node_modules', (entry) => {
        // Exclude test files and directories
        if (entry.name.includes('/.bin/') ||
            entry.name.includes('/.cache/') ||
            entry.name.includes('/test/') ||
            entry.name.includes('/tests/') ||
            entry.name.endsWith('.test.js') ||
            entry.name.endsWith('.spec.js') ||
            entry.name.endsWith('.DS_Store')) {
          return false;
        }
        return entry;
      });
      console.log('  ✓ node_modules/ (production dependencies)');
    }

    // Finalize the archive
    archive.finalize();
  });
}

// Main execution
(async () => {
  try {
    // Verify production dependencies are installed
    if (!fs.existsSync('node_modules')) {
      console.error('❌ Error: node_modules not found!');
      console.error('   Please run: npm ci --omit=dev');
      process.exit(1);
    }

    await createZipArchive();

    console.log('\n📦 Next steps for Winget release:');
    console.log('   1. Upload the ZIP file to GitHub release assets');
    console.log('   2. Use the SHA256 hash in the Winget manifest');
    console.log('   3. Submit a PR to microsoft/winget-pkgs');

  } catch (error) {
    console.error('❌ Error creating package:', error.message);
    process.exit(1);
  }
})();
