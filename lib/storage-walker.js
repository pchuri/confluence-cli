const { parseDocument } = require('htmlparser2');

const DEFAULT_MAX_DEPTH = 256;

class StorageDepthExceededError extends Error {
  constructor(maxDepth) {
    super(`Storage XML nesting exceeds limit of ${maxDepth} levels`);
    this.name = 'StorageDepthExceededError';
    this.maxDepth = maxDepth;
  }
}

class StorageWalker {
  constructor({
    attachmentsDir = 'attachments',
    labels = {},
    buildUrl = (u) => u,
    webUrlPrefix = '',
    maxDepth = DEFAULT_MAX_DEPTH,
  } = {}) {
    this.attachmentsDir = attachmentsDir;
    this.labels = labels;
    this.buildUrl = buildUrl;
    this.webUrlPrefix = webUrlPrefix;
    this.maxDepth = maxDepth;
  }

  walk(storage) {
    this._depth = 0;
    const dom = parseDocument(storage, {
      xmlMode: true,
      recognizeSelfClosing: true,
      decodeEntities: true,
    });
    return this.cleanup(this.walkNodes(dom.children));
  }

  walkNodes(nodes) {
    if (!nodes) return '';
    return nodes.map((n) => this.walkNode(n)).join('');
  }

  walkNode(node) {
    if (!node) return '';
    switch (node.type) {
    case 'text':
      return node.data || '';
    case 'cdata':
      return this.walkNodes(node.children);
    case 'comment':
    case 'directive':
      return '';
    case 'tag':
    case 'script':
    case 'style':
      return this.walkElement(node);
    default:
      return '';
    }
  }

  walkElement(node) {
    if (++this._depth > this.maxDepth) {
      this._depth--;
      throw new StorageDepthExceededError(this.maxDepth);
    }
    try {
      return this._dispatchElement(node);
    } finally {
      this._depth--;
    }
  }

