const {
  VALID_PLANTUML_FORMATS,
  DEFAULT_PLANTUML_FORMAT,
  resolvePlantumlFormat,
} = require('../lib/plantuml-format');

describe('resolvePlantumlFormat', () => {
  test('exposes plantuml and plantumlcloud as the valid formats', () => {
    expect(VALID_PLANTUML_FORMATS).toEqual(['plantuml', 'plantumlcloud']);
  });

  test('defaults to "plantuml"', () => {
    expect(DEFAULT_PLANTUML_FORMAT).toBe('plantuml');
  });

  test('keeps "plantuml" when explicitly requested', () => {
    expect(resolvePlantumlFormat({ plantumlFormat: 'plantuml' })).toBe('plantuml');
  });

  test('keeps "plantumlcloud" when explicitly requested', () => {
    expect(resolvePlantumlFormat({ plantumlFormat: 'plantumlcloud' })).toBe('plantumlcloud');
  });

  test('falls back to "plantuml" for an unknown value', () => {
    expect(resolvePlantumlFormat({ plantumlFormat: 'raw' })).toBe('plantuml');
    expect(resolvePlantumlFormat({ plantumlFormat: 'PLANTUMLCLOUD' })).toBe('plantuml');
    expect(resolvePlantumlFormat({ plantumlFormat: '' })).toBe('plantuml');
  });

  test('falls back to "plantuml" when nothing is supplied', () => {
    expect(resolvePlantumlFormat()).toBe('plantuml');
    expect(resolvePlantumlFormat({})).toBe('plantuml');
    expect(resolvePlantumlFormat({ plantumlFormat: null })).toBe('plantuml');
    expect(resolvePlantumlFormat({ plantumlFormat: undefined })).toBe('plantuml');
  });
});
