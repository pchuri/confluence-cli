const chalk = require('chalk');
const inquirer = require('inquirer');
const {
  initConfig,
  listProfiles,
  setActiveProfile,
  deleteProfile,
  isValidProfileName,
} = require('../../lib/config');

function registerProfileCommands(program, { withLocal }) {
  const profileCmd = program
    .command('profile')
    .description('Manage configuration profiles');

  profileCmd
    .command('list')
    .description('List all configuration profiles')
    .action(withLocal('profile_list', async () => {
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
    }));

  profileCmd
    .command('use <name>')
    .description('Set the active configuration profile')
    .action(withLocal('profile_use', async (_ctx, name) => {
      setActiveProfile(name);
      console.log(chalk.green(`Switched to profile "${name}"`));
    }));

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
    .action(withLocal('profile_add', async (_ctx, name, options) => {
      if (!isValidProfileName(name)) {
        throw new Error('Invalid profile name. Use only letters, numbers, hyphens, and underscores.');
      }
      await initConfig({ ...options, profile: name });
    }));

  profileCmd
    .command('remove <name>')
    .description('Remove a configuration profile')
    .action(withLocal('profile_remove', async (_ctx, name) => {
      const { confirmed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirmed',
        message: `Delete profile "${name}"?`,
        default: false,
      }]);
      if (!confirmed) {
        console.log(chalk.yellow('Cancelled.'));
        return;
      }
      deleteProfile(name);
      console.log(chalk.green(`Profile "${name}" removed.`));
    }));
}

module.exports = registerProfileCommands;
