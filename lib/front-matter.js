'use strict';

const yaml = require('js-yaml');

// YAML front matter that maps to Confluence content properties:
//
//   ---
//   properties:
//     content-appearance-published: full-width
//   ---
//
// Only the `properties` map is used; other top-level keys are ignored so the
// same files can carry metadata for other tools. CORE_SCHEMA keeps values to
// plain JSON types (no timestamps or binary), which is what properties store.

const OPENING = /^\uFEFF?---[ \t]*\r?\n/;
const CLOSING = /^(?:---|\.\.\.)[ \t]*$/;

class FrontMatterError extends Error {}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// YAML allows .inf/.nan, which JSON (and so a property value) cannot hold.
function assertJsonNumbers(value, key) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new FrontMatterError(`Front matter property "${key}" contains a non-finite number.`);
  }
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((item) => assertJsonNumbers(item, key));
  }
}

/**
 * Split a Markdown document into its front matter and body.
 * `present` says whether the document has a front matter block; `properties`
 * is null when there is no block or the block has no `properties` key.
 * Throws FrontMatterError when the block is unterminated, is not valid YAML,
 * or does not have the expected shape.
 */
function parseFrontMatter(text) {
  const source = String(text ?? '');
  const opening = source.match(OPENING);
  if (!opening) {
    return { properties: null, body: source, present: false };
  }

  const rest = source.slice(opening[0].length);
  const lines = rest.split(/(?<=\n)/);
  let offset = 0;
  let closingIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (CLOSING.test(lines[i].replace(/\r?\n$/, ''))) {
      closingIndex = i;
      break;
    }
    offset += lines[i].length;
  }
  if (closingIndex === -1) {
    throw new FrontMatterError('Front matter starts with "---" but has no closing "---" line.');
  }

  const block = rest.slice(0, offset);
  const body = rest.slice(offset + lines[closingIndex].length).replace(/^\r?\n/, '');

  let data;
  try {
    data = yaml.load(block, { schema: yaml.CORE_SCHEMA });
  } catch (error) {
    throw new FrontMatterError(`Invalid YAML in front matter: ${error.reason || error.message}`);
  }

  if (data === null || data === undefined) {
    return { properties: null, body, present: true };
  }
  if (!isPlainObject(data)) {
    throw new FrontMatterError('Front matter must be a YAML mapping.');
  }
  if (data.properties === undefined || data.properties === null) {
    return { properties: null, body, present: true };
  }
  if (!isPlainObject(data.properties)) {
    throw new FrontMatterError('Front matter "properties" must be a mapping of property keys to values.');
  }

  for (const [key, value] of Object.entries(data.properties)) {
    if (!key.trim()) {
      throw new FrontMatterError('Front matter property keys cannot be empty.');
    }
    // A bare `key:` is more likely a mistake than a request to store null;
    // nulls nested inside objects or arrays are kept as-is.
    if (value === null) {
      throw new FrontMatterError(
        `Front matter property "${key}" has no value. Remove the key, or use "confluence property-delete" to delete the property.`
      );
    }
    assertJsonNumbers(value, key);
  }

  return { properties: data.properties, body, present: true };
}

/**
 * Render a front matter block for the given properties, preserving key order.
 * Accepts `[key, value]` entries (or a plain object). Entries are dumped one at
 * a time because a plain object would move integer-like keys to the front.
 * Returns an empty string when there is nothing to emit.
 */
function serializeFrontMatter(properties) {
  const entries = Array.isArray(properties) ? properties : Object.entries(properties || {});
  if (entries.length === 0) {
    return '';
  }
  // Dump with the default schema so strings that other YAML readers would
  // resolve as dates (e.g. 2026-10-05) are quoted.
  const block = entries
    .map(([key, value]) => yaml.dump({ [key]: value }, { lineWidth: -1, noRefs: true }).replace(/^(?=.)/gm, '  '))
    .join('');
  return `---\nproperties:\n${block}---\n\n`;
}

/**
 * Prepend front matter for `properties` to a Markdown body. When there are no
 * properties but the body itself starts with `---` (a thematic break), an empty
 * block is emitted so a later `--front-matter` upload cannot mistake the body
 * for front matter.
 */
function prependFrontMatter(properties, body) {
  const block = serializeFrontMatter(properties);
  if (block) {
    return block + body;
  }
  return OPENING.test(body) ? `---\nproperties: {}\n---\n\n${body}` : body;
}

/**
 * Parse a comma-separated `--front-matter` key list, trimming and de-duplicating.
 */
function parsePropertyKeys(value) {
  const keys = [...new Set(String(value ?? '').split(',').map((key) => key.trim()).filter(Boolean))];
  if (keys.length === 0) {
    throw new FrontMatterError('--front-matter requires at least one property key (e.g. --front-matter content-appearance-published).');
  }
  return keys;
}

module.exports = {
  FrontMatterError,
  parseFrontMatter,
  serializeFrontMatter,
  prependFrontMatter,
  parsePropertyKeys,
};
