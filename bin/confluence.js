#!/usr/bin/env node

const { program } = require('commander');
const chalk = require('chalk');
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
  .action(async () => {
    await initConfig();
  });

// Read command
program
  .command('read <pageId>')
  .description('Read a Confluence page by ID or URL')
  .option('-f, --format <format>', 'Output format (html, text, markdown)', 'text')
  .action(async (pageId, options) => {
    const analytics = new Analytics();
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);
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
      const config = getConfig();
      const client = new ConfluenceClient(config);
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
      const config = getConfig();
      const client = new ConfluenceClient(config);
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

program.parse();
