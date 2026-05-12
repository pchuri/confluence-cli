const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const inquirer = require('inquirer');

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

function registerAttachmentCommands(program, { withClient }) {
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
            downloadLink: att.downloadLink,
          })),
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
            attachments: downloadResults,
          };
          console.log(JSON.stringify(output, null, 2));
        } else {
          console.log(chalk.green(`Downloaded ${downloadResults.length} attachment${downloadResults.length === 1 ? '' : 's'} to ${destDir}`));
        }
      }

      analytics.track('attachments', true);
    }));

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
        resolved: path.resolve(filePath),
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
          minorEdit: options.minorEdit === true ? true : undefined,
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
            message: `Delete attachment ${attachmentId} from page ${pageId}?`,
          },
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
}

module.exports = registerAttachmentCommands;
