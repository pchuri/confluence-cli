const chalk = require('chalk');
const inquirer = require('inquirer');

function registerVersionCommands(program, { withClient }) {
  program
    .command('versions <pageId>')
    .description('List historical versions of a Confluence page')
    .option('--format <format>', 'Output format: text (default). "json" is deprecated — use --json', 'text')
    .action(withClient('versions', async ({ client, analytics, wantsJson, emitJson }, pageId, options) => {
      const resolvedId = String(await client.extractPageId(pageId));
      const versions = await client.listVersions(resolvedId);

      if (wantsJson(options)) {
        emitJson({ pageId: resolvedId, versions });
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

  program
    .command('version-delete <pageId> <versionNumber>')
    .description('Delete a single historical version of a page (cannot delete the current version)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(withClient('version_delete', async ({ client, analytics, wantsJson, emitJson }, pageId, versionNumber, options) => {
      const jsonMode = wantsJson();
      const resolvedId = String(await client.extractPageId(pageId));
      const n = Number(versionNumber);

      if (!options.yes) {
        if (jsonMode) {
          throw new Error('Refusing to delete without confirmation in --json mode. Pass --yes to proceed.');
        }
        const { confirmed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirmed',
          default: false,
          message: `Delete v${n} of page ${resolvedId}? This cannot be undone.`,
        }]);
        if (!confirmed) {
          console.log(chalk.yellow('Cancelled.'));
          analytics.track('version_delete_cancel', true);
          return;
        }
      }

      const result = await client.deleteVersion(resolvedId, n);

      if (jsonMode) {
        emitJson({ id: result.id, versionNumber: result.versionNumber, viaExperimental: !!result.viaExperimental, deleted: true });
        analytics.track('version_delete', true);
        return;
      }

      const note = result.viaExperimental ? chalk.yellow(' (via experimental endpoint)') : '';
      console.log(chalk.green(`✅ Deleted v${result.versionNumber} of page ${result.id}${note}`));
      analytics.track('version_delete', true);
    }, { writable: true }));

  program
    .command('versions-purge <pageId>')
    .description('Delete every non-current historical version of a page (keeps only current)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--throttle <seconds>', 'Sleep between version-delete calls', '0')
    .action(withClient('versions_purge', async ({ client, analytics, wantsJson, emitJson }, pageId, options) => {
      const jsonMode = wantsJson();
      const resolvedId = String(await client.extractPageId(pageId));
      const versions = await client.listVersions(resolvedId);

      if (versions.length === 0) {
        if (jsonMode) {
          emitJson({ id: resolvedId, deleted: 0, failed: 0, kept: null });
          analytics.track('versions_purge', true);
          return;
        }
        console.log(chalk.yellow(`No versions returned for page ${resolvedId}.`));
        analytics.track('versions_purge', true);
        return;
      }
      const max = Math.max(...versions.map(v => v.number));
      const historicalCount = versions.filter(v => v.number !== max).length;
      if (historicalCount === 0) {
        if (jsonMode) {
          emitJson({ id: resolvedId, deleted: 0, failed: 0, kept: max });
          analytics.track('versions_purge', true);
          return;
        }
        console.log(chalk.yellow(`Only current version v${max} exists for page ${resolvedId}; nothing to purge.`));
        analytics.track('versions_purge', true);
        return;
      }

      if (!options.yes) {
        if (jsonMode) {
          throw new Error('Refusing to purge versions without confirmation in --json mode. Pass --yes to proceed.');
        }
        const { confirmed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirmed',
          default: false,
          message: `Delete ${historicalCount} historical version(s) of page ${resolvedId}? Current version (v${max}) will be kept.`,
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
          if (!jsonMode) {
            if (event.kind === 'deleted') {
              const note = event.viaExperimental ? chalk.yellow(' (experimental)') : '';
              console.log(chalk.green(`  ✓ deleted v${event.versionNumber}${note}`));
            } else if (event.kind === 'failed') {
              console.log(chalk.red(`  ✗ v${event.versionNumber}: ${event.message}`));
            }
          }
          if (throttleMs > 0) {
            await new Promise(r => setTimeout(r, throttleMs));
          }
        },
      });

      if (jsonMode) {
        emitJson({ id: result.id, deleted: result.deleted, failed: result.failed, kept: result.kept });
        analytics.track('versions_purge', result.failed === 0);
        if (result.failed > 0) {
          process.exitCode = 1;
        }
        return;
      }

      console.log('');
      console.log(chalk.green(`✅ Purge complete for page ${result.id}: ` +
        `${result.deleted} deleted, ${result.failed} failed, kept v${result.kept}.`));
      analytics.track('versions_purge', result.failed === 0);
      if (result.failed > 0) {
        process.exitCode = 1;
      }
    }, { writable: true }));
}

module.exports = registerVersionCommands;
