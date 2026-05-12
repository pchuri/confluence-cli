const chalk = require('chalk');
const inquirer = require('inquirer');

function registerVersionCommands(program, { withClient }) {
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
          message: `Delete v${n} of page ${resolvedId}? This cannot be undone.`,
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
          if (event.kind === 'deleted') {
            const note = event.viaExperimental ? chalk.yellow(' (experimental)') : '';
            console.log(chalk.green(`  ✓ deleted v${event.versionNumber}${note}`));
          } else if (event.kind === 'failed') {
            console.log(chalk.red(`  ✗ v${event.versionNumber}: ${event.message}`));
          }
          if (throttleMs > 0) {
            await new Promise(r => setTimeout(r, throttleMs));
          }
        },
      });

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
