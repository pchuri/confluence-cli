#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const ConfluenceClient = require('../lib/confluence-client');
const { getConfig, initConfig, listProfiles, setActiveProfile, deleteProfile, isValidProfileName } = require('../lib/config');
const Analytics = require('../lib/analytics');
const pkg = require('../package.json');

function assertWritable(config) {
  if (config.readOnly) {
    console.error(chalk.red('Error: This profile is in read-only mode. Write operations are not allowed.'));
    console.error(chalk.yellow('Tip: Use "confluence profile add <name>" without --read-only, or set readOnly to false in config.'));
    process.exit(1);
  }
}

function assertNonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required and cannot be empty.`);
  }
}

const VALID_TYPES = ['page', 'folder'];

function assertValidType(type) {
  if (!VALID_TYPES.includes(type)) {
    throw new Error(`Invalid type "${type}". Valid: ${VALID_TYPES.join(', ')}`);
  }
}

function assertNoBodyForFolder(type, options) {
  if (type === 'folder' && (options.file || options.content)) {
    throw new Error('--file/--content is not allowed with --type folder (folders have no body).');
  }
}

function handleCommandError(analytics, commandName, error, onExtra = null) {
  analytics.track(commandName, false);
  console.error(chalk.red('Error:'), error.message);
  if (onExtra) {
    try { onExtra(error); } catch { /* keep error path robust if hint code throws */ }
  }
  process.exit(1);
}

async function readStdin() {
  process.stdin.setEncoding('utf8');
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data;
}

// Wraps a command action with the standard analytics + client + error pipeline.
// The handler still calls analytics.track(name, true) on success so it can opt
// into alternative tracking keys (e.g. *_cancel, *_dry_run).
// `onError(error, ...actionArgs)` runs between the "Error:" log line and
// process.exit, for commands that need to print extra diagnostics.
function withClient(commandName, handler, { writable = false, onError = null } = {}) {
  return async (...actionArgs) => {
    const analytics = new Analytics();
    try {
      const config = getConfig(getProfileName());
      if (writable) assertWritable(config);
      const client = new ConfluenceClient(config);
      await handler({ client, config, analytics }, ...actionArgs);
    } catch (error) {
      const extra = onError ? (err) => onError(err, ...actionArgs) : null;
      handleCommandError(analytics, commandName, error, extra);
    }
  };
}

// Same analytics + error pipeline as withClient, but without loading config or
// constructing a ConfluenceClient. For commands that work entirely locally
// (convert, stats, …).
function withLocal(commandName, handler) {
  return async (...actionArgs) => {
    const analytics = new Analytics();
    try {
      await handler({ analytics }, ...actionArgs);
    } catch (error) {
      handleCommandError(analytics, commandName, error);
    }
  };
}

program
  .name('confluence')
  .description('CLI tool for Atlassian Confluence')
  .version(pkg.version)
  .option('--profile <name>', 'Use a specific configuration profile');

// Helper: resolve profile name from global --profile flag
function getProfileName() {
  return program.opts().profile || undefined;
}

// Init command
program
  .command('init')
  .description('Initialize Confluence CLI configuration')
  .option('-d, --domain <domain>', 'Confluence domain')
  .option('--protocol <protocol>', 'Protocol (http or https)')
  .option('-p, --api-path <path>', 'REST API path')
  .option('-a, --auth-type <type>', 'Authentication type (basic, bearer, mtls, or cookie)')
  .option('-e, --email <email>', 'Email or username for basic auth')
  .option('-t, --token <token>', 'API token')
  .option('-c, --cookie <cookie>', 'Cookie for Enterprise SSO authentication (e.g., "JSESSIONID=...")')
  .option('--tls-ca-cert <path>', 'CA certificate for mTLS connections')
  .option('--tls-client-cert <path>', 'Client certificate for mTLS connections')
  .option('--tls-client-key <path>', 'Client private key for mTLS connections')
  .option('--read-only', 'Set profile to read-only mode (blocks write operations)')
  .action(async (options) => {
    const profile = getProfileName();
    await initConfig({ ...options, profile });
  });

// Read command
program
  .command('read <pageId>')
  .description('Read a Confluence page by ID or URL')
  .option('-f, --format <format>', 'Output format (html, text, storage, markdown)', 'text')
  .action(withClient('read', async ({ client, analytics }, pageId, options) => {
    const content = await client.readPage(pageId, options.format);
    console.log(content);
    analytics.track('read', true);
  }));

// Info command
program
  .command('info <pageId>')
  .description('Get information about a Confluence page')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(withClient('info', async ({ client, analytics }, pageId, options) => {
    const info = await client.getPageInfo(pageId);

    if ((options.format || 'text').toLowerCase() === 'json') {
      console.log(JSON.stringify(info, null, 2));
    } else {
      console.log(chalk.blue('Page Information:'));
      console.log(`Title: ${chalk.green(info.title)}`);
      console.log(`ID: ${chalk.green(info.id)}`);
      console.log(`Type: ${chalk.green(info.type)}`);
      console.log(`Status: ${chalk.green(info.status)}`);
      if (info.space) {
        console.log(`Space: ${chalk.green(info.space.name)} (${info.space.key})`);
      }
    }
    analytics.track('info', true);
  }));

// Search command
program
  .command('search <query>')
  .description('Search for Confluence pages')
  .option('-l, --limit <limit>', 'Limit number of results', '10')
  .option('--cql', 'Pass query as raw CQL instead of text search')
  .action(withClient('search', async ({ client, analytics }, query, options) => {
    const results = await client.search(query, parseInt(options.limit), options.cql);

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
  }));

// List spaces command
program
  .command('spaces')
  .description('List Confluence spaces')
  .option('-l, --limit <limit>', 'Maximum total spaces to return across paginated requests', '500')
  .option('--all', 'Fetch every space, paginating through all results (overrides --limit)')
  .action(withClient('spaces', async ({ client, analytics }, options) => {
    const maxResults = options.all ? null : parseInt(options.limit);
    const spaces = await client.getSpaces(maxResults);

    console.log(chalk.blue(`Available spaces (${spaces.length}):`));
    spaces.forEach(space => {
      console.log(`${chalk.green(space.key)} - ${space.name}`);
    });
    analytics.track('spaces', true);
  }));

// Stats command
program
  .command('stats')
  .description('Show usage statistics')
  .action(withLocal('stats', async ({ analytics }) => {
    analytics.showStats();
  }));

// Install skill command
program
  .command('install-skill')
  .description('Copy Claude Code skill files into your project\'s .claude/skills/ directory')
  .option('--dest <directory>', 'Target directory', './.claude/skills/confluence')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (options) => {

    const skillSrc = path.join(__dirname, '..', 'plugins', 'confluence', 'skills', 'confluence', 'SKILL.md');

    if (!fs.existsSync(skillSrc)) {
      console.error(chalk.red('Error: skill file not found in package. Try reinstalling confluence-cli.'));
      process.exit(1);
    }

    const destDir = path.resolve(options.dest);
    const destFile = path.join(destDir, 'SKILL.md');

    if (fs.existsSync(destFile) && !options.yes) {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          default: true,
          message: `Overwrite existing skill file at ${destFile}?`
        }
      ]);

      if (!confirmed) {
        console.log(chalk.yellow('Cancelled.'));
        return;
      }
    }

    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(skillSrc, destFile);

    console.log(chalk.green('✅ Skill installed successfully!'));
    console.log(`Location: ${chalk.gray(destFile)}`);
    console.log(chalk.yellow('Claude Code will now pick up confluence-cli knowledge from this file.'));
  });

// Create command
program
  .command('create <title> <spaceKey>')
  .description('Create a new Confluence page or folder')
  .option('-f, --file <file>', 'Read content from file')
  .option('-c, --content <content>', 'Page content as string')
  .option('--format <format>', 'Content format (storage, html, markdown)', 'storage')
  .option('--type <type>', 'Content type (page, folder)', 'page')
  .action(withClient('create', async ({ client, analytics }, title, spaceKey, options) => {
    assertNonEmpty(title, 'title');
    assertNonEmpty(spaceKey, 'spaceKey');
    assertValidType(options.type);
    assertNoBodyForFolder(options.type, options);

    let content = '';

    if (options.file) {
      if (!fs.existsSync(options.file)) {
        throw new Error(`File not found: ${options.file}`);
      }
      content = fs.readFileSync(options.file, 'utf8');
    } else if (options.content) {
      content = options.content;
    } else if (options.type !== 'folder') {
      throw new Error('Either --file or --content option is required');
    }

    const result = await client.createPage(title, spaceKey, content, options.format, options.type);

    const label = options.type === 'folder' ? 'Folder' : 'Page';
    console.log(chalk.green(`✅ ${label} created successfully!`));
    console.log(`Title: ${chalk.blue(result.title)}`);
    console.log(`ID: ${chalk.blue(result.id)}`);
    console.log(`Space: ${chalk.blue(result.space.name)} (${result.space.key})`);
    console.log(`URL: ${chalk.gray(`${client.buildUrl(`${client.webUrlPrefix}${result._links.webui}`)}`)}`);

    analytics.track('create', true);
  }, { writable: true }));

// Create child page command
program
  .command('create-child <title> <parentId>')
  .description('Create a new Confluence page or folder as a child of another page')
  .option('-f, --file <file>', 'Read content from file')
  .option('-c, --content <content>', 'Page content as string')
  .option('--format <format>', 'Content format (storage, html, markdown)', 'storage')
  .option('--type <type>', 'Content type (page, folder)', 'page')
  .action(withClient('create_child', async ({ client, analytics }, title, parentId, options) => {
    assertNonEmpty(title, 'title');
    assertNonEmpty(parentId, 'parentId');
    assertValidType(options.type);
    assertNoBodyForFolder(options.type, options);

    // Get parent page info to get space key
    const parentInfo = await client.getPageInfo(parentId);
    const spaceKey = parentInfo.space.key;

    let content = '';

    if (options.file) {
      if (!fs.existsSync(options.file)) {
        throw new Error(`File not found: ${options.file}`);
      }
      content = fs.readFileSync(options.file, 'utf8');
    } else if (options.content) {
      content = options.content;
    } else if (options.type !== 'folder') {
      throw new Error('Either --file or --content option is required');
    }

    const result = await client.createChildPage(title, spaceKey, parentId, content, options.format, options.type);

    const label = options.type === 'folder' ? 'Folder' : 'Child page';
    console.log(chalk.green(`✅ ${label} created successfully!`));
    console.log(`Title: ${chalk.blue(result.title)}`);
    console.log(`ID: ${chalk.blue(result.id)}`);
    console.log(`Parent: ${chalk.blue(parentInfo.title)} (${parentId})`);
    console.log(`Space: ${chalk.blue(result.space.name)} (${result.space.key})`);
    console.log(`URL: ${chalk.gray(`${client.buildUrl(`${client.webUrlPrefix}${result._links.webui}`)}`)}`);

    analytics.track('create_child', true);
  }, { writable: true }));

// Update command
program
  .command('update <pageId>')
  .description('Update an existing Confluence page')
  .option('-t, --title <title>', 'New page title (optional)')
  .option('-f, --file <file>', 'Read content from file')
  .option('-c, --content <content>', 'Page content as string')
  .option('--format <format>', 'Content format (storage, html, markdown)', 'storage')
  .action(withClient('update', async ({ client, analytics }, pageId, options) => {
    // Check if at least one option is provided
    if (!options.title && !options.file && !options.content) {
      throw new Error('At least one of --title, --file, or --content must be provided.');
    }

    if (options.title !== undefined) {
      assertNonEmpty(options.title, '--title');
    }

    let content = null; // Use null to indicate no content change

    if (options.file) {
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
    console.log(`URL: ${chalk.gray(`${client.buildUrl(`${client.webUrlPrefix}${result._links.webui}`)}`)}`);

    analytics.track('update', true);
  }, { writable: true }));

// Move command
program
  .command('move <pageId_or_url> <newParentId_or_url>')
  .description('Move a page to a new parent location (within same space)')
  .option('-t, --title <title>', 'New page title (optional)')
  .action(withClient('move', async ({ client, analytics }, pageId, newParentId, options) => {
    const result = await client.movePage(pageId, newParentId, options.title);

    console.log(chalk.green('✅ Page moved successfully!'));
    console.log(`Title: ${chalk.blue(result.title)}`);
    console.log(`ID: ${chalk.blue(result.id)}`);
    console.log(`New Parent: ${chalk.blue(newParentId)}`);
    console.log(`Version: ${chalk.blue(result.version.number)}`);
    console.log(`URL: ${chalk.gray(`${client.buildUrl(`${client.webUrlPrefix}${result._links.webui}`)}`)}`);

    analytics.track('move', true);
  }, { writable: true }));

// Delete command
program
  .command('delete <pageIdOrUrl>')
  .description('Delete a Confluence page by ID or URL')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(withClient('delete', async ({ client, analytics }, pageIdOrUrl, options) => {
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
  }, { writable: true }));

// List historical versions of a page
program
  .command('versions <pageId>')
  .description('List historical versions of a Confluence page')
  .option('--format <format>', 'Output format: text or json (default: text)', 'text')
  .action(withClient('versions', async ({ client, analytics }, pageId, options) => {
    const resolvedId = String(await client.extractPageId(pageId));
    const versions = await client.listVersions(resolvedId);

    if (options.format === 'json') {
      console.log(JSON.stringify({ pageId: resolvedId, versions }, null, 2));
    } else {
      const max = versions.length ? Math.max(...versions.map(v => v.number)) : 0;
      console.log(chalk.blue(`Versions for page ${resolvedId} (${versions.length} total):`));
      if (versions.length === 0) {
        console.log(chalk.yellow('  (no versions returned)'));
      }
      for (const v of versions) {
        const tag = v.number === max ? chalk.green(' [current]') : '';
        const author = v.by || 'unknown';
        const note = v.message ? `  — ${v.message}` : '';
        console.log(`  v${v.number}${tag}  ${v.when}  ${author}${note}`);
      }
    }
    analytics.track('versions', true);
  }));

// Delete a single historical version of a page
program
  .command('version-delete <pageId> <versionNumber>')
  .description('Delete a single historical version of a page (cannot delete the current version)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(withClient('version_delete', async ({ client, analytics }, pageId, versionNumber, options) => {
    const resolvedId = String(await client.extractPageId(pageId));
    const n = Number(versionNumber);

    if (!options.yes) {
      const { confirmed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirmed',
        default: false,
        message: `Delete v${n} of page ${resolvedId}? This cannot be undone.`
      }]);
      if (!confirmed) {
        console.log(chalk.yellow('Cancelled.'));
        analytics.track('version_delete_cancel', true);
        return;
      }
    }

    const result = await client.deleteVersion(resolvedId, n);
    const note = result.viaExperimental ? chalk.yellow(' (via experimental endpoint)') : '';
    console.log(chalk.green(`✅ Deleted v${result.versionNumber} of page ${result.id}${note}`));
    analytics.track('version_delete', true);
  }, { writable: true }));

// Convenience: delete every non-current historical version of a page,
// keeping only the current one.
program
  .command('versions-purge <pageId>')
  .description('Delete every non-current historical version of a page (keeps only current)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--throttle <seconds>', 'Sleep between version-delete calls', '0')
  .action(withClient('versions_purge', async ({ client, analytics }, pageId, options) => {
    const resolvedId = String(await client.extractPageId(pageId));
    const versions = await client.listVersions(resolvedId);

    if (versions.length === 0) {
      console.log(chalk.yellow(`No versions returned for page ${resolvedId}.`));
      analytics.track('versions_purge', true);
      return;
    }
    const max = Math.max(...versions.map(v => v.number));
    const historicalCount = versions.filter(v => v.number !== max).length;
    if (historicalCount === 0) {
      console.log(chalk.yellow(`Only current version v${max} exists for page ${resolvedId}; nothing to purge.`));
      analytics.track('versions_purge', true);
      return;
    }

    if (!options.yes) {
      const { confirmed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirmed',
        default: false,
        message: `Delete ${historicalCount} historical version(s) of page ${resolvedId}? Current version (v${max}) will be kept.`
      }]);
      if (!confirmed) {
        console.log(chalk.yellow('Cancelled.'));
        analytics.track('versions_purge_cancel', true);
        return;
      }
    }

    const throttleMs = Math.max(0, parseFloat(options.throttle || '0')) * 1000;
    const result = await client.purgeNonCurrentVersions(resolvedId, {
      onProgress: async (event) => {
        if (event.kind === 'deleted') {
          const note = event.viaExperimental ? chalk.yellow(' (experimental)') : '';
          console.log(chalk.green(`  ✓ deleted v${event.versionNumber}${note}`));
        } else if (event.kind === 'failed') {
          console.log(chalk.red(`  ✗ v${event.versionNumber}: ${event.message}`));
        }
        if (throttleMs > 0) {
          await new Promise(r => setTimeout(r, throttleMs));
        }
      }
    });

    console.log('');
    console.log(chalk.green(`✅ Purge complete for page ${result.id}: ` +
      `${result.deleted} deleted, ${result.failed} failed, kept v${result.kept}.`));
    analytics.track('versions_purge', result.failed === 0);
    if (result.failed > 0) {
      process.exitCode = 1;
    }
  }, { writable: true }));

// Edit command - opens page content for editing
program
  .command('edit <pageId>')
  .description('Get page content for editing')
  .option('-o, --output <file>', 'Save content to file')
  .action(withClient('edit', async ({ client, analytics }, pageId, options) => {
    const pageData = await client.getPageForEdit(pageId);

    console.log(chalk.blue('Page Information:'));
    console.log(`Title: ${chalk.green(pageData.title)}`);
    console.log(`ID: ${chalk.green(pageData.id)}`);
    console.log(`Version: ${chalk.green(pageData.version)}`);
    console.log(`Space: ${chalk.green(pageData.space.name)} (${pageData.space.key})`);
    console.log('');

    if (options.output) {
      fs.writeFileSync(options.output, pageData.content);
      console.log(chalk.green(`✅ Content saved to: ${options.output}`));
      console.log(chalk.yellow('💡 Edit the file and use "confluence update" to save changes'));
    } else {
      console.log(chalk.blue('Page Content:'));
      console.log(pageData.content);
    }

    analytics.track('edit', true);
  }, { writable: true }));

// Find page by title command
program
  .command('find <title>')
  .description('Find a page by title')
  .option('-s, --space <spaceKey>', 'Limit search to specific space')
  .action(withClient('find', async ({ client, analytics }, title, options) => {
    const pageInfo = await client.findPageByTitle(title, options.space);

    console.log(chalk.blue('Page found:'));
    console.log(`Title: ${chalk.green(pageInfo.title)}`);
    console.log(`ID: ${chalk.green(pageInfo.id)}`);
    console.log(`Space: ${chalk.green(pageInfo.space.name)} (${pageInfo.space.key})`);
    console.log(`URL: ${chalk.gray(`${client.buildUrl(`${client.webUrlPrefix}${pageInfo.url}`)}`)}`);

    analytics.track('find', true);
  }));

// Attachments command
program
  .command('attachments <pageId>')
  .description('List or download attachments for a page')
  .option('-l, --limit <limit>', 'Maximum number of attachments to fetch (default: all)')
  .option('-p, --pattern <glob>', 'Filter attachments by filename (e.g., "*.png")')
  .option('-d, --download', 'Download matching attachments')
  .option('--dest <directory>', 'Directory to save downloads (default: current directory)', '.')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(withClient('attachments', async ({ client, analytics }, pageId, options) => {
    const maxResults = options.limit ? parseInt(options.limit, 10) : null;
    const pattern = options.pattern ? options.pattern.trim() : null;

    if (options.limit && (Number.isNaN(maxResults) || maxResults <= 0)) {
      throw new Error('Limit must be a positive number.');
    }

    const format = (options.format || 'text').toLowerCase();
    if (!['text', 'json'].includes(format)) {
      throw new Error('Format must be one of: text, json');
    }

    const attachments = await client.getAllAttachments(pageId, { maxResults });
    const filtered = pattern ? attachments.filter(att => client.matchesPattern(att.title, pattern)) : attachments;

    if (filtered.length === 0) {
      if (format === 'json') {
        console.log(JSON.stringify({ attachmentCount: 0, attachments: [] }, null, 2));
      } else {
        console.log(chalk.yellow('No attachments found.'));
      }
      analytics.track('attachments', true);
      return;
    }

    if (format === 'json' && !options.download) {
      const output = {
        attachmentCount: filtered.length,
        attachments: filtered.map(att => ({
          id: att.id,
          title: att.title,
          mediaType: att.mediaType || '',
          fileSize: att.fileSize,
          fileSizeFormatted: att.fileSize ? `${Math.max(1, Math.round(att.fileSize / 1024))} KB` : 'unknown size',
          version: att.version,
          downloadLink: att.downloadLink
        }))
      };
      console.log(JSON.stringify(output, null, 2));
    } else if (!options.download) {
      console.log(chalk.blue(`Found ${filtered.length} attachment${filtered.length === 1 ? '' : 's'}:`));
      filtered.forEach((att, index) => {
        const sizeKb = att.fileSize ? `${Math.max(1, Math.round(att.fileSize / 1024))} KB` : 'unknown size';
        const typeLabel = att.mediaType || 'unknown';
        console.log(`${index + 1}. ${chalk.green(att.title)} (ID: ${att.id})`);
        console.log(`   Type: ${chalk.gray(typeLabel)} • Size: ${chalk.gray(sizeKb)} • Version: ${chalk.gray(att.version)}`);
      });
    }

    if (options.download) {
      const destDir = path.resolve(options.dest || '.');
      fs.mkdirSync(destDir, { recursive: true });

      const uniquePathFor = (dir, filename) => {
        const safeFilename = sanitizeFilename(filename);
        const parsed = path.parse(safeFilename);
        let attempt = path.join(dir, safeFilename);
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

      const downloadResults = [];
      for (const attachment of filtered) {
        const targetPath = uniquePathFor(destDir, attachment.title);
        const dataStream = await client.downloadAttachment(pageId, attachment);
        await writeStream(dataStream, targetPath);
        downloadResults.push({ title: attachment.title, id: attachment.id, savedTo: targetPath });
        if (format !== 'json') {
          console.log(`⬇️  ${chalk.green(attachment.title)} -> ${chalk.gray(targetPath)}`);
        }
      }

      if (format === 'json') {
        const output = {
          attachmentCount: filtered.length,
          downloaded: downloadResults.length,
          destination: destDir,
          attachments: downloadResults
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(chalk.green(`Downloaded ${downloadResults.length} attachment${downloadResults.length === 1 ? '' : 's'} to ${destDir}`));
      }
    }

    analytics.track('attachments', true);
  }));

// Attachment upload command
program
  .command('attachment-upload <pageId>')
  .description('Upload one or more attachments to a page')
  .option('-f, --file <file>', 'File to upload (repeatable)', (value, previous) => {
    const files = Array.isArray(previous) ? previous : [];
    files.push(value);
    return files;
  }, [])
  .option('--comment <comment>', 'Comment for the attachment(s)')
  .option('--replace', 'Replace an existing attachment with the same filename')
  .option('--minor-edit', 'Mark the upload as a minor edit')
  .action(withClient('attachment_upload', async ({ client, analytics }, pageId, options) => {
    const files = Array.isArray(options.file) ? options.file.filter(Boolean) : [];
    if (files.length === 0) {
      throw new Error('At least one --file option is required.');
    }

    const resolvedFiles = files.map((filePath) => ({
      original: filePath,
      resolved: path.resolve(filePath)
    }));

    resolvedFiles.forEach((file) => {
      if (!fs.existsSync(file.resolved)) {
        throw new Error(`File not found: ${file.original}`);
      }
    });

    let uploaded = 0;
    for (const file of resolvedFiles) {
      const result = await client.uploadAttachment(pageId, file.resolved, {
        comment: options.comment,
        replace: options.replace,
        minorEdit: options.minorEdit === true ? true : undefined
      });
      const attachment = result.results[0];
      if (attachment) {
        console.log(`⬆️  ${chalk.green(attachment.title)} (ID: ${attachment.id}, Version: ${attachment.version})`);
      } else {
        console.log(`⬆️  ${chalk.green(path.basename(file.resolved))}`);
      }
      uploaded += 1;
    }

    console.log(chalk.green(`Uploaded ${uploaded} attachment${uploaded === 1 ? '' : 's'} to page ${pageId}`));
    analytics.track('attachment_upload', true);
  }, { writable: true }));

// Attachment delete command
program
  .command('attachment-delete <pageId> <attachmentId>')
  .description('Delete an attachment by ID from a page')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(withClient('attachment_delete', async ({ client, analytics }, pageId, attachmentId, options) => {
    if (!options.yes) {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          default: false,
          message: `Delete attachment ${attachmentId} from page ${pageId}?`
        }
      ]);

      if (!confirmed) {
        console.log(chalk.yellow('Cancelled.'));
        analytics.track('attachment_delete_cancel', true);
        return;
      }
    }

    const result = await client.deleteAttachment(pageId, attachmentId);

    console.log(chalk.green('✅ Attachment deleted successfully!'));
    console.log(`ID: ${chalk.blue(result.id)}`);
    console.log(`Page ID: ${chalk.blue(result.pageId)}`);
    analytics.track('attachment_delete', true);
  }, { writable: true }));

// Property list command
program
  .command('property-list <pageId>')
  .description('List all content properties for a page')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('-l, --limit <limit>', 'Maximum number of properties to fetch (default: 25)')
  .option('--start <start>', 'Start index for results (default: 0)', '0')
  .option('--all', 'Fetch all properties (ignores pagination)')
  .action(withClient('property_list', async ({ client, analytics }, pageId, options) => {
    const format = (options.format || 'text').toLowerCase();
    if (!['text', 'json'].includes(format)) {
      throw new Error('Format must be one of: text, json');
    }

    const limit = options.limit ? parseInt(options.limit, 10) : null;
    if (options.limit && (Number.isNaN(limit) || limit <= 0)) {
      throw new Error('Limit must be a positive number.');
    }

    const start = options.start ? parseInt(options.start, 10) : 0;
    if (options.start && (Number.isNaN(start) || start < 0)) {
      throw new Error('Start must be a non-negative number.');
    }

    let properties = [];
    let nextStart = null;

    if (options.all) {
      properties = await client.getAllProperties(pageId, {
        maxResults: limit || null,
        start
      });
    } else {
      const response = await client.listProperties(pageId, {
        limit: limit || undefined,
        start
      });
      properties = response.results;
      nextStart = response.nextStart;
    }

    if (format === 'json') {
      const output = { properties };
      if (!options.all) {
        output.nextStart = nextStart;
      }
      console.log(JSON.stringify(output, null, 2));
    } else if (properties.length === 0) {
      console.log(chalk.yellow('No properties found.'));
    } else {
      properties.forEach((prop, i) => {
        const preview = JSON.stringify(prop.value);
        const truncated = preview.length > 80 ? preview.slice(0, 77) + '...' : preview;
        console.log(`${chalk.blue(i + 1 + '.')} ${chalk.green(prop.key)} (v${prop.version.number}): ${truncated}`);
      });

      if (!options.all && nextStart !== null && nextStart !== undefined) {
        console.log(chalk.gray(`Next start: ${nextStart}`));
      }
    }
    analytics.track('property_list', true);
  }));

// Property get command
program
  .command('property-get <pageId> <key>')
  .description('Get a content property by key')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(withClient('property_get', async ({ client, analytics }, pageId, key, options) => {
    const format = (options.format || 'text').toLowerCase();
    if (!['text', 'json'].includes(format)) {
      throw new Error('Format must be one of: text, json');
    }

    const property = await client.getProperty(pageId, key);

    if (format === 'json') {
      console.log(JSON.stringify(property, null, 2));
    } else {
      console.log(`${chalk.green('Key:')} ${property.key}`);
      console.log(`${chalk.green('Version:')} ${property.version.number}`);
      console.log(`${chalk.green('Value:')}`);
      console.log(JSON.stringify(property.value, null, 2));
    }
    analytics.track('property_get', true);
  }));

// Property set command
program
  .command('property-set <pageId> <key>')
  .description('Set a content property (create or update)')
  .option('-v, --value <json>', 'Property value as JSON')
  .option('--file <file>', 'Read property value from a JSON file')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(withClient('property_set', async ({ client, analytics }, pageId, key, options) => {
    if (!options.value && !options.file) {
      throw new Error('Provide a value with --value or --file.');
    }

    let value;
    if (options.file) {
      const raw = fs.readFileSync(options.file, 'utf-8');
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error(`Invalid JSON in file ${options.file}`);
      }
    } else {
      try {
        value = JSON.parse(options.value);
      } catch {
        throw new Error('Invalid JSON in --value');
      }
    }

    const format = (options.format || 'text').toLowerCase();
    if (!['text', 'json'].includes(format)) {
      throw new Error('Format must be one of: text, json');
    }

    const result = await client.setProperty(pageId, key, value);

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.green('✅ Property set successfully!'));
      console.log(`${chalk.green('Key:')} ${result.key}`);
      console.log(`${chalk.green('Version:')} ${result.version.number}`);
      console.log(`${chalk.green('Value:')}`);
      console.log(JSON.stringify(result.value, null, 2));
    }
    analytics.track('property_set', true);
  }, { writable: true }));

// Property delete command
program
  .command('property-delete <pageId> <key>')
  .description('Delete a content property by key')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(withClient('property_delete', async ({ client, analytics }, pageId, key, options) => {
    if (!options.yes) {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          default: false,
          message: `Delete property "${key}" from page ${pageId}?`
        }
      ]);

      if (!confirmed) {
        console.log(chalk.yellow('Cancelled.'));
        analytics.track('property_delete_cancel', true);
        return;
      }
    }

    const result = await client.deleteProperty(pageId, key);

    console.log(chalk.green('✅ Property deleted successfully!'));
    console.log(`${chalk.green('Key:')} ${chalk.blue(result.key)}`);
    console.log(`${chalk.green('Page ID:')} ${chalk.blue(result.pageId)}`);
    analytics.track('property_delete', true);
  }, { writable: true }));

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
  .action(withClient('comments', async ({ client, analytics }, pageId, options) => {
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
  }));

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
  .action(withClient('comment_create', async ({ client, analytics }, pageId, options) => {
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
    }
  }));

// Comment delete command
program
  .command('comment-delete <commentId>')
  .description('Delete a comment by ID')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(withClient('comment_delete', async ({ client, analytics }, commentId, options) => {
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
  }, { writable: true }));

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
  .option('-r, --recursive', 'Export page and all descendants')
  .option('--max-depth <depth>', 'Limit recursion depth (default: 10)', parseInt)
  .option('--exclude <patterns>', 'Comma-separated title glob patterns to skip')
  .option('--delay-ms <ms>', 'Delay between page exports in ms (default: 100)', parseInt)
  .option('--dry-run', 'Preview pages without writing files')
  .option('--overwrite', 'Overwrite existing export directory (replaces content, removes stale files)')
  .action(withClient('export', async ({ client, analytics }, pageId, options) => {
    if (options.recursive) {
      await exportRecursive(client, fs, path, pageId, options);
      analytics.track('export', true);
      return;
    }

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
    if (options.overwrite && fs.existsSync(exportDir)) {
      if (!isExportDirectory(fs, path, exportDir)) {
        throw new Error(`Refusing to overwrite "${exportDir}" - it was not created by confluence-cli (missing ${EXPORT_MARKER}).`);
      }
      fs.rmSync(exportDir, { recursive: true, force: true });
    }
    fs.mkdirSync(exportDir, { recursive: true });

    const contentFile = options.file || `page.${contentExt}`;
    const contentPath = path.join(exportDir, contentFile);
    fs.writeFileSync(contentPath, content);
    writeExportMarker(fs, path, exportDir, { pageId, title: pageInfo.title });

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

        let downloaded = 0;
        for (const attachment of filtered) {
          const targetPath = uniquePathFor(fs, path, attachmentsDir, attachment.title);
          // Pass the full attachment object so downloadAttachment can use downloadLink directly
          const dataStream = await client.downloadAttachment(pageId, attachment);
          await writeStream(fs, dataStream, targetPath);
          downloaded += 1;
          console.log(`⬇️  ${chalk.green(attachment.title)} -> ${chalk.gray(targetPath)}`);
        }

        console.log(chalk.green(`Downloaded ${downloaded} attachment${downloaded === 1 ? '' : 's'} to ${attachmentsDir}`));
      }
    }

    analytics.track('export', true);
  }));

const EXPORT_MARKER = '.confluence-export.json';

function writeExportMarker(fs, path, exportDir, meta) {
  const marker = {
    exportedAt: new Date().toISOString(),
    pageId: meta.pageId,
    title: meta.title,
    tool: 'confluence-cli',
  };
  fs.writeFileSync(path.join(exportDir, EXPORT_MARKER), JSON.stringify(marker, null, 2));
}

function isExportDirectory(fs, path, dir) {
  return fs.existsSync(path.join(dir, EXPORT_MARKER));
}

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

function uniquePathFor(fs, path, dir, filename) {
  const safeFilename = sanitizeFilename(filename);
  const parsed = path.parse(safeFilename);
  let attempt = path.join(dir, safeFilename);
  let counter = 1;
  while (fs.existsSync(attempt)) {
    const suffix = ` (${counter})`;
    const nextName = `${parsed.name}${suffix}${parsed.ext}`;
    attempt = path.join(dir, nextName);
    counter += 1;
  }
  return attempt;
}

function writeStream(fs, stream, targetPath) {
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(targetPath);
    stream.pipe(writer);
    stream.on('error', reject);
    writer.on('error', reject);
    writer.on('finish', resolve);
  });
}

async function exportRecursive(client, fs, path, pageId, options) {
  const maxDepth = options.maxDepth || 10;
  const delayMs = options.delayMs != null ? options.delayMs : 100;
  const excludePatterns = options.exclude
    ? options.exclude.split(',').map(p => p.trim()).filter(Boolean)
    : [];
  const format = (options.format || 'markdown').toLowerCase();
  const formatExt = { markdown: 'md', html: 'html', text: 'txt' };
  const contentExt = formatExt[format] || 'txt';
  const contentFile = options.file || `page.${contentExt}`;
  const baseDir = path.resolve(options.dest || '.');

  // 1. Fetch root page
  const rootPage = await client.getPageInfo(pageId);
  console.log(`Fetching descendants of "${chalk.blue(rootPage.title)}"...`);

  // 2. Fetch all descendants
  const descendants = await client.getAllDescendantPages(pageId, maxDepth);

  // 3. Filter by exclude patterns
  const allPages = [{ id: rootPage.id, title: rootPage.title, parentId: null }];
  for (const page of descendants) {
    if (excludePatterns.length && client.shouldExcludePage(page.title, excludePatterns)) {
      continue;
    }
    allPages.push(page);
  }

  // 4. Build tree
  const tree = client.buildPageTree(allPages.slice(1), pageId);

  const totalPages = allPages.length;
  console.log(`Found ${chalk.blue(totalPages)} page${totalPages === 1 ? '' : 's'} to export.`);

  // 5. Dry run — print tree and return
  if (options.dryRun) {
    const printTree = (nodes, indent = '') => {
      for (const node of nodes) {
        console.log(`${indent}${chalk.blue(node.title)} (${node.id})`);
        if (node.children && node.children.length) {
          printTree(node.children, indent + '  ');
        }
      }
    };
    console.log(`\n${chalk.blue(rootPage.title)} (${rootPage.id})`);
    printTree(tree, '  ');
    console.log(chalk.yellow('\nDry run — no files written.'));
    return;
  }

  // 6. Overwrite — remove existing root export directory for a clean slate
  if (options.overwrite) {
    const rootFolderName = sanitizeTitle(rootPage.title);
    const rootExportDir = path.join(baseDir, rootFolderName);
    if (fs.existsSync(rootExportDir)) {
      if (!isExportDirectory(fs, path, rootExportDir)) {
        throw new Error(`Refusing to overwrite "${rootExportDir}" - it was not created by confluence-cli (missing ${EXPORT_MARKER}).`);
      }
      fs.rmSync(rootExportDir, { recursive: true, force: true });
    }
  }

  // 7. Walk tree depth-first and export each page
  const failures = [];
  let exported = 0;

  async function exportPage(page, dir) {
    exported += 1;
    console.log(`[${exported}/${totalPages}] Exporting: ${chalk.blue(page.title)}`);

    const folderName = sanitizeTitle(page.title);
    let exportDir = path.join(dir, folderName);

    // Handle duplicate sibling folder names
    if (fs.existsSync(exportDir)) {
      let counter = 1;
      while (fs.existsSync(`${exportDir} (${counter})`)) {
        counter += 1;
      }
      exportDir = `${exportDir} (${counter})`;
    }
    fs.mkdirSync(exportDir, { recursive: true });

    // Fetch content and write
    const content = await client.readPage(
      page.id,
      format,
      options.referencedOnly ? { extractReferencedAttachments: true } : {}
    );
    const referencedAttachments = options.referencedOnly
      ? (client._referencedAttachments || new Set())
      : null;
    fs.writeFileSync(path.join(exportDir, contentFile), content);

    // Download attachments
    if (!options.skipAttachments) {
      const pattern = options.pattern ? options.pattern.trim() : null;
      const allAttachments = await client.getAllAttachments(page.id);

      let filtered;
      if (pattern) {
        filtered = allAttachments.filter(att => client.matchesPattern(att.title, pattern));
      } else if (options.referencedOnly) {
        filtered = allAttachments.filter(att => referencedAttachments?.has(att.title));
      } else {
        filtered = allAttachments;
      }

      if (filtered.length > 0) {
        const attachmentsDirName = options.attachmentsDir || 'attachments';
        const attachmentsDir = path.join(exportDir, attachmentsDirName);
        fs.mkdirSync(attachmentsDir, { recursive: true });

        for (const attachment of filtered) {
          const targetPath = uniquePathFor(fs, path, attachmentsDir, attachment.title);
          const dataStream = await client.downloadAttachment(page.id, attachment);
          await writeStream(fs, dataStream, targetPath);
        }
      }
    }

    return exportDir;
  }

  async function walkTree(nodes, parentDir) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      try {
        const nodeDir = await exportPage(node, parentDir);
        if (node.children && node.children.length) {
          await walkTree(node.children, nodeDir);
        }
      } catch (error) {
        failures.push({ id: node.id, title: node.title, error: error.message });
        console.error(chalk.red(`  Failed: ${node.title} — ${error.message}`));
      }

      // Rate limiting between pages
      if (delayMs > 0 && exported < totalPages) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  // Export root page
  let rootDir;
  try {
    rootDir = await exportPage(rootPage, baseDir);
    writeExportMarker(fs, path, rootDir, { pageId, title: rootPage.title });
  } catch (error) {
    failures.push({ id: rootPage.id, title: rootPage.title, error: error.message });
    console.error(chalk.red(`  Failed: ${rootPage.title} — ${error.message}`));
    // Can't continue without root directory
    throw new Error(`Failed to export root page: ${error.message}`);
  }

  if (delayMs > 0 && tree.length > 0) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  // Export descendants
  await walkTree(tree, rootDir);

  // 8. Summary
  const succeeded = exported - failures.length;
  console.log(chalk.green(`\n✅ Exported ${succeeded}/${totalPages} page${totalPages === 1 ? '' : 's'} to ${rootDir}`));
  if (failures.length > 0) {
    console.log(chalk.red(`\n${failures.length} failure${failures.length === 1 ? '' : 's'}:`));
    for (const f of failures) {
      console.log(chalk.red(`  - ${f.title} (${f.id}): ${f.error}`));
    }
  }
}

function sanitizeTitle(value) {
  const fallback = 'page';
  if (!value || typeof value !== 'string') {
    return fallback;
  }
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/^\.+/, '')
    .trim();
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
  .action(withClient('copy_tree', async ({ client, analytics }, sourcePageId, targetParentId, newTitle, options) => {
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
    console.log(`URL: ${chalk.gray(`${client.buildUrl(`${client.webUrlPrefix}${result.rootPage._links.webui}`)}`)}`);
    if (options.failOnError && result.failures?.length) {
      analytics.track('copy_tree', false);
      console.error(chalk.red('Completed with failures and --fail-on-error is set.'));
      process.exit(1);
    }

    analytics.track('copy_tree', true);
  }, { writable: true }));

// List children command
program
  .command('children <pageId>')
  .description('List child pages of a Confluence page')
  .option('-r, --recursive', 'List all descendants recursively', false)
  .option('--max-depth <number>', 'Maximum depth for recursive listing', '10')
  .option('--format <format>', 'Output format (list, tree, json)', 'list')
  .option('--show-url', 'Show page URLs', false)
  .option('--show-id', 'Show page IDs', false)
  .action(withClient('children', async ({ client, config, analytics }, pageId, options) => {
    const format = (options.format || 'list').toLowerCase();

    // Extract page ID from URL if needed
    const resolvedPageId = await client.extractPageId(pageId);

    // Get children
    let children;
    if (options.recursive) {
      const maxDepth = parseInt(options.maxDepth) || 10;
      children = await client.getAllDescendantPages(
        resolvedPageId,
        maxDepth,
        { includeAncestors: format === 'json' }
      );
    } else {
      children = await client.getChildPages(resolvedPageId);
    }

    if (children.length === 0) {
      if (format === 'json') {
        console.log(JSON.stringify({
          pageId: String(resolvedPageId),
          childCount: 0,
          children: []
        }, null, 2));
      } else {
        console.log(chalk.yellow('No child pages found.'));
      }
      analytics.track('children', true);
      return;
    }

    if (format === 'json') {
      // JSON output
      const output = {
        pageId: String(resolvedPageId),
        childCount: children.length,
        children: children.map(page => {
          const record = {
            id: page.id,
            title: page.title,
            type: page.type,
            status: page.status,
            spaceKey: page.spaceKey || page.space?.key || null,
            parentId: page.parentId || String(resolvedPageId),
            version: page.version ?? null,
            url: page.url || null
          };

          if (options.recursive && page.depth !== undefined) {
            record.depth = page.depth;
          }

          if (options.recursive && Array.isArray(page.ancestors) && page.ancestors.length > 0) {
            record.ancestors = page.ancestors;
          }

          return record;
        })
      };
      console.log(JSON.stringify(output, null, 2));
    } else if (format === 'tree' && options.recursive) {
      // Tree format (only for recursive mode)
      const pageInfo = await client.getPageInfo(resolvedPageId);
      console.log(chalk.blue(`📁 ${pageInfo.title}`));

      // Build tree structure
      const tree = buildTree(children, resolvedPageId);
      printTree(tree, client, config, options, 1);

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
          const url = `${client.buildUrl(`${client.webUrlPrefix}/spaces/${page.space?.key}/pages/${page.id}`)}`;
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
  }));

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
function printTree(nodes, client, config, options, depth = 1) {
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1;
    const indent = '  '.repeat(depth - 1);
    const prefix = isLast ? '└── ' : '├── ';
    
    let output = `${indent}${prefix}📄 ${chalk.green(node.title)}`;
    
    if (options.showId) {
      output += ` ${chalk.gray(`(ID: ${node.id})`)}`;
    }
    
    if (options.showUrl) {
      const url = `${client.buildUrl(`${client.webUrlPrefix}/spaces/${node.space?.key}/pages/${node.id}`)}`;
      output += `\n${indent}${isLast ? '    ' : '│   '}${chalk.gray(url)}`;
    }
    
    console.log(output);

    if (node.children && node.children.length > 0) {
      printTree(node.children, client, config, options, depth + 1);
    }
  });
}

// Profile management commands
const profileCmd = program
  .command('profile')
  .description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all configuration profiles')
  .action(() => {
    const { profiles } = listProfiles();
    if (profiles.length === 0) {
      console.log(chalk.yellow('No profiles configured. Run "confluence init" to create one.'));
      return;
    }
    console.log(chalk.blue('Configuration profiles:\n'));
    profiles.forEach(p => {
      const marker = p.active ? chalk.green(' (active)') : '';
      const readOnlyBadge = p.readOnly ? chalk.red(' [read-only]') : '';
      console.log(`  ${p.active ? chalk.green('*') : ' '} ${chalk.cyan(p.name)}${marker}${readOnlyBadge} - ${chalk.gray(p.domain)}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Set the active configuration profile')
  .action((name) => {
    try {
      setActiveProfile(name);
      console.log(chalk.green(`Switched to profile "${name}"`));
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

profileCmd
  .command('add <name>')
  .description('Add a new configuration profile interactively')
  .option('-d, --domain <domain>', 'Confluence domain')
  .option('--protocol <protocol>', 'Protocol (http or https)')
  .option('-p, --api-path <path>', 'REST API path')
  .option('-a, --auth-type <type>', 'Authentication type (basic, bearer, mtls, or cookie)')
  .option('-e, --email <email>', 'Email or username for basic auth')
  .option('-t, --token <token>', 'API token')
  .option('-c, --cookie <cookie>', 'Cookie for Enterprise SSO authentication (e.g., "JSESSIONID=...")')
  .option('--tls-ca-cert <path>', 'CA certificate for mTLS connections')
  .option('--tls-client-cert <path>', 'Client certificate for mTLS connections')
  .option('--tls-client-key <path>', 'Client private key for mTLS connections')
  .option('--read-only', 'Set profile to read-only mode (blocks write operations)')
  .action(async (name, options) => {
    if (!isValidProfileName(name)) {
      console.error(chalk.red('Invalid profile name. Use only letters, numbers, hyphens, and underscores.'));
      process.exit(1);
    }
    await initConfig({ ...options, profile: name });
  });

profileCmd
  .command('remove <name>')
  .description('Remove a configuration profile')
  .action(async (name) => {
    try {
      const { confirmed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirmed',
        message: `Delete profile "${name}"?`,
        default: false
      }]);
      if (!confirmed) {
        console.log(chalk.yellow('Cancelled.'));
        return;
      }
      deleteProfile(name);
      console.log(chalk.green(`Profile "${name}" removed.`));
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Convert command (local format conversion, no server connection required)
const VALID_INPUT_FORMATS = ['markdown', 'storage', 'html'];
const VALID_OUTPUT_FORMATS = ['markdown', 'storage', 'html', 'text'];

program
  .command('convert')
  .description('Convert between content formats locally (no server connection required)')
  .option('-i, --input-file <file>', 'Input file path (reads from stdin if omitted)')
  .option('-o, --output-file <file>', 'Output file path (writes to stdout if omitted)')
  .option('--input-format <format>', `Input format (${VALID_INPUT_FORMATS.join(', ')})`)
  .option('--output-format <format>', `Output format (${VALID_OUTPUT_FORMATS.join(', ')})`)
  .action(withLocal('convert', async ({ analytics }, options) => {
    if (!options.inputFormat) {
      console.error(chalk.red('Error: --input-format is required.'));
      process.exit(1);
    }
    if (!options.outputFormat) {
      console.error(chalk.red('Error: --output-format is required.'));
      process.exit(1);
    }
    if (!VALID_INPUT_FORMATS.includes(options.inputFormat)) {
      console.error(chalk.red(`Error: Invalid input format "${options.inputFormat}". Valid: ${VALID_INPUT_FORMATS.join(', ')}`));
      process.exit(1);
    }
    if (!VALID_OUTPUT_FORMATS.includes(options.outputFormat)) {
      console.error(chalk.red(`Error: Invalid output format "${options.outputFormat}". Valid: ${VALID_OUTPUT_FORMATS.join(', ')}`));
      process.exit(1);
    }
    if (options.inputFormat === options.outputFormat) {
      console.error(chalk.red('Error: Input and output formats must be different.'));
      process.exit(1);
    }

    let input;
    if (options.inputFile) {
      input = fs.readFileSync(options.inputFile, 'utf-8');
    } else {
      if (process.stdin.isTTY) {
        console.error(chalk.red('Error: No input provided. Use --input-file <path> or pipe content via stdin.'));
        process.exit(1);
      }
      input = await readStdin();
    }

    const converter = ConfluenceClient.createLocalConverter();
    let output;

    if (options.inputFormat === 'markdown' && options.outputFormat === 'storage') {
      output = converter.markdownToStorage(input);
    } else if (options.inputFormat === 'markdown' && options.outputFormat === 'html') {
      output = converter.markdown.render(input);
    } else if (options.inputFormat === 'html' && options.outputFormat === 'storage') {
      output = converter.htmlToConfluenceStorage(input);
    } else if (options.inputFormat === 'storage' && options.outputFormat === 'markdown') {
      output = converter.storageToMarkdown(input);
    } else if (options.inputFormat === 'storage' && options.outputFormat === 'text') {
      const { convert: htmlToText } = require('html-to-text');
      output = htmlToText(input, { wordwrap: 130 });
    } else if (options.inputFormat === 'storage' && options.outputFormat === 'html') {
      output = input; // storage format is already HTML-based
    } else if (options.inputFormat === 'html' && options.outputFormat === 'text') {
      const { convert: htmlToText } = require('html-to-text');
      output = htmlToText(input, { wordwrap: 130 });
    } else if (options.inputFormat === 'html' && options.outputFormat === 'markdown') {
      output = converter.htmlToMarkdown(input);
    } else if (options.inputFormat === 'markdown' && options.outputFormat === 'text') {
      const html = converter.markdown.render(input);
      const { convert: htmlToText } = require('html-to-text');
      output = htmlToText(html, { wordwrap: 130 });
    } else {
      console.error(chalk.red(`Error: Conversion from "${options.inputFormat}" to "${options.outputFormat}" is not supported.`));
      process.exit(1);
    }

    if (options.outputFile) {
      fs.writeFileSync(options.outputFile, output, 'utf-8');
      console.error(chalk.green(`Converted ${options.inputFormat} → ${options.outputFormat}: ${options.outputFile}`));
    } else {
      process.stdout.write(output);
    }
    analytics.track('convert', true);
  }));

// Exported for testing
module.exports = {
  program,
  _test: {
    EXPORT_MARKER,
    writeExportMarker,
    isExportDirectory,
    uniquePathFor,
    exportRecursive,
    sanitizeTitle,
    sanitizeFilename,
    assertWritable,
    assertNonEmpty,
    assertValidType,
    assertNoBodyForFolder,
    handleCommandError,
    withClient,
    withLocal,
  },
};

if (require.main === module) {
  if (process.argv.length <= 2) {
    program.help({ error: false });
  }
  program.parse(process.argv);
}
