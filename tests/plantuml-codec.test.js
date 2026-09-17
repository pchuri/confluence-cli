const { encodePlantuml, decodePlantuml } = require('../lib/plantuml-codec');

// Payload published in the PlantUML Diagrams for Confluence documentation
// ("Programmatically adding PlantUML diagrams").
const DOCUMENTED_PAYLOAD = 'cyguSSwqKc3N4XLMyUxOVdC1U3DKT7JScCwtyUjNK8lMTizJzM9TCEotLE0tLuECyinoAtWAFWNRVVyQn1ecyoVuWF4+UF2RQiJ2QyGKbXR1CaiGGu6QmpcCdDAA';
const DOCUMENTED_SOURCE = [
  '@startuml',
  'Alice -> Bob: Authentication Request',
  'Bob --> Alice: Authentication Response',
  '',
  'Alice -> Bob: Another authentication Request',
  'Alice <-- Bob: Another authentication Response',
  '@enduml',
].join('\n');

describe('plantuml codec', () => {
  describe('encodePlantuml', () => {
    test('produces base64 of raw DEFLATE of the URI-encoded source', () => {
      const encoded = encodePlantuml(DOCUMENTED_SOURCE);
      expect(encoded).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(decodePlantuml(encoded)).toBe(DOCUMENTED_SOURCE);
    });

    test('round-trips a simple diagram', () => {
      const source = '@startuml\nBob->Alice : hello\n@enduml';
      expect(decodePlantuml(encodePlantuml(source))).toBe(source);
    });

    test('round-trips non-ASCII source', () => {
      const source = '@startuml\nJosé -> Zoë: café ☕\n@enduml';
      expect(decodePlantuml(encodePlantuml(source))).toBe(source);
    });

    test('round-trips an empty source', () => {
      expect(decodePlantuml(encodePlantuml(''))).toBe('');
    });
  });

  describe('decodePlantuml', () => {
    test('decodes the payload documented by the vendor', () => {
      expect(decodePlantuml(DOCUMENTED_PAYLOAD)).toBe(DOCUMENTED_SOURCE);
    });

    test('tolerates surrounding whitespace', () => {
      expect(decodePlantuml(`  ${DOCUMENTED_PAYLOAD}\n`)).toBe(DOCUMENTED_SOURCE);
    });

    test('returns null for a value that is not valid base64', () => {
      expect(decodePlantuml('!!!not-base64!!!')).toBeNull();
    });

    test('returns null for base64 that is not valid DEFLATE data', () => {
      expect(decodePlantuml(Buffer.from('hello world').toString('base64'))).toBeNull();
    });

    test('returns null for empty, null and undefined input', () => {
      expect(decodePlantuml('')).toBeNull();
      expect(decodePlantuml('   ')).toBeNull();
      expect(decodePlantuml(null)).toBeNull();
      expect(decodePlantuml(undefined)).toBeNull();
    });
  });
});
