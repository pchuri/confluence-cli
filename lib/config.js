const fs = require('fs');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');
const chalk = require('chalk');

const CONFIG_DIR = path.join(os.homedir(), '.confluence-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/**
 * Initialize configuration
 */
async function initConfig() {
  console.log(chalk.blue('🚀 Confluence CLI Configuration'));
  console.log('Please provide your Confluence connection details:\n');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'domain',
      message: 'Confluence domain (e.g., yourcompany.atlassian.net):',
      validate: (input) => {
        if (!input.trim()) {
          return 'Domain is required';
        }
        return true;
      }
    },
    {
      type: 'password',
      name: 'token',
      message: 'API Token:',
      validate: (input) => {
        if (!input.trim()) {
          return 'API Token is required';
        }
        return true;
      }
    }
  ]);

  // Create config directory if it doesn't exist
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Save configuration
  const config = {
    domain: answers.domain.trim(),
    token: answers.token.trim()
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  
  console.log(chalk.green('✅ Configuration saved successfully!'));
  console.log(`Config file location: ${chalk.gray(CONFIG_FILE)}`);
  console.log(chalk.yellow('\n💡 Tip: You can regenerate this config anytime by running "confluence init"'));
}

/**
 * Get configuration
 */
function getConfig() {
  // First check for environment variables
  const envDomain = process.env.CONFLUENCE_DOMAIN || process.env.CONFLUENCE_HOST;
  const envToken = process.env.CONFLUENCE_API_TOKEN;

  if (envDomain && envToken) {
    return {
      domain: envDomain,
      token: envToken
    };
  }

  // Check for config file
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error(chalk.red('❌ No configuration found!'));
    console.log(chalk.yellow('Please run "confluence init" to set up your configuration.'));
    console.log(chalk.gray('Or set environment variables: CONFLUENCE_DOMAIN and CONFLUENCE_API_TOKEN'));
    process.exit(1);
  }

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return config;
  } catch (error) {
    console.error(chalk.red('❌ Error reading configuration file:'), error.message);
    console.log(chalk.yellow('Please run "confluence init" to recreate your configuration.'));
    process.exit(1);
  }
}

module.exports = {
  initConfig,
  getConfig
};
