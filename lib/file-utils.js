const path = require('path');

function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'unnamed';
  }
  const stripped = path.basename(filename.replace(/\\/g, '/'));
  const cleaned = stripped
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return cleaned || 'unnamed';
}

module.exports = { sanitizeFilename };
