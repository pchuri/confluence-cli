const VALID_PLANTUML_FORMATS = ['plantuml', 'plantumlcloud'];

const DEFAULT_PLANTUML_FORMAT = 'plantuml';

function resolvePlantumlFormat({ plantumlFormat = null } = {}) {
  if (VALID_PLANTUML_FORMATS.includes(plantumlFormat)) {
    return plantumlFormat;
  }
  return DEFAULT_PLANTUML_FORMAT;
}

module.exports = {
  VALID_PLANTUML_FORMATS,
  DEFAULT_PLANTUML_FORMAT,
  resolvePlantumlFormat,
};
