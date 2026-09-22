const {
  VALID_PLANTUML_FORMATS,
  DEFAULT_PLANTUML_FORMAT,
  resolvePlantumlFormat,
  normalizePlantumlFormat,
} = require('../lib/plantuml-format');
const { setJsonMode } = require('../lib/output');

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

describe('normalizePlantumlFormat', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    setJsonMode(false);
  });

  test('returns valid values unchanged', () => {
    expect(normalizePlantumlFormat('plantuml')).toBe('plantuml');
    expect(normalizePlantumlFormat('plantumlcloud')).toBe('plantumlcloud');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('trims and lower-cases the value', () => {
    expect(normalizePlantumlFormat('  PlantUmlCloud  ')).toBe('plantumlcloud');
    expect(normalizePlantumlFormat('PLANTUML')).toBe('plantuml');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('returns undefined for empty input without warning', () => {
    expect(normalizePlantumlFormat(undefined)).toBeUndefined();
    expect(normalizePlantumlFormat(null)).toBeUndefined();
    expect(normalizePlantumlFormat('')).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('warns with the source label and returns undefined for an unknown value', () => {
    expect(normalizePlantumlFormat('puml', 'from CONFLUENCE_PLANTUML_FORMAT')).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/Invalid plantumlFormat from CONFLUENCE_PLANTUML_FORMAT "puml"/);
    expect(errorSpy.mock.calls[0][0]).toMatch(/plantuml, plantumlcloud/);
  });

  test('stays silent for an unknown value in JSON mode', () => {
    setJsonMode(true);
    expect(normalizePlantumlFormat('puml')).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
