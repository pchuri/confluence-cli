#!/usr/bin/env node

const { program } = require('commander');
const chalk = require('chalk');
const ConfluenceClient = require('../lib/confluence-client');
const { getConfig, initConfig } = require('../lib/config');

program
  .name('confluence')
  .description('CLI tool for Atlassian Confluence')
  .version('1.0.0');

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
  .option('-f, --format <format>', 'Output format (html, text)', 'text')
  .action(async (pageId, options) => {
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);
      const content = await client.readPage(pageId, options.format);
      console.log(content);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Info command
program
  .command('info <pageId>')
  .description('Get information about a Confluence page')
  .action(async (pageId) => {
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
    } catch (error) {
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
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);
      const results = await client.search(query, parseInt(options.limit));
      
      if (results.length === 0) {
        console.log(chalk.yellow('No results found.'));
        return;
      }

      console.log(chalk.blue(`Found ${results.length} results:`));
      results.forEach((result, index) => {
        console.log(`${index + 1}. ${chalk.green(result.title)} (ID: ${result.id})`);
        if (result.excerpt) {
          console.log(`   ${chalk.gray(result.excerpt)}`);
        }
      });
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// List spaces command
program
  .command('spaces')
  .description('List all Confluence spaces')
  .action(async () => {
    try {
      const config = getConfig();
      const client = new ConfluenceClient(config);
      const spaces = await client.getSpaces();
      
      console.log(chalk.blue('Available spaces:'));
      spaces.forEach(space => {
        console.log(`${chalk.green(space.key)} - ${space.name}`);
      });
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

program.parse();
