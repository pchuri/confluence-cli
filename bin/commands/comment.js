const fs = require('fs');
const chalk = require('chalk');
const inquirer = require('inquirer');

function parseLocationOptions(raw) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.flatMap(item => String(item).split(','))
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);
  }
  return String(raw).split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
}

function formatBodyBlock(text, indent = '') {
  return text.split('\n').map(line => `${indent}${chalk.white(line)}`).join('\n');
}

function buildCommentTree(comments) {
  const nodes = comments.map((comment, index) => ({
    ...comment,
    _order: index,
    children: [],
  }));
  const byId = new Map(nodes.map(node => [String(node.id), node]));
  const roots = [];

  nodes.forEach((node) => {
    const parentId = node.parentId ? String(node.parentId) : null;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId).children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortNodes = (list) => {
    list.sort((a, b) => a._order - b._order);
    list.forEach((child) => sortNodes(child.children));
  };

  sortNodes(roots);
  return roots;
}

function registerCommentCommands(program, { withClient }) {
  program
    .command('comments <pageId>')
    .description('List comments for a page by ID or URL')
    .option('-f, --format <format>', 'Output format (text, markdown). "json" is deprecated — use --json', 'text')
    .option('-l, --limit <limit>', 'Maximum number of comments to fetch (default: 25)')
    .option('--start <start>', 'Start index for results (default: 0)', '0')
    .option('--location <location>', 'Filter by location (inline, footer, resolved). Comma-separated')
    .option('--depth <depth>', 'Comment depth ("" for root only, "all")')
    .option('--all', 'Fetch all comments (ignores pagination)')
    .action(withClient('comments', async ({ client, analytics, wantsJson, emitJson }, pageId, options) => {
      const format = (options.format || 'text').toLowerCase();
      if (!['text', 'markdown', 'json'].includes(format)) {
        throw new Error('Format must be one of: text, markdown, json');
      }
      const jsonMode = wantsJson(options);

      const limit = options.limit ? parseInt(options.limit, 10) : null;
      if (options.limit && (Number.isNaN(limit) || limit <= 0)) {
        throw new Error('Limit must be a positive number.');
      }

      const start = options.start ? parseInt(options.start, 10) : 0;
      if (options.start && (Number.isNaN(start) || start < 0)) {
        throw new Error('Start must be a non-negative number.');
      }

      const locationValues = parseLocationOptions(options.location);
      const invalidLocations = locationValues.filter(value => !['inline', 'footer', 'resolved'].includes(value));
      if (invalidLocations.length > 0) {
        throw new Error(`Invalid location value(s): ${invalidLocations.join(', ')}`);
      }
      const locationParam = locationValues.length === 0
        ? null
        : (locationValues.length === 1 ? locationValues[0] : locationValues);

      let comments = [];
      let nextStart = null;

      if (options.all) {
        comments = await client.getAllComments(pageId, {
          maxResults: limit || null,
          start,
          location: locationParam,
          depth: options.depth,
        });
      } else {
        const response = await client.listComments(pageId, {
          limit: limit || undefined,
          start,
          location: locationParam,
          depth: options.depth,
        });
        comments = response.results;
        nextStart = response.nextStart;
      }

      if (comments.length === 0) {
        if (jsonMode) {
          const resolvedPageId = await client.extractPageId(pageId);
          const output = { pageId: resolvedPageId, commentCount: 0, comments: [] };
          if (!options.all) {
            output.nextStart = nextStart;
          }
          emitJson(output);
        } else {
          console.log(chalk.yellow('No comments found.'));
        }
        analytics.track('comments', true);
        return;
      }

      if (jsonMode) {
        const resolvedPageId = await client.extractPageId(pageId);
        const output = {
          pageId: resolvedPageId,
          commentCount: comments.length,
          comments: comments.map(comment => ({
            ...comment,
            bodyStorage: comment.body,
            bodyText: client.formatCommentBody(comment.body, 'text'),
          })),
        };
        if (!options.all) {
          output.nextStart = nextStart;
        }
        emitJson(output);
        analytics.track('comments', true);
        return;
      }

      const commentTree = buildCommentTree(comments);
      console.log(chalk.blue(`Found ${comments.length} comment${comments.length === 1 ? '' : 's'}:`));

      const renderComments = (nodes, path = []) => {
        nodes.forEach((comment, index) => {
          const currentPath = [...path, index + 1];
          const level = currentPath.length - 1;
          const indent = '  '.repeat(level);
          const branchGlyph = level > 0 ? (index === nodes.length - 1 ? '└─ ' : '├─ ') : '';
          const headerPrefix = `${indent}${chalk.dim(branchGlyph)}`;
          const bodyIndent = level === 0
            ? '   '
            : `${indent}${' '.repeat(branchGlyph.length)}`;

          const isReply = Boolean(comment.parentId);
          const location = comment.location || 'unknown';
          const author = comment.author?.displayName || 'Unknown';
          const createdAt = comment.createdAt || 'unknown date';
          const metaParts = [`Created: ${createdAt}`];
          if (comment.status) metaParts.push(`Status: ${comment.status}`);
          if (comment.version) metaParts.push(`Version: ${comment.version}`);
          if (!isReply && comment.resolution) metaParts.push(`Resolution: ${comment.resolution}`);

          const label = isReply ? chalk.gray('[reply]') : chalk.cyan(`[${location}]`);
          console.log(`${headerPrefix}${currentPath.join('.')}. ${chalk.green(author)} ${chalk.gray(`(ID: ${comment.id})`)} ${label}`);
          console.log(chalk.dim(`${bodyIndent}${metaParts.join(' • ')}`));

          if (!isReply) {
            const inlineProps = comment.inlineProperties || {};
            const selectionText = inlineProps.selection || inlineProps.originalSelection;
            if (selectionText) {
              const selectionLabel = inlineProps.selection ? 'Highlight' : 'Highlight (original)';
              console.log(chalk.dim(`${bodyIndent}${selectionLabel}: ${selectionText}`));
            }
            if (inlineProps.markerRef) {
              console.log(chalk.dim(`${bodyIndent}Marker ref: ${inlineProps.markerRef}`));
            }
          }

          const body = client.formatCommentBody(comment.body, format);
          if (body) {
            console.log(`${bodyIndent}${chalk.yellowBright('Body:')}`);
            console.log(formatBodyBlock(body, `${bodyIndent}  `));
          }

          if (comment.children && comment.children.length > 0) {
            renderComments(comment.children, currentPath);
          }
        });
      };

      renderComments(commentTree);

      if (!options.all && nextStart !== null && nextStart !== undefined) {
        console.log(chalk.gray(`Next start: ${nextStart}`));
      }

      analytics.track('comments', true);
    }));

  program
    .command('comment <pageId>')
    .description('Create a comment on a page by ID or URL (footer or inline)')
    .option('-f, --file <file>', 'Read content from file')
    .option('-c, --content <content>', 'Comment content as string')
    .option('--format <format>', 'Content format (auto, storage, html, markdown)', 'storage')
    .option('--parent <commentId>', 'Reply to a comment by ID')
    .option('--location <location>', 'Comment location (inline or footer)', 'footer')
    .option('--inline-selection <text>', 'Inline selection text')
    .option('--inline-original-selection <text>', 'Original inline selection text')
    .option('--inline-marker-ref <ref>', 'Inline marker reference (optional)')
    .option('--inline-properties <json>', 'Inline properties JSON (advanced)')
    .action(withClient('comment_create', async ({ client, analytics, wantsJson, emitJson }, pageId, options) => {
      let content = '';

      if (options.file) {
        if (!fs.existsSync(options.file)) {
          throw new Error(`File not found: ${options.file}`);
        }
        content = fs.readFileSync(options.file, 'utf8');
      } else if (options.content) {
        content = options.content;
      } else {
        throw new Error('Either --file or --content option is required');
      }

      const location = (options.location || 'footer').toLowerCase();
      if (!['inline', 'footer'].includes(location)) {
        throw new Error('Location must be either "inline" or "footer".');
      }

      let inlineProperties = {};
      if (options.inlineProperties) {
        try {
          const parsed = JSON.parse(options.inlineProperties);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Inline properties must be a JSON object.');
          }
          inlineProperties = { ...parsed };
        } catch (error) {
          throw new Error(`Invalid --inline-properties JSON: ${error.message}`);
        }
      }

      if (options.inlineSelection) {
        inlineProperties.selection = options.inlineSelection;
      }
      if (options.inlineOriginalSelection) {
        inlineProperties.originalSelection = options.inlineOriginalSelection;
      }
      if (options.inlineMarkerRef) {
        inlineProperties.markerRef = options.inlineMarkerRef;
      }

      if (Object.keys(inlineProperties).length > 0 && location !== 'inline') {
        throw new Error('Inline properties can only be used with --location inline.');
      }

      const parentId = options.parent;

      if (location === 'inline') {
        const hasSelection = inlineProperties.selection || inlineProperties.originalSelection;
        if (!hasSelection && !parentId) {
          throw new Error('Inline comments require --inline-selection or --inline-original-selection when starting a new inline thread.');
        }
        if (hasSelection) {
          if (!inlineProperties.originalSelection && inlineProperties.selection) {
            inlineProperties.originalSelection = inlineProperties.selection;
          }
          if (!inlineProperties.markerRef) {
            inlineProperties.markerRef = `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          }
        }
      }

      const result = await client.createComment(pageId, content, options.format, {
        parentId,
        location,
        inlineProperties: location === 'inline' ? inlineProperties : null,
      });

      if (wantsJson()) {
        emitJson({
          id: result.id,
          pageId: result.container?.id ?? null,
          url: result._links?.webui ? client.toAbsoluteUrl(result._links.webui) : null,
        });
        analytics.track('comment_create', true);
        return;
      }

      console.log(chalk.green('✅ Comment created successfully!'));
      console.log(`ID: ${chalk.blue(result.id)}`);
      if (result.container?.id) {
        console.log(`Page ID: ${chalk.blue(result.container.id)}`);
      }
      if (result._links?.webui) {
        const url = client.toAbsoluteUrl(result._links.webui);
        console.log(`URL: ${chalk.gray(url)}`);
      }

      analytics.track('comment_create', true);
    }, {
      writable: true,
      onError: (error, _pageId, options) => {
        if (error.response?.data) {
          const detail = typeof error.response.data === 'string'
            ? error.response.data
            : JSON.stringify(error.response.data, null, 2);
          console.error(chalk.red('API response:'), detail);
        }
        const apiErrors = error.response?.data?.data?.errors || error.response?.data?.errors || [];
        const errorKeys = apiErrors
          .map((entry) => entry?.message?.key || entry?.message || entry?.key)
          .filter(Boolean);
        const needsInlineMeta = ['matchIndex', 'lastFetchTime', 'serializedHighlights']
          .every((key) => errorKeys.includes(key));
        const location = (options?.location || 'footer').toLowerCase();
        if (location === 'inline' && needsInlineMeta) {
          console.error(chalk.yellow('Inline comment creation requires editor highlight metadata (matchIndex, lastFetchTime, serializedHighlights).'));
          console.error(chalk.yellow('Try replying to an existing inline comment or use footer comments instead.'));
        }
      },
    }));

  program
    .command('comment-delete <commentId>')
    .description('Delete a comment by ID')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(withClient('comment_delete', async ({ client, analytics, wantsJson, emitJson }, commentId, options) => {
      const jsonMode = wantsJson();
      if (!options.yes) {
        if (jsonMode) {
          throw new Error('Refusing to delete without confirmation in --json mode. Pass --yes to proceed.');
        }
        const { confirmed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmed',
            default: false,
            message: `Delete comment ${commentId}?`,
          },
        ]);

        if (!confirmed) {
          console.log(chalk.yellow('Cancelled.'));
          analytics.track('comment_delete_cancel', true);
          return;
        }
      }

      const result = await client.deleteComment(commentId);

      if (jsonMode) {
        emitJson({ id: result.id, deleted: true });
        analytics.track('comment_delete', true);
        return;
      }

      console.log(chalk.green('✅ Comment deleted successfully!'));
      console.log(`ID: ${chalk.blue(result.id)}`);
      analytics.track('comment_delete', true);
    }, { writable: true }));
}

module.exports = registerCommentCommands;
