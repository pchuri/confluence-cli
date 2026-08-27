const crypto = require('crypto');

const DEFAULT_TTL_MS = 300_000;

function makeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cloneRecord(record) {
  if (typeof global.structuredClone === 'function') {
    return global.structuredClone(record);
  }
  return JSON.parse(JSON.stringify(record));
}

function createPreflightStore({
  now = () => Date.now(),
  randomId = () => crypto.randomUUID(),
  ttlMs = DEFAULT_TTL_MS,
} = {}) {
  const records = new Map();

  function issue(record) {
    const id = String(randomId());
    const issuedAt = Number(now());
    records.set(id, {
      record: cloneRecord(record),
      expiresAt: issuedAt + Number(ttlMs),
    });
    return id;
  }

  function consume(approvalId) {
    const id = String(approvalId);
    const entry = records.get(id);
    if (!entry) {
      throw makeError('UNKNOWN_APPROVAL', 'Unknown or used approval.');
    }

    const expired = Number(now()) >= entry.expiresAt;
    if (expired) {
      records.delete(id);
      throw makeError('EXPIRED_APPROVAL', 'Approval has expired.');
    }

    records.delete(id);
    return cloneRecord(entry.record);
  }

  function clear() {
    records.clear();
  }

  function size() {
    return records.size;
  }

  return Object.freeze({
    issue,
    consume,
    clear,
    size,
  });
}

module.exports = {
  DEFAULT_TTL_MS,
  createPreflightStore,
};
