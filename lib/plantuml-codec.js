const { deflateRawSync, inflateRawSync } = require('zlib');

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
    return decodeURIComponent(inflateRawSync(Buffer.from(trimmed, 'base64')).toString('utf-8'));
  } catch {
    return null;
  }
}

module.exports = {
  encodePlantuml,
  decodePlantuml,
};
