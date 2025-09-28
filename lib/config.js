const fs = require('fs');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');
const chalk = require('chalk');

const CONFIG_DIR = path.join(os.homedir(), '.confluence-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const AUTH_CHOICES = [
  { name: 'Basic (email + API token)', value: 'basic' },
  { name: 'Bearer token', value: 'bearer' }
];

const requiredInput = (label) => (input) => {
  if (!input || !input.trim()) {
    return `${label} is required`;
  }
  return true;
};

const normalizeAuthType = (rawValue, hasEmail) => {
  const normalized = (rawValue || '').trim().toLowerCase();
  if (normalized === 'basic' || normalized === 'bearer') {
    return normalized;
  }
  return hasEmail ? 'basic' : 'bearer';
};

const inferApiPath = (domain) => {
  if (!domain) {
    return '/rest/api';
  }

  const normalizedDomain = domain.trim().toLowerCase();
  if (normalizedDomain.endsWith('.atlassian.net')) {
    return '/wiki/rest/api';
  }

  return '/rest/api';
};

const normalizeApiPath = (rawValue, domain) => {
  const trimmed = (rawValue || '').trim();

  if (!trimmed) {
    return inferApiPath(domain);
  }

  if (!trimmed.startsWith('/')) {
    throw new Error('Confluence API path must start with "/".');
  }

  const withoutTrailing = trimmed.replace(/\/+$/, '');
  return withoutTrailing || inferApiPath(domain);
};

async function initConfig() {
  console.log(chalk.blue('🚀 Confluence CLI Configuration'));
  console.log('Please provide your Confluence connection details:\n');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'domain',
      message: 'Confluence domain (e.g., yourcompany.atlassian.net):',
      validate: requiredInput('Domain')
    },
    {
      type: 'input',
      name: 'apiPath',
      message: 'REST API path (Cloud: /wiki/rest/api, Server: /rest/api):',
      default: (responses) => inferApiPath(responses.domain),
      validate: (input, responses) => {
        const value = (input || '').trim();
        if (!value) {
          return true;
        }
        if (!value.startsWith('/')) {
          return 'API path must start with "/"';
        }
        try {
          normalizeApiPath(value, responses.domain);
          return true;
        } catch (error) {
          return error.message;
        }
      }
    },
    {
      type: 'list',
      name: 'authType',
      message: 'Authentication method:',
      choices: AUTH_CHOICES,
      default: 'basic'
    },
    {
      type: 'input',
      name: 'email',
      message: 'Confluence email (used with API token):',
      when: (responses) => responses.authType === 'basic',
      validate: requiredInput('Email')
    },
    {
      type: 'password',
      name: 'token',
      message: 'API Token:',
      validate: requiredInput('API Token')
    }
  ]);

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const config = {
    domain: answers.domain.trim(),
    apiPath: normalizeApiPath(answers.apiPath, answers.domain),
    token: answers.token.trim(),
    authType: answers.authType,
    email: answers.authType === 'basic' ? answers.email.trim() : undefined
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  console.log(chalk.green('✅ Configuration saved successfully!'));
  console.log(`Config file location: ${chalk.gray(CONFIG_FILE)}`);
  console.log(chalk.yellow('\n💡 Tip: You can regenerate this config anytime by running "confluence init"'));
}

function getConfig() {
  const envDomain = process.env.CONFLUENCE_DOMAIN || process.env.CONFLUENCE_HOST;
  const envToken = process.env.CONFLUENCE_API_TOKEN;
  const envEmail = process.env.CONFLUENCE_EMAIL;
  const envAuthType = process.env.CONFLUENCE_AUTH_TYPE;
  const envApiPath = process.env.CONFLUENCE_API_PATH;

  if (envDomain && envToken) {
    const authType = normalizeAuthType(envAuthType, Boolean(envEmail));
    let apiPath;

    try {
      apiPath = normalizeApiPath(envApiPath, envDomain);
    } catch (error) {
      console.error(chalk.red(`❌ ${error.message}`));
      process.exit(1);
    }

    if (authType === 'basic' && !envEmail) {
      console.error(chalk.red('❌ Basic authentication requires CONFLUENCE_EMAIL.'));
      console.log(chalk.yellow('Set CONFLUENCE_EMAIL or switch to bearer auth by setting CONFLUENCE_AUTH_TYPE=bearer.'));
      process.exit(1);
    }

    return {
      domain: envDomain.trim(),
      apiPath,
      token: envToken.trim(),
      email: envEmail ? envEmail.trim() : undefined,
      authType
    };
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    console.error(chalk.red('❌ No configuration found!'));
    console.log(chalk.yellow('Please run "confluence init" to set up your configuration.'));
    console.log(chalk.gray('Or set environment variables: CONFLUENCE_DOMAIN, CONFLUENCE_API_TOKEN, CONFLUENCE_EMAIL, and optionally CONFLUENCE_API_PATH.'));
    process.exit(1);
  }

  try {
    const storedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const trimmedDomain = (storedConfig.domain || '').trim();
    const trimmedToken = (storedConfig.token || '').trim();
    const trimmedEmail = storedConfig.email ? storedConfig.email.trim() : undefined;
    const authType = normalizeAuthType(storedConfig.authType, Boolean(trimmedEmail));
    let apiPath;

    if (!trimmedDomain || !trimmedToken) {
      console.error(chalk.red('❌ Configuration file is missing required values.'));
      console.log(chalk.yellow('Run "confluence init" to refresh your settings.'));
      process.exit(1);
    }

    if (authType === 'basic' && !trimmedEmail) {
      console.error(chalk.red('❌ Basic authentication requires an email address.'));
      console.log(chalk.yellow('Please rerun "confluence init" to add your Confluence email.'));
      process.exit(1);
    }

    try {
      apiPath = normalizeApiPath(storedConfig.apiPath, trimmedDomain);
    } catch (error) {
      console.error(chalk.red(`❌ ${error.message}`));
      console.log(chalk.yellow('Please rerun "confluence init" to update your API path.'));
      process.exit(1);
    }

    return {
      domain: trimmedDomain,
      apiPath,
      token: trimmedToken,
      email: trimmedEmail,
      authType
    };
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
