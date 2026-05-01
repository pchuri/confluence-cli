const fs = require('fs');
const path = require('path');
const MacroConverter = require('../lib/macro-converter');

// Parity corpus: pins the current storageToMarkdown output to a set of
// representative storage XML samples so future structural refactors of the
// walker have to face every path in CI on PR open. Background: the regex →
// walker migration in #137 took three review rounds because each round
// surfaced one more entity-decoding path the walker had silently dropped.
//
// To regenerate expected files after an intentional output change:
//   WRITE_PARITY_EXPECTED=1 npx jest tests/storage-walker-parity.test.js
// then review the diff in the .expected.md files as part of the PR.
describe('storage walker parity corpus', () => {
  const fixturesDir = path.join(__dirname, 'fixtures', 'storage-samples');
  const writeMode = process.env.WRITE_PARITY_EXPECTED === '1';
  const converter = new MacroConverter({ isCloud: true });

  // walker output ends with a `.trim()` from cleanupWithFences, so the raw
  // string has no trailing newline. Adding one when we serialize keeps the
  // .expected.md POSIX-compliant (most editors auto-add a final newline on
  // save); comparing the same `actual + '\n'` on read so a re-saved fixture
  // does not falsely fail.
  const withFinalNewline = (s) => (s.endsWith('\n') ? s : s + '\n');

  if (writeMode) {
    // Loud heads-up so a stray `WRITE_PARITY_EXPECTED=1` in a shell rc cannot
    // silently rewrite the corpus during a CI run.
    console.warn(
      '[parity] WRITE_PARITY_EXPECTED=1 is set — regenerating .expected.md files instead of asserting.',
    );
  }

  const xmlFiles = fs
    .readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.xml'))
    .sort();

  if (xmlFiles.length === 0) {
    test('fixtures directory is non-empty', () => {
      throw new Error(`No .xml fixtures found in ${fixturesDir}`);
    });
    return;
  }

  for (const xmlFile of xmlFiles) {
    test(`${xmlFile} matches its pinned markdown`, () => {
      const xmlPath = path.join(fixturesDir, xmlFile);
      const expectedPath = path.join(
        fixturesDir,
        xmlFile.replace(/\.xml$/, '.expected.md'),
      );
      const xml = fs.readFileSync(xmlPath, 'utf8');
      const actualWithNl = withFinalNewline(converter.storageToMarkdown(xml));

      if (writeMode) {
        fs.writeFileSync(expectedPath, actualWithNl);
        return;
      }

      if (!fs.existsSync(expectedPath)) {
        throw new Error(
          `Missing expected output: ${expectedPath}\n` +
            'Run WRITE_PARITY_EXPECTED=1 npx jest tests/storage-walker-parity.test.js to generate it.',
        );
      }
      const expected = fs.readFileSync(expectedPath, 'utf8');
      expect(actualWithNl).toBe(expected);
    });
  }
});
