const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { sanitizeFilename } = require('../../lib/file-utils');

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

function registerExportCommand(program, { withClient }) {
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
}

module.exports = registerExportCommand;
module.exports.EXPORT_MARKER = EXPORT_MARKER;
module.exports.writeExportMarker = writeExportMarker;
module.exports.isExportDirectory = isExportDirectory;
module.exports.uniquePathFor = uniquePathFor;
module.exports.writeStream = writeStream;
module.exports.sanitizeTitle = sanitizeTitle;
module.exports.exportRecursive = exportRecursive;
