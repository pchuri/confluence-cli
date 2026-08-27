const crypto = require('crypto');

function canonicalCopyPlan(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('Copy plan records must be an array.');
  }

  const seenIds = new Set();
  const canonical = records.map((record) => {
    if (!record || typeof record !== 'object') {
      throw new TypeError('Copy plan records must be objects.');
    }
    if (record.id === undefined || record.id === null || record.parentId === undefined || record.parentId === null
      || record.title === undefined || record.title === null || record.version === undefined || record.version === null) {
      throw new TypeError('Copy plan records must include id, parentId, title, and version.');
    }

    const entry = {
      id: String(record.id),
      parentId: String(record.parentId),
      title: String(record.title),
      version: Number(record.version),
    };
    if (!Number.isSafeInteger(entry.version) || entry.version < 1) {
      throw new TypeError('Copy plan record versions must be positive integers.');
    }
    if (seenIds.has(entry.id)) {
      throw new TypeError('Copy plan record IDs must be unique.');
    }
    seenIds.add(entry.id);
    return entry;
  });

  return canonical.sort((left, right) => left.id.localeCompare(right.id));
}

function fingerprintCopyPlan(records) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalCopyPlan(records)))
    .digest('hex');
}

module.exports = {
  canonicalCopyPlan,
  fingerprintCopyPlan,
};
