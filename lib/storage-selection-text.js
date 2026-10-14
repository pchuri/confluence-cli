const { parseDocument } = require('htmlparser2');
const { decodeHTML } = require('entities');

const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ol', 'p', 'pre', 'section',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'ul',
  'ac:layout-cell', 'ac:task-body', 'ac:plain-text-body'
]);
const HIDDEN_ELEMENTS = new Set([
  'script', 'style', 'template', 'ac:parameter', 'ac:default-parameter',
  'ac:task-id', 'ac:task-status', 'ac:image'
]);

/**
 * Extract storage text for selection matching, without display-formatting
 * artifacts such as link URLs, uppercase headings, or list markers.
 * This reads text present in storage; it cannot render dynamic macro output.
 */
function storageSelectionText(storage) {
  // Confluence storage is XML: CDATA is literal text, not HTML to parse or
  // entity-decode. Decode normal text ourselves to also support HTML entities.
  const document = parseDocument(storage, { xmlMode: true, decodeEntities: false });
  const stack = [{ node: document, preserve: false, literal: false }];
  let text = '';
  const boundary = () => {
    if (text && !text.endsWith('\n')) text += '\n';
  };
  const append = (value, preserve) => {
    if (!preserve) {
      value = value.replace(/[\t\n\r\f ]+/g, ' ');
      if (!text || /[\t\n\r\f ]$/.test(text)) value = value.replace(/^ /, '');
    }
    text += value;
  };

  // Iterative traversal also handles deeply nested storage without recursion.
  while (stack.length) {
    const { node, preserve, literal, close } = stack.pop();
    if (close) {
      boundary();
      continue;
    }
    if (node.type === 'text') {
      append(literal ? node.data : decodeHTML(node.data), preserve);
      continue;
    }
    if (node.type === 'comment' || node.type === 'directive') continue;
    const name = node.name;
    if (HIDDEN_ELEMENTS.has(name) || name?.startsWith('ri:')) continue;
    if (name === 'br') {
      // Unlike structural block boundaries, explicit line breaks may repeat
      // (or lead a block) and must preserve selectable blank lines.
      text += '\n';
      continue;
    }
    if (name === 'hr') {
      boundary();
      continue;
    }
    let children = node.children || [];
    if (name === 'ac:link') {
      const body = children.find(child => ['ac:link-body', 'ac:plain-text-link-body'].includes(child.name));
      if (body) {
        children = [body];
      } else {
        const target = children.find(child => ['ri:page', 'ri:attachment'].includes(child.name));
        const label = target?.attribs?.['ri:content-title'] ?? target?.attribs?.['ri:filename'];
        if (label) append(decodeHTML(label), preserve);
        continue;
      }
    }
    const block = BLOCK_ELEMENTS.has(name);
    if (block) {
      boundary();
      stack.push({ close: true });
    }
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push({
        node: children[index],
        preserve: preserve || name === 'pre' || name === 'ac:plain-text-body',
        literal: literal || node.type === 'cdata'
      });
    }
  }
  return text;
}

module.exports = { storageSelectionText };
