const { canonicalCopyPlan, fingerprintCopyPlan } = require('../lib/pi/copy-plan');

const records = [
  { id: '201', parentId: '200', title: 'Grandchild', version: 2 },
  { id: '200', parentId: '123', title: 'Child', version: 4 },
];

test('canonicalizes copy-plan records by ID with normalized field values', () => {
  expect(canonicalCopyPlan(records)).toEqual([
    { id: '200', parentId: '123', title: 'Child', version: 4 },
    { id: '201', parentId: '200', title: 'Grandchild', version: 2 },
  ]);
});

test('fingerprints a copy plan deterministically and includes descendant versions', () => {
  expect(fingerprintCopyPlan(records)).toMatch(/^[a-f0-9]{64}$/);
  expect(fingerprintCopyPlan(records)).toBe(fingerprintCopyPlan([...records].reverse()));
  expect(fingerprintCopyPlan([{ ...records[0], version: 8 }, records[1]]))
    .not.toBe(fingerprintCopyPlan(records));
});
