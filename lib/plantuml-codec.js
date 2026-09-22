const { deflateRawSync, inflateRawSync } = require('zlib');

// Upper bound for the inflated `data` parameter. A ~90 KB base64 payload can
// inflate to tens of MiB in milliseconds; no real diagram source comes close
// to this, so anything larger is treated like a corrupt payload (null).
const MAX_INFLATED_BYTES = 16 * 1024 * 1024;

function encodePlantuml(source) {
  return deflateRawSync(
    Buffer.from(encodeURIComponent(String(source == null ? '' : source)), 'utf-8')
  ).toString('base64');
}

function decodePlantuml(data) {
  if (data == null) return null;
  const trimmed = String(data).trim();
  if (!trimmed) return null;
  try {
    return decodeURIComponent(inflateRawSync(Buffer.from(trimmed, 'base64'), { maxOutputLength: MAX_INFLATED_BYTES }).toString('utf-8'));
  } catch {
    return null;
  }
}

module.exports = {
  encodePlantuml,
  decodePlantuml,
  MAX_INFLATED_BYTES,
};
