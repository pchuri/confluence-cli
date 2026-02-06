#!/usr/bin/env node

const { program } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const ConfluenceClient = require('../lib/confluence-client');
const { getConfig, initConfig } = require('../lib/config');
const Analytics = require('../lib/analytics');
const pkg = require('../package.json');

program
  .name('confluence')
  .description('CLI tool for Atlassian Confluence')
  .version(pkg.version);

// Init command
program
  .command('init')
  .description('Initialize Confluence CLI configuration')
  .option('-d, --domain <domain>', 'Confluence domain')
  .option('-p, --api-path <path>', 'REST API path')
  .option('-a, --auth-type <type>', 'Authentication type (basic or bearer)')
  .option('-e, --email <email>', 'Email for basic auth')
  .option('-t, --token <token>', 'API token')
  .action(async (options) => {
    await initConfig(options);
  });

// Read command
program
  .command('read <pageId>')
  .description('Read a Confluence page by ID or URL')
  .option('-f, --format <format>', 'Output format (html, text, markdown)', 'text')
  .action(async (pageId, options) => {
    const analytics = new Analytics();
    try {
      const client = new ConfluenceClient(getConfig());
      const content = await client.readPage(pageId, options.format);
      console.log(content);
      analytics.track('read', true);
    } catch (error) {
      analytics.track('read', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Info command
program
  .command('info <pageId>')
  .description('Get information about a Confluence page')
  .action(async (pageId) => {
    const analytics = new Analytics();
    try {
      const client = new ConfluenceClient(getConfig());
      const info = await client.getPageInfo(pageId);
      console.log(chalk.blue('Page Information:'));
      console.log(`Title: ${chalk.green(info.title)}`);
      console.log(`ID: ${chalk.green(info.id)}`);
      console.log(`Type: ${chalk.green(info.type)}`);
      console.log(`Status: ${chalk.green(info.status)}`);
      if (info.space) {
        console.log(`Space: ${chalk.green(info.space.name)} (${info.space.key})`);
      }
      analytics.track('info', true);
    } catch (error) {
      analytics.track('info', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Search command
program
  .command('search <query>')
  .description('Search for Confluence pages')
  .option('-l, --limit <limit>', 'Limit number of results', '10')
  .action(async (query, options) => {
    const analytics = new Analytics();
    try {
      const client = new ConfluenceClient(getConfig());
      const results = await client.search(query, parseInt(options.limit));
      
      if (results.length === 0) {
        console.log(chalk.yellow('No results found.'));
        analytics.track('search', true);
        return;
      }

      console.log(chalk.blue(`Found ${results.length} results:`));
      results.forEach((result, index) => {
        console.log(`${index + 1}. ${chalk.green(result.title)} (ID: ${result.id})`);
        if (result.excerpt) {
          console.log(`   ${chalk.gray(result.excerpt)}`);
        }
      });
      analytics.track('search', true);
    } catch (error) {
      analytics.track('search', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// List spaces command
program
  .command('spaces')
  .description('List all Confluence spaces')
  .action(async () => {
    const analytics = new Analytics();
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);
      const spaces = await client.getSpaces();
      
      console.log(chalk.blue('Available spaces:'));
      spaces.forEach(space => {
        console.log(`${chalk.green(space.key)} - ${space.name}`);
      });
      analytics.track('spaces', true);
    } catch (error) {
      analytics.track('spaces', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Stats command
program
  .command('stats')
  .description('Show usage statistics')
  .action(async () => {
    try {
      const analytics = new Analytics();
      analytics.showStats();
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Create command
program
  .command('create <title> <spaceKey>')
  .description('Create a new Confluence page')
  .option('-f, --file <file>', 'Read content from file')
  .option('-c, --content <content>', 'Page content as string')
  .option('--format <format>', 'Content format (storage, html, markdown)', 'storage')
  .action(async (title, spaceKey, options) => {
    const analytics = new Analytics();
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);
      
      let content = '';
      
      if (options.file) {
        const fs = require('fs');
        if (!fs.existsSync(options.file)) {
          throw new Error(`File not found: ${options.file}`);
        }
        content = fs.readFileSync(options.file, 'utf8');
      } else if (options.content) {
        content = options.content;
      } else {
        throw new Error('Either --file or --content option is required');
      }
      
      const result = await client.createPage(title, spaceKey, content, options.format);
      
      console.log(chalk.green('✅ Page created successfully!'));
      console.log(`Title: ${chalk.blue(result.title)}`);
      console.log(`ID: ${chalk.blue(result.id)}`);
      console.log(`Space: ${chalk.blue(result.space.name)} (${result.space.key})`);
      console.log(`URL: ${chalk.gray(`https://${config.domain}/wiki${result._links.webui}`)}`);
      
      analytics.track('create', true);
    } catch (error) {
      analytics.track('create', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Create child page command
program
  .command('create-child <title> <parentId>')
  .description('Create a new Confluence page as a child of another page')
  .option('-f, --file <file>', 'Read content from file')
  .option('-c, --content <content>', 'Page content as string')
  .option('--format <format>', 'Content format (storage, html, markdown)', 'storage')
  .action(async (title, parentId, options) => {
    const analytics = new Analytics();
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);
      
      // Get parent page info to get space key
      const parentInfo = await client.getPageInfo(parentId);
      const spaceKey = parentInfo.space.key;
      
      let content = '';
      
      if (options.file) {
        const fs = require('fs');
        if (!fs.existsSync(options.file)) {
          throw new Error(`File not found: ${options.file}`);
        }
        content = fs.readFileSync(options.file, 'utf8');
      } else if (options.content) {
        content = options.content;
      } else {
        throw new Error('Either --file or --content option is required');
      }
      
      const result = await client.createChildPage(title, spaceKey, parentId, content, options.format);
      
      console.log(chalk.green('✅ Child page created successfully!'));
      console.log(`Title: ${chalk.blue(result.title)}`);
      console.log(`ID: ${chalk.blue(result.id)}`);
      console.log(`Parent: ${chalk.blue(parentInfo.title)} (${parentId})`);
      console.log(`Space: ${chalk.blue(result.space.name)} (${result.space.key})`);
      console.log(`URL: ${chalk.gray(`https://${config.domain}/wiki${result._links.webui}`)}`);
      
      analytics.track('create_child', true);
    } catch (error) {
      analytics.track('create_child', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Update command
program
  .command('update <pageId>')
  .description('Update an existing Confluence page')
  .option('-t, --title <title>', 'New page title (optional)')
  .option('-f, --file <file>', 'Read content from file')
  .option('-c, --content <content>', 'Page content as string')
  .option('--format <format>', 'Content format (storage, html, markdown)', 'storage')
  .action(async (pageId, options) => {
    const analytics = new Analytics();
    try {
      // Check if at least one option is provided
      if (!options.title && !options.file && !options.content) {
        throw new Error('At least one of --title, --file, or --content must be provided.');
      }

      const config = getConfig();
      const client = new ConfluenceClient(config);
      
      let content = null; // Use null to indicate no content change
      
      if (options.file) {
        const fs = require('fs');
        if (!fs.existsSync(options.file)) {
          throw new Error(`File not found: ${options.file}`);
        }
        content = fs.readFileSync(options.file, 'utf8');
      } else if (options.content) {
        content = options.content;
      }
      
      const result = await client.updatePage(pageId, options.title, content, options.format);
      
      console.log(chalk.green('✅ Page updated successfully!'));
      console.log(`Title: ${chalk.blue(result.title)}`);
      console.log(`ID: ${chalk.blue(result.id)}`);
      console.log(`Version: ${chalk.blue(result.version.number)}`);
      console.log(`URL: ${chalk.gray(`https://${config.domain}/wiki${result._links.webui}`)}`);
      
      analytics.track('update', true);
    } catch (error) {
      analytics.track('update', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Delete command
program
  .command('delete <pageIdOrUrl>')
  .description('Delete a Confluence page by ID or URL')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (pageIdOrUrl, options) => {
    const analytics = new Analytics();
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);
      const pageInfo = await client.getPageInfo(pageIdOrUrl);

      if (!options.yes) {
        const spaceLabel = pageInfo.space?.key ? ` (${pageInfo.space.key})` : '';
        const { confirmed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmed',
            default: false,
            message: `Delete "${pageInfo.title}" (ID: ${pageInfo.id})${spaceLabel}?`
          }
        ]);

        if (!confirmed) {
          console.log(chalk.yellow('Cancelled.'));
          analytics.track('delete_cancel', true);
          return;
        }
      }

      const result = await client.deletePage(pageInfo.id);

      console.log(chalk.green('✅ Page deleted successfully!'));
      console.log(`Title: ${chalk.blue(pageInfo.title)}`);
      console.log(`ID: ${chalk.blue(result.id)}`);
      analytics.track('delete', true);
    } catch (error) {
      analytics.track('delete', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Edit command - opens page content for editing
program
  .command('edit <pageId>')
  .description('Get page content for editing')
  .option('-o, --output <file>', 'Save content to file')
  .action(async (pageId, options) => {
    const analytics = new Analytics();
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);
      const pageData = await client.getPageForEdit(pageId);
      
      console.log(chalk.blue('Page Information:'));
      console.log(`Title: ${chalk.green(pageData.title)}`);
      console.log(`ID: ${chalk.green(pageData.id)}`);
      console.log(`Version: ${chalk.green(pageData.version)}`);
      console.log(`Space: ${chalk.green(pageData.space.name)} (${pageData.space.key})`);
      console.log('');
      
      if (options.output) {
        const fs = require('fs');
        fs.writeFileSync(options.output, pageData.content);
        console.log(chalk.green(`✅ Content saved to: ${options.output}`));
        console.log(chalk.yellow('💡 Edit the file and use "confluence update" to save changes'));
      } else {
        console.log(chalk.blue('Page Content:'));
        console.log(pageData.content);
      }
      
      analytics.track('edit', true);
    } catch (error) {
      analytics.track('edit', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Find page by title command
program
  .command('find <title>')
  .description('Find a page by title')
  .option('-s, --space <spaceKey>', 'Limit search to specific space')
  .action(async (title, options) => {
    const analytics = new Analytics();
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);
      const pageInfo = await client.findPageByTitle(title, options.space);
      
      console.log(chalk.blue('Page found:'));
      console.log(`Title: ${chalk.green(pageInfo.title)}`);
      console.log(`ID: ${chalk.green(pageInfo.id)}`);
      console.log(`Space: ${chalk.green(pageInfo.space.name)} (${pageInfo.space.key})`);
      console.log(`URL: ${chalk.gray(`https://${config.domain}/wiki${pageInfo.url}`)}`);
      
      analytics.track('find', true);
    } catch (error) {
      analytics.track('find', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Attachments command
program
  .command('attachments <pageId>')
  .description('List or download attachments for a page')
  .option('-l, --limit <limit>', 'Maximum number of attachments to fetch (default: all)')
  .option('-p, --pattern <glob>', 'Filter attachments by filename (e.g., "*.png")')
  .option('-d, --download', 'Download matching attachments')
  .option('--dest <directory>', 'Directory to save downloads (default: current directory)', '.')
  .action(async (pageId, options) => {
    const analytics = new Analytics();
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);
      const maxResults = options.limit ? parseInt(options.limit, 10) : null;
      const pattern = options.pattern ? options.pattern.trim() : null;

      if (options.limit && (Number.isNaN(maxResults) || maxResults <= 0)) {
        throw new Error('Limit must be a positive number.');
      }

      const attachments = await client.getAllAttachments(pageId, { maxResults });
      const filtered = pattern ? attachments.filter(att => client.matchesPattern(att.title, pattern)) : attachments;

      if (filtered.length === 0) {
        console.log(chalk.yellow('No attachments found.'));
        analytics.track('attachments', true);
        return;
      }

      console.log(chalk.blue(`Found ${filtered.length} attachment${filtered.length === 1 ? '' : 's'}:`));
      filtered.forEach((att, index) => {
        const sizeKb = att.fileSize ? `${Math.max(1, Math.round(att.fileSize / 1024))} KB` : 'unknown size';
        const typeLabel = att.mediaType || 'unknown';
        console.log(`${index + 1}. ${chalk.green(att.title)} (ID: ${att.id})`);
        console.log(`   Type: ${chalk.gray(typeLabel)} • Size: ${chalk.gray(sizeKb)} • Version: ${chalk.gray(att.version)}`);
      });

      if (options.download) {
        const fs = require('fs');
        const path = require('path');
        const destDir = path.resolve(options.dest || '.');
        fs.mkdirSync(destDir, { recursive: true });

        const uniquePathFor = (dir, filename) => {
          const parsed = path.parse(filename);
          let attempt = path.join(dir, filename);
          let counter = 1;
          while (fs.existsSync(attempt)) {
            const suffix = ` (${counter})`;
            const nextName = `${parsed.name}${suffix}${parsed.ext}`;
            attempt = path.join(dir, nextName);
            counter += 1;
          }
          return attempt;
        };

        const writeStream = (stream, targetPath) => new Promise((resolve, reject) => {
          const writer = fs.createWriteStream(targetPath);
          stream.pipe(writer);
          stream.on('error', reject);
          writer.on('error', reject);
          writer.on('finish', resolve);
        });

        let downloaded = 0;
        for (const attachment of filtered) {
          const targetPath = uniquePathFor(destDir, attachment.title);
          // Pass the full attachment object so downloadAttachment can use downloadLink directly
          const dataStream = await client.downloadAttachment(pageId, attachment);
          await writeStream(dataStream, targetPath);
          downloaded += 1;
          console.log(`⬇️  ${chalk.green(attachment.title)} -> ${chalk.gray(targetPath)}`);
        }

        console.log(chalk.green(`Downloaded ${downloaded} attachment${downloaded === 1 ? '' : 's'} to ${destDir}`));
      }

      analytics.track('attachments', true);
    } catch (error) {
      analytics.track('attachments', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Comments command
program
  .command('comments <pageId>')
  .description('List comments for a page by ID or URL')
  .option('-f, --format <format>', 'Output format (text, markdown, json)', 'text')
  .option('-l, --limit <limit>', 'Maximum number of comments to fetch (default: 25)')
  .option('--start <start>', 'Start index for results (default: 0)', '0')
  .option('--location <location>', 'Filter by location (inline, footer, resolved). Comma-separated')
  .option('--depth <depth>', 'Comment depth ("" for root only, "all")')
  .option('--all', 'Fetch all comments (ignores pagination)')
  .action(async (pageId, options) => {
    const analytics = new Analytics();
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);

      const format = (options.format || 'text').toLowerCase();
      if (!['text', 'markdown', 'json'].includes(format)) {
        throw new Error('Format must be one of: text, markdown, json');
      }

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
          depth: options.depth
        });
      } else {
        const response = await client.listComments(pageId, {
          limit: limit || undefined,
          start,
          location: locationParam,
          depth: options.depth
        });
        comments = response.results;
        nextStart = response.nextStart;
      }

      if (comments.length === 0) {
        console.log(chalk.yellow('No comments found.'));
        analytics.track('comments', true);
        return;
      }

      if (format === 'json') {
        const resolvedPageId = await client.extractPageId(pageId);
        const output = {
          pageId: resolvedPageId,
          commentCount: comments.length,
          comments: comments.map(comment => ({
            ...comment,
            bodyStorage: comment.body,
            bodyText: client.formatCommentBody(comment.body, 'text')
          }))
        };
        if (!options.all) {
          output.nextStart = nextStart;
        }
        console.log(JSON.stringify(output, null, 2));
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
    } catch (error) {
      analytics.track('comments', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Comment creation command
program
  .command('comment <pageId>')
  .description('Create a comment on a page by ID or URL (footer or inline)')
  .option('-f, --file <file>', 'Read content from file')
  .option('-c, --content <content>', 'Comment content as string')
  .option('--format <format>', 'Content format (storage, html, markdown)', 'storage')
  .option('--parent <commentId>', 'Reply to a comment by ID')
  .option('--location <location>', 'Comment location (inline or footer)', 'footer')
  .option('--inline-selection <text>', 'Inline selection text')
  .option('--inline-original-selection <text>', 'Original inline selection text')
  .option('--inline-marker-ref <ref>', 'Inline marker reference (optional)')
  .option('--inline-properties <json>', 'Inline properties JSON (advanced)')
  .action(async (pageId, options) => {
    const analytics = new Analytics();
    let location = null;
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);

      let content = '';

      if (options.file) {
        const fs = require('fs');
        if (!fs.existsSync(options.file)) {
          throw new Error(`File not found: ${options.file}`);
        }
        content = fs.readFileSync(options.file, 'utf8');
      } else if (options.content) {
        content = options.content;
      } else {
        throw new Error('Either --file or --content option is required');
      }

      location = (options.location || 'footer').toLowerCase();
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
        inlineProperties: location === 'inline' ? inlineProperties : null
      });

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
    } catch (error) {
      analytics.track('comment_create', false);
      console.error(chalk.red('Error:'), error.message);
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
      if (location === 'inline' && needsInlineMeta) {
        console.error(chalk.yellow('Inline comment creation requires editor highlight metadata (matchIndex, lastFetchTime, serializedHighlights).'));
        console.error(chalk.yellow('Try replying to an existing inline comment or use footer comments instead.'));
      }
      process.exit(1);
    }
  });

// Comment delete command
program
  .command('comment-delete <commentId>')
  .description('Delete a comment by ID')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (commentId, options) => {
    const analytics = new Analytics();
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);

      if (!options.yes) {
        const { confirmed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmed',
            default: false,
            message: `Delete comment ${commentId}?`
          }
        ]);

        if (!confirmed) {
          console.log(chalk.yellow('Cancelled.'));
          analytics.track('comment_delete_cancel', true);
          return;
        }
      }

      const result = await client.deleteComment(commentId);

      console.log(chalk.green('✅ Comment deleted successfully!'));
      console.log(`ID: ${chalk.blue(result.id)}`);
      analytics.track('comment_delete', true);
    } catch (error) {
      analytics.track('comment_delete', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Export page content with attachments
program
  .command('export <pageId>')
  .description('Export a page to a directory with its attachments')
  .option('--format <format>', 'Content format (html, text, markdown)', 'markdown')
  .option('--dest <directory>', 'Base directory to export into', '.')
  .option('--file <filename>', 'Content filename (default: page.<ext>)')
  .option('--attachments-dir <name>', 'Subdirectory for attachments', 'attachments')
  .option('--pattern <glob>', 'Filter attachments by filename (e.g., "*.png")')
  .option('--referenced-only', 'Download only attachments referenced in the page content')
  .option('--skip-attachments', 'Do not download attachments')
  .action(async (pageId, options) => {
    const analytics = new Analytics();
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);
      const fs = require('fs');
      const path = require('path');

      const format = (options.format || 'markdown').toLowerCase();
      const formatExt = { markdown: 'md', html: 'html', text: 'txt' };
      const contentExt = formatExt[format] || 'txt';

      const pageInfo = await client.getPageInfo(pageId);
      const content = await client.readPage(
        pageId,
        format,
        options.referencedOnly ? { extractReferencedAttachments: true } : {}
      );
      const referencedAttachments = options.referencedOnly
        ? (client._referencedAttachments || new Set())
        : null;

      const baseDir = path.resolve(options.dest || '.');
      const folderName = sanitizeTitle(pageInfo.title || 'page');
      const exportDir = path.join(baseDir, folderName);
      fs.mkdirSync(exportDir, { recursive: true });

      const contentFile = options.file || `page.${contentExt}`;
      const contentPath = path.join(exportDir, contentFile);
      fs.writeFileSync(contentPath, content);

      console.log(chalk.green('✅ Page exported'));
      console.log(`Title: ${chalk.blue(pageInfo.title)}`);
      console.log(`Content: ${chalk.gray(contentPath)}`);

      if (!options.skipAttachments) {
        const pattern = options.pattern ? options.pattern.trim() : null;
        const allAttachments = await client.getAllAttachments(pageId);
        
        let filtered;
        if (pattern) {
          filtered = allAttachments.filter(att => client.matchesPattern(att.title, pattern));
        } else if (options.referencedOnly) {
          filtered = allAttachments.filter(att => referencedAttachments?.has(att.title));
        } else {
          filtered = allAttachments;
        }

        if (filtered.length === 0) {
          console.log(chalk.yellow('No attachments to download.'));
        } else {
          const attachmentsDirName = options.attachmentsDir || 'attachments';
          const attachmentsDir = path.join(exportDir, attachmentsDirName);
          fs.mkdirSync(attachmentsDir, { recursive: true });

          const uniquePathFor = (dir, filename) => {
            const parsed = path.parse(filename);
            let attempt = path.join(dir, filename);
            let counter = 1;
            while (fs.existsSync(attempt)) {
              const suffix = ` (${counter})`;
              const nextName = `${parsed.name}${suffix}${parsed.ext}`;
              attempt = path.join(dir, nextName);
              counter += 1;
            }
            return attempt;
          };

          const writeStream = (stream, targetPath) => new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(targetPath);
            stream.pipe(writer);
            stream.on('error', reject);
            writer.on('error', reject);
            writer.on('finish', resolve);
          });

          let downloaded = 0;
          for (const attachment of filtered) {
            const targetPath = uniquePathFor(attachmentsDir, attachment.title);
            // Pass the full attachment object so downloadAttachment can use downloadLink directly
            const dataStream = await client.downloadAttachment(pageId, attachment);
            await writeStream(dataStream, targetPath);
            downloaded += 1;
            console.log(`⬇️  ${chalk.green(attachment.title)} -> ${chalk.gray(targetPath)}`);
          }

          console.log(chalk.green(`Downloaded ${downloaded} attachment${downloaded === 1 ? '' : 's'} to ${attachmentsDir}`));
        }
      }

      analytics.track('export', true);
    } catch (error) {
      analytics.track('export', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

function sanitizeTitle(value) {
  const fallback = 'page';
  if (!value || typeof value !== 'string') {
    return fallback;
  }
  const cleaned = value.replace(/[\\/:*?"<>|]/g, ' ').trim();
  return cleaned || fallback;
}

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
    children: []
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

// Copy page tree command
program
  .command('copy-tree <sourcePageId> <targetParentId> [newTitle]')
  .description('Copy a page and all its children to a new location')
  .option('--max-depth <depth>', 'Maximum depth to copy (default: 10)', '10')
  .option('--exclude <patterns>', 'Comma-separated patterns to exclude (supports wildcards)')
  .option('--delay-ms <ms>', 'Delay between sibling creations in ms (default: 100)', '100')
  .option('--copy-suffix <suffix>', 'Suffix for new root title (default: " (Copy)")', ' (Copy)')
  .option('-n, --dry-run', 'Preview operations without creating pages')
  .option('--fail-on-error', 'Exit with non-zero code if any page fails')
  .option('-q, --quiet', 'Suppress progress output')
  .action(async (sourcePageId, targetParentId, newTitle, options) => {
    const analytics = new Analytics();
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);
      
      // Parse numeric flags with safe fallbacks
      const parsedDepth = parseInt(options.maxDepth, 10);
      const maxDepth = Number.isNaN(parsedDepth) ? 10 : parsedDepth;
      const parsedDelay = parseInt(options.delayMs, 10);
      const delayMs = Number.isNaN(parsedDelay) ? 100 : parsedDelay;
      const copySuffix = options.copySuffix ?? ' (Copy)';

      console.log(chalk.blue('🚀 Starting page tree copy...'));
      console.log(`Source: ${sourcePageId}`);
      console.log(`Target parent: ${targetParentId}`);
      if (newTitle) console.log(`New root title: ${newTitle}`);
      console.log(`Max depth: ${maxDepth}`);
      console.log(`Delay: ${delayMs} ms`);
      if (copySuffix) console.log(`Root suffix: ${copySuffix}`);
      console.log('');

      // Parse exclude patterns
      let excludePatterns = [];
      if (options.exclude) {
        excludePatterns = options.exclude.split(',').map(p => p.trim()).filter(Boolean);
        if (excludePatterns.length > 0) {
          console.log(chalk.yellow(`Exclude patterns: ${excludePatterns.join(', ')}`));
        }
      }

      // Progress callback
      const onProgress = (message) => {
        console.log(message);
      };

      // Dry-run: compute plan without creating anything
      if (options.dryRun) {
        const info = await client.getPageInfo(sourcePageId);
        const rootTitle = newTitle || `${info.title}${copySuffix}`;
        const descendants = await client.getAllDescendantPages(sourcePageId, maxDepth);
        const filtered = descendants.filter(p => !client.shouldExcludePage(p.title, excludePatterns));
        console.log(chalk.yellow('Dry run: no changes will be made.'));
        console.log(`Would create root: ${chalk.blue(rootTitle)} (under parent ${targetParentId})`);
        console.log(`Would create ${filtered.length} child page(s)`);
        // Show a preview list (first 50)
        const tree = client.buildPageTree(filtered, sourcePageId);
        const lines = [];
        const walk = (nodes, depth = 0) => {
          for (const n of nodes) {
            if (lines.length >= 50) return; // limit output
            lines.push(`${'  '.repeat(depth)}- ${n.title}`);
            if (n.children && n.children.length) walk(n.children, depth + 1);
          }
        };
        walk(tree);
        if (lines.length) {
          console.log('Planned children:');
          lines.forEach(l => console.log(l));
          if (filtered.length > lines.length) {
            console.log(`...and ${filtered.length - lines.length} more`);
          }
        }
        analytics.track('copy_tree_dry_run', true);
        return;
      }

      // Copy the page tree
      const result = await client.copyPageTree(
        sourcePageId,
        targetParentId,
        newTitle,
        {
          maxDepth,
          excludePatterns,
          onProgress: options.quiet ? null : onProgress,
          quiet: options.quiet,
          delayMs,
          copySuffix
        }
      );

      console.log('');
      console.log(chalk.green('✅ Page tree copy completed'));
      console.log(`Root page: ${chalk.blue(result.rootPage.title)} (ID: ${result.rootPage.id})`);
      console.log(`Total copied pages: ${chalk.blue(result.totalCopied)}`);
      if (result.failures?.length) {
        console.log(chalk.yellow(`Failures: ${result.failures.length}`));
        result.failures.slice(0, 10).forEach(f => {
          const reason = f.status ? `${f.status}` : '';
          console.log(` - ${f.title} (ID: ${f.id})${reason ? `: ${reason}` : ''}`);
        });
        if (result.failures.length > 10) {
          console.log(` - ...and ${result.failures.length - 10} more`);
        }
      }
      console.log(`URL: ${chalk.gray(`https://${config.domain}/wiki${result.rootPage._links.webui}`)}`);
      if (options.failOnError && result.failures?.length) {
        analytics.track('copy_tree', false);
        console.error(chalk.red('Completed with failures and --fail-on-error is set.'));
        process.exit(1);
      }
      
      analytics.track('copy_tree', true);
    } catch (error) {
      analytics.track('copy_tree', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// List children command
program
  .command('children <pageId>')
  .description('List child pages of a Confluence page')
  .option('-r, --recursive', 'List all descendants recursively', false)
  .option('--max-depth <number>', 'Maximum depth for recursive listing', '10')
  .option('--format <format>', 'Output format (list, tree, json)', 'list')
  .option('--show-url', 'Show page URLs', false)
  .option('--show-id', 'Show page IDs', false)
  .action(async (pageId, options) => {
    const analytics = new Analytics();
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);
      
      // Extract page ID from URL if needed
      const resolvedPageId = await client.extractPageId(pageId);
      
      // Get children
      let children;
      if (options.recursive) {
        const maxDepth = parseInt(options.maxDepth) || 10;
        children = await client.getAllDescendantPages(resolvedPageId, maxDepth);
      } else {
        children = await client.getChildPages(resolvedPageId);
      }
      
      if (children.length === 0) {
        console.log(chalk.yellow('No child pages found.'));
        analytics.track('children', true);
        return;
      }
      
      // Format output
      const format = options.format.toLowerCase();
      
      if (format === 'json') {
        // JSON output
        const output = {
          pageId: resolvedPageId,
          childCount: children.length,
          children: children.map(page => ({
            id: page.id,
            title: page.title,
            type: page.type,
            status: page.status,
            spaceKey: page.space?.key,
            url: `https://${config.domain}/wiki/spaces/${page.space?.key}/pages/${page.id}`,
            parentId: page.parentId || resolvedPageId
          }))
        };
        console.log(JSON.stringify(output, null, 2));
      } else if (format === 'tree' && options.recursive) {
        // Tree format (only for recursive mode)
        const pageInfo = await client.getPageInfo(resolvedPageId);
        console.log(chalk.blue(`📁 ${pageInfo.title}`));
        
        // Build tree structure
        const tree = buildTree(children, resolvedPageId);
        printTree(tree, config, options, 1);
        
        console.log('');
        console.log(chalk.gray(`Total: ${children.length} child page${children.length === 1 ? '' : 's'}`));
      } else {
        // List format (default)
        console.log(chalk.blue('Child pages:'));
        console.log('');
        
        children.forEach((page, index) => {
          let output = `${index + 1}. ${chalk.green(page.title)}`;
          
          if (options.showId) {
            output += ` ${chalk.gray(`(ID: ${page.id})`)}`;
          }
          
          if (options.showUrl) {
            const url = `https://${config.domain}/wiki/spaces/${page.space?.key}/pages/${page.id}`;
            output += `\n   ${chalk.gray(url)}`;
          }
          
          if (options.recursive && page.parentId && page.parentId !== resolvedPageId) {
            output += ` ${chalk.dim('(nested)')}`;
          }
          
          console.log(output);
        });
        
        console.log('');
        console.log(chalk.gray(`Total: ${children.length} child page${children.length === 1 ? '' : 's'}`));
      }
      
      analytics.track('children', true);
    } catch (error) {
      analytics.track('children', false);
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Helper function to build tree structure
function buildTree(pages, rootId) {
  const tree = [];
  const pageMap = new Map();
  
  // Create a map of all pages
  pages.forEach(page => {
    pageMap.set(page.id, { ...page, children: [] });
  });
  
  // Build tree structure
  pages.forEach(page => {
    const node = pageMap.get(page.id);
    const parentId = page.parentId || rootId;
    
    if (parentId === rootId) {
      tree.push(node);
    } else {
      const parent = pageMap.get(parentId);
      if (parent) {
        parent.children.push(node);
      }
    }
  });
  
  return tree;
}

// Helper function to print tree
function printTree(nodes, config, options, depth = 1) {
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1;
    const indent = '  '.repeat(depth - 1);
    const prefix = isLast ? '└── ' : '├── ';
    
    let output = `${indent}${prefix}📄 ${chalk.green(node.title)}`;
    
    if (options.showId) {
      output += ` ${chalk.gray(`(ID: ${node.id})`)}`;
    }
    
    if (options.showUrl) {
      const url = `https://${config.domain}/wiki/spaces/${node.space?.key}/pages/${node.id}`;
      output += `\n${indent}${isLast ? '    ' : '│   '}${chalk.gray(url)}`;
    }
    
    console.log(output);
    
    if (node.children && node.children.length > 0) {
      printTree(node.children, config, options, depth + 1);
    }
  });
}

if (process.argv.length <= 2) {
  program.help({ error: false });
}

program.parse(process.argv);
