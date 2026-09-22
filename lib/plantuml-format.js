const chalk = require('chalk');
const { isJsonMode } = require('./output');

const VALID_PLANTUML_FORMATS = ['plantuml', 'plantumlcloud'];

const DEFAULT_PLANTUML_FORMAT = 'plantuml';

function resolvePlantumlFormat({ plantumlFormat = null } = {}) {
  if (VALID_PLANTUML_FORMATS.includes(plantumlFormat)) {
    return plantumlFormat;
  }
  return DEFAULT_PLANTUML_FORMAT;
}

// Normalize a user-supplied value (env var or profile field): trim and
// lower-case it, return undefined for empty input, and warn once (outside JSON
// mode) before returning undefined for anything that is not a valid format.
// Shared by config.js (env + profile) and the CLI (`convert`, which runs
// without a profile) so both paths accept exactly the same spellings.
function normalizePlantumlFormat(rawValue, source) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return undefined;
  }
  const value = String(rawValue).trim().toLowerCase();
  if (VALID_PLANTUML_FORMATS.includes(value)) {
    return value;
  }
  const label = source ? `${source} ` : '';
  if (!isJsonMode()) {
    console.error(chalk.yellow(
      `⚠ Invalid plantumlFormat ${label}"${rawValue}"; valid values: ${VALID_PLANTUML_FORMATS.join(', ')}. Falling back to "${DEFAULT_PLANTUML_FORMAT}".`
    ));
  }
  return undefined;
}

module.exports = {
  VALID_PLANTUML_FORMATS,
  DEFAULT_PLANTUML_FORMAT,
  resolvePlantumlFormat,
  normalizePlantumlFormat,
};