  _dispatchElement(node) {
    const tag = node.name;
    switch (tag) {
    case 'p':
      return '\n' + this.walkNodes(node.children).trim() + '\n';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const level = parseInt(tag.charAt(1), 10);
      return '\n' + '#'.repeat(level) + ' ' + this.walkNodes(node.children).trim() + '\n';
    }
    case 'strong': case 'b':
      return '**' + this.walkNodes(node.children) + '**';
    case 'em': case 'i':
      return '*' + this.walkNodes(node.children) + '*';
    case 'code':
      return '`' + this.walkNodes(node.children) + '`';
    case 'br':
      return '\n';
    case 'hr':
      return '\n---\n';
    case 'a': {
      const href = node.attribs && node.attribs.href;
      const inner = this.walkNodes(node.children);
      if (!href) return inner;
      return `[${inner}](${href})`;
    }
    case 'time':
      return (node.attribs && node.attribs.datetime) || this.walkNodes(node.children);
    case 'ul':
      return this.handleList(node, false);
    case 'ol':
      return this.handleList(node, true);
    case 'li':
      return this.walkNodes(node.children);
    case 'table':
      return this.handleTable(node);
    case 'thead': case 'tbody': case 'tfoot': case 'tr': case 'th': case 'td':
      return this.walkNodes(node.children);
    case 'blockquote':
      return this.handleBlockquote(node);
    case 'details': case 'summary':
      return `<${tag}>` + this.walkNodes(node.children) + `</${tag}>`;
    case 'ac:structured-macro':
      return this.handleMacro(node);
    case 'ac:image':
      return this.handleImage(node);
    case 'ac:link':
      return this.handleAcLink(node);
    case 'ac:task-list':
      return this.handleTaskList(node);
    case 'ac:layout': case 'ac:layout-section': case 'ac:layout-cell':
    case 'ac:rich-text-body': case 'ac:link-body':
      return this.walkNodes(node.children);
    case 'ri:url': case 'ri:page': case 'ri:attachment':
    case 'ac:plain-text-body': case 'ac:plain-text-link-body':
    case 'ac:parameter':
      return '';
    default:
      return this.walkNodes(node.children);
    }
  }

  handleList(node, ordered) {
    const items = (node.children || []).filter((c) => c.type === 'tag' && c.name === 'li');
    let counter = 1;
    let out = '';
    for (const item of items) {
      const text = this.walkNodes(item.children).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const marker = ordered ? `${counter++}.` : '-';
      out += `${marker} ${text}\n`;
    }
    return out ? '\n' + out : '';
  }

  handleTable(node) {
    const rows = [];
    const trs = this.findAllDescendants(node, 'tr');
    let isHeader = true;
    for (const tr of trs) {
      const cells = (tr.children || []).filter((c) => c.type === 'tag' && (c.name === 'th' || c.name === 'td'));
      if (cells.length === 0) continue;
      const cellTexts = cells.map((cell) =>
        this.walkNodes(cell.children).replace(/\s+/g, ' ').trim() || ' '
      );
      rows.push('| ' + cellTexts.join(' | ') + ' |');
      if (isHeader) {
        rows.push('| ' + cellTexts.map(() => '---').join(' | ') + ' |');
        isHeader = false;
      }
    }
    return rows.length > 0 ? '\n' + rows.join('\n') + '\n' : '';
  }

  handleBlockquote(node) {
    const inner = this.walkNodes(node.children).trim();
    if (!inner) return '';
    const quoted = inner
      .split('\n')
      .map((line) => (line.length === 0 ? '>' : `> ${line}`))
      .join('\n');
    return '\n' + quoted + '\n';
  }

  handleMacro(node) {
    const name = node.attribs && node.attribs['ac:name'];
    switch (name) {
    case 'toc':
    case 'floatmenu':
      return '';
    case 'expand':
      return this.handleExpand(node);
    case 'code':
      return this.handleCode(node);
    case 'info': case 'warning': case 'note':
      return this.handleCallout(node, name);
    case 'anchor':
      return this.handleAnchor(node);
    case 'panel':
      return this.handlePanel(node);
    case 'mermaid-macro':
      return this.handleMermaid(node);
    case 'include':
      return this.handleInclude(node);
    case 'shared-block':
    case 'include-shared-block':
      return this.handleSharedBlock(node, name);
    case 'view-file':
      return this.handleViewFile(node);
    default:
      return '';
    }
  }

  handleExpand(node) {
    const titleParam = this.findParamByName(node, 'title');
    const body = this.getMacroBody(node);
    if (titleParam) {
      const title = this.getTextContent(titleParam);
      return `\n**EXPAND: ${title}**\n\n${this.walkNodes(body).trim()}\n\n**EXPAND_END**\n`;
    }
    return `\n<details>\n<summary>${this.labels.expandDetails || 'Expand Details'}</summary>\n\n${this.walkNodes(body).trim()}\n\n</details>\n`;
  }

  handleCode(node) {
    const langParam = this.findParamByName(node, 'language');
    const lang = langParam ? this.getTextContent(langParam) : '';
    const plainBody = this.findChildByName(node, 'ac:plain-text-body');
    const code = plainBody ? this.getRawText(plainBody) : '';
    return `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
  }

  handleCallout(node, marker) {
    const body = this.getMacroBody(node);
    const inner = this.walkNodes(body).trim();
    const quoted = inner
      .split('\n')
      .map((line) => (line.length === 0 ? '>' : `> ${line}`))
      .join('\n');
    const header = `> **${marker.toUpperCase()}**`;
    const wrapped = inner.length === 0 ? header : `${header}\n${quoted}`;
    return `\n${wrapped}\n`;
  }

  handleAnchor(node) {
    const param = this.findParamByName(node, '');
    const id = param ? this.getTextContent(param) : '';
    return `\n**ANCHOR: ${id}**\n`;
  }

  handlePanel(node) {
    const titleParam = this.findParamByName(node, 'title');
    const title = titleParam ? this.getTextContent(titleParam) : '';
    const body = this.getMacroBody(node);
    const cleanContent = this.walkNodes(body);
    const quoted = cleanContent.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
    return `\n> **${title}**\n>\n${quoted}\n`;
  }

  handleMermaid(node) {
    const plainBody = this.findChildByName(node, 'ac:plain-text-body');
    const code = plainBody ? this.getRawText(plainBody).trim() : '';
    return `\n\`\`\`mermaid\n${code}\n\`\`\`\n`;
  }

  handleInclude(node) {
    const param = this.findParamByName(node, '');
    if (!param) return '';
    const acLink = this.findChildByName(param, 'ac:link');
    if (!acLink) return '';
    const riPage = this.findChildByName(acLink, 'ri:page');
    if (!riPage) return '';
    const spaceKey = riPage.attribs['ri:space-key'] || '';
    const title = riPage.attribs['ri:content-title'] || '';
    const label = this.labels.includePage || 'Include Page';
    if (spaceKey.startsWith('~')) {
      const spacePath = `display/${spaceKey}/${encodeURIComponent(title)}`;
      return `\n> 📄 **${label}**: [${title}](${this.buildUrl(`${this.webUrlPrefix}/${spacePath}`)})\n`;
    }
    return `\n> 📄 **${label}**: [${title}](${this.buildUrl(`${this.webUrlPrefix}/spaces/${spaceKey}/pages/[PAGE_ID_HERE]`)}) _(manual link correction required)_\n`;
  }

  handleSharedBlock(node, type) {
    const blockKeyParam = this.findParamByName(node, 'shared-block-key');
    const blockKey = blockKeyParam ? this.getTextContent(blockKeyParam) : '';
    const pageParam = this.findParamByName(node, 'page');
    if (pageParam && type === 'include-shared-block') {
      const acLink = this.findChildByName(pageParam, 'ac:link');
      if (acLink) {
        const riPage = this.findChildByName(acLink, 'ri:page');
        if (riPage) {
          const pageTitle = riPage.attribs['ri:content-title'] || '';
          const includeLabel = this.labels.includeSharedBlock || 'Include Shared Block';
          const fromPageLabel = this.labels.fromPage || 'from page';
          return `\n> 📄 **${includeLabel}**: ${blockKey} (${fromPageLabel}: ${pageTitle} [link needs manual correction])\n`;
        }
      }
    }
    const body = this.getMacroBody(node);
    const cleanContent = this.walkNodes(body);
    const sharedLabel = this.labels.sharedBlock || 'Shared Block';
    const quoted = cleanContent.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
    return `\n> **${sharedLabel}: ${blockKey}**\n>\n${quoted}\n`;
  }

  handleViewFile(node) {
    const nameParam = this.findParamByName(node, 'name');
    if (!nameParam) return '';
    const riAttachment = this.findChildByName(nameParam, 'ri:attachment');
    if (!riAttachment) return '';
    const filename = riAttachment.attribs['ri:filename'] || '';
    return `\n📎 [${filename}](${this.attachmentsDir}/${filename})\n`;
  }

  handleImage(node) {
    const riAttachment = this.findChildByName(node, 'ri:attachment');
    if (!riAttachment) return '';
    const filename = riAttachment.attribs['ri:filename'] || '';
    return `![${filename}](${this.attachmentsDir}/${filename})`;
  }

  handleAcLink(node) {
    const attribs = node.attribs || {};
    if (attribs['ac:anchor']) {
      const linkBody = this.findChildByName(node, 'ac:plain-text-link-body');
      const text = linkBody ? this.getRawText(linkBody) : '';
      return `[${text}](#${attribs['ac:anchor']})`;
    }
    const riUrl = this.findChildByName(node, 'ri:url');
    if (riUrl) {
      const url = riUrl.attribs['ri:value'] || '';
      const linkBody = this.findChildByName(node, 'ac:plain-text-link-body');
      const text = linkBody ? this.getRawText(linkBody) : '';
      return `[${text}](${url})`;
    }
    const linkBody = this.findChildByName(node, 'ac:link-body');
    if (linkBody) {
      return this.walkNodes(linkBody.children).trim();
    }
    const riPage = this.findChildByName(node, 'ri:page');
    if (riPage) {
      const title = riPage.attribs['ri:content-title'] || '';
      return `[${title}]`;
    }
    return '';
  }

  handleTaskList(node) {
    const tasks = (node.children || []).filter((c) => c.type === 'tag' && c.name === 'ac:task');
    const lines = [];
    for (const task of tasks) {
      const status = this.findChildByName(task, 'ac:task-status');
      const body = this.findChildByName(task, 'ac:task-body');
      const statusText = status ? this.getTextContent(status) : '';
      const bodyText = body
        ? this.walkNodes(body.children).replace(/\s+/g, ' ').trim()
        : '';
      const checkbox = statusText === 'complete' ? '[x]' : '[ ]';
      if (bodyText) lines.push(`- ${checkbox} ${bodyText}`);
    }
    return lines.length > 0 ? '\n' + lines.join('\n') + '\n' : '';
  }

  findParamByName(node, name) {
    if (!node || !node.children) return null;
    for (const child of node.children) {
      if (child.type === 'tag' && child.name === 'ac:parameter' && child.attribs['ac:name'] === name) {
        return child;
      }
    }
    return null;
  }

  findChildByName(node, name) {
    if (!node || !node.children) return null;
    for (const child of node.children) {
      if (child.type === 'tag' && child.name === name) return child;
    }
    return null;
  }

  findAllDescendants(node, name) {
    const result = [];
    const visit = (n) => {
      if (!n) return;
      if (n.type === 'tag' && n.name === name) result.push(n);
      if (n.children) n.children.forEach(visit);
    };
    if (node.children) node.children.forEach(visit);
    return result;
  }

  getMacroBody(node) {
    const body = this.findChildByName(node, 'ac:rich-text-body');
    return body ? body.children : [];
  }

  getTextContent(node) {
    if (!node) return '';
    if (node.type === 'text') return node.data || '';
    if (node.children) return node.children.map((c) => this.getTextContent(c)).join('');
    return '';
  }

  getRawText(node) {
    if (!node || !node.children) return '';
    let out = '';
    for (const child of node.children) {
      if (child.type === 'text') out += child.data || '';
      else if (child.type === 'cdata') out += this.getRawText(child);
    }
    return out;
  }

  cleanup(text) {
    let out = text;
    out = out.replace(/[ \t]+$/gm, '');
    out = out.replace(/^[ \t]+(?!([`>]|[*+-] |\d+[.)] ))/gm, '');
    out = out.replace(/^(#{1,6}[^\n]+)\n(?!\n)/gm, '$1\n\n');
    out = out.replace(/\n\s*\n\s*\n+/g, '\n\n');
    out = out.replace(/[ \t]+/g, ' ');
    return out.trim();
  }
}

module.exports = { StorageWalker, StorageDepthExceededError, DEFAULT_MAX_DEPTH };
