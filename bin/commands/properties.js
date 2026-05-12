const fs = require('fs');
const chalk = require('chalk');
const inquirer = require('inquirer');

function registerPropertyCommands(program, { withClient }) {
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
          start,
        });
      } else {
        const response = await client.listProperties(pageId, {
          limit: limit || undefined,
          start,
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
            message: `Delete property "${key}" from page ${pageId}?`,
          },
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
}

module.exports = registerPropertyCommands;
