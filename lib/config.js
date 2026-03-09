const fs = require('fs');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');
const chalk = require('chalk');

const CONFIG_DIR = path.join(os.homedir(), '.confluence-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_PROFILE = 'default';

const AUTH_CHOICES = [
  { name: 'Basic (credentials)', value: 'basic' },
  { name: 'Bearer token', value: 'bearer' }
];

const isValidProfileName = (name) => /^[a-zA-Z0-9_-]+$/.test(name);

const requiredInput = (label) => (input) => {
  if (!input || !input.trim()) {
    return `${label} is required`;
  }
  return true;
};

const PROTOCOL_CHOICES = [
  { name: 'HTTPS (recommended)', value: 'https' },
  { name: 'HTTP', value: 'http' }
];

const normalizeProtocol = (rawValue) => {
  const normalized = (rawValue || '').trim().toLowerCase();
  if (normalized === 'http' || normalized === 'https') {
    return normalized;
  }
  return 'https';
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

// Read config file with backward compatibility for old flat format
function readConfigFile() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

    // Detect old flat format (has domain at top level, no profiles key)
    if (raw.domain && !raw.profiles) {
      const profile = {
        domain: raw.domain,
        protocol: raw.protocol,
        apiPath: raw.apiPath,
        token: raw.token,
        authType: raw.authType
      };
      if (raw.email) {
        profile.email = raw.email;
      }
      return {
        activeProfile: DEFAULT_PROFILE,
        profiles: { [DEFAULT_PROFILE]: profile }
      };
    }

    return raw;
  } catch {
    return null;
  }
}

// Write the full multi-profile config structure
function saveConfigFile(data) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// Helper function to validate CLI-provided options
const validateCliOptions = (options) => {
  const errors = [];

  if (options.domain && !options.domain.trim()) {
    errors.push('--domain cannot be empty');
  }

  if (options.token && !options.token.trim()) {
    errors.push('--token cannot be empty');
  }

  if (options.email && !options.email.trim()) {
    errors.push('--email cannot be empty');
  }

  if (options.apiPath) {
    if (!options.apiPath.startsWith('/')) {
      errors.push('--api-path must start with "/"');
    } else {
      // Validate API path format
      try {
        normalizeApiPath(options.apiPath, options.domain || 'example.com');
      } catch (error) {
        errors.push(`--api-path is invalid: ${error.message}`);
      }
    }
  }

  if (options.protocol && !['http', 'https'].includes(options.protocol.toLowerCase())) {
    errors.push('--protocol must be "http" or "https"');
  }

  if (options.authType && !['basic', 'bearer'].includes(options.authType.toLowerCase())) {
    errors.push('--auth-type must be "basic" or "bearer"');
  }

  // Check if basic auth is provided with email
  const normAuthType = options.authType ? normalizeAuthType(options.authType, Boolean(options.email)) : null;
  if (normAuthType === 'basic' && !options.email) {
    errors.push('--email is required when using basic authentication (use your username for on-premise)');
  }

  return errors;
};

// Helper function to save configuration with validation
const saveConfig = (configData, profileName) => {
  const config = {
    domain: configData.domain.trim(),
    protocol: normalizeProtocol(configData.protocol),
    apiPath: normalizeApiPath(configData.apiPath, configData.domain),
    token: configData.token.trim(),
    authType: configData.authType
  };

  if (configData.authType === 'basic' && configData.email) {
    config.email = configData.email.trim();
  }

  // Read existing config file (or create new structure)
  const fileData = readConfigFile() || { activeProfile: DEFAULT_PROFILE, profiles: {} };

  const targetProfile = profileName || fileData.activeProfile || DEFAULT_PROFILE;
  fileData.profiles[targetProfile] = config;

  // If this is the first profile, make it active
  if (!fileData.activeProfile || !fileData.profiles[fileData.activeProfile]) {
    fileData.activeProfile = targetProfile;
  }

  saveConfigFile(fileData);

  console.log(chalk.green('✅ Configuration saved successfully!'));
  if (profileName) {
    console.log(`Profile: ${chalk.cyan(targetProfile)}`);
  }
  console.log(`Config file location: ${chalk.gray(CONFIG_FILE)}`);
  console.log(chalk.yellow('\n💡 Tip: You can regenerate this config anytime by running "confluence init"'));
};

// Helper function to prompt for missing values
const promptForMissingValues = async (providedValues) => {
  const questions = [];

  // Protocol question
  if (!providedValues.protocol) {
    questions.push({
      type: 'list',
      name: 'protocol',
      message: 'Protocol:',
      choices: PROTOCOL_CHOICES,
      default: 'https'
    });
  }

  // Domain question
  if (!providedValues.domain) {
    questions.push({
      type: 'input',
      name: 'domain',
      message: 'Confluence domain (e.g., yourcompany.atlassian.net):',
      validate: requiredInput('Domain')
    });
  }

  // API Path question
  if (!providedValues.apiPath) {
    questions.push({
      type: 'input',
      name: 'apiPath',
      message: 'REST API path (Cloud: /wiki/rest/api, Server: /rest/api):',
      default: (responses) => inferApiPath(providedValues.domain || responses.domain),
      validate: (input, responses) => {
        const value = (input || '').trim();
        if (!value) {
          return true;
        }
        if (!value.startsWith('/')) {
          return 'API path must start with "/"';
        }
        try {
          const domain = providedValues.domain || responses.domain;
          normalizeApiPath(value, domain);
          return true;
        } catch (error) {
          return error.message;
        }
      }
    });
  }

  // Auth Type question
  const hasEmail = Boolean(providedValues.email);
  if (!providedValues.authType) {
    questions.push({
      type: 'list',
      name: 'authType',
      message: 'Authentication method:',
      choices: AUTH_CHOICES,
      default: hasEmail ? 'basic' : 'bearer'
    });
  }

  // Email question (conditional on authType)
  if (!providedValues.email) {
    questions.push({
      type: 'input',
      name: 'email',
      message: 'Email / username:',
      when: (responses) => {
        const authType = providedValues.authType || responses.authType;
        return authType === 'basic';
      },
      validate: requiredInput('Email / username')
    });
  }

  // Token question
  if (!providedValues.token) {
    questions.push({
      type: 'password',
      name: 'token',
      message: 'API token / password:',
      validate: requiredInput('API token / password')
    });
  }

  if (questions.length === 0) {
    return providedValues;
  }

  const answers = await inquirer.prompt(questions);
  return { ...providedValues, ...answers };
};

async function initConfig(cliOptions = {}) {
  const profileName = cliOptions.profile;

  // Validate profile name if provided
  if (profileName && !isValidProfileName(profileName)) {
    console.error(chalk.red('❌ Invalid profile name. Use only letters, numbers, hyphens, and underscores.'));
    process.exit(1);
  }

  // Extract provided values from CLI options
  const providedValues = {
    protocol: cliOptions.protocol,
    domain: cliOptions.domain,
    apiPath: cliOptions.apiPath,
    authType: cliOptions.authType,
    email: cliOptions.email,
    token: cliOptions.token
  };

  // Check if any CLI options were provided
  const hasCliOptions = Object.values(providedValues).some(v => v);

  if (!hasCliOptions) {
    // Interactive mode: no CLI options provided
    console.log(chalk.blue('🚀 Confluence CLI Configuration'));
    if (profileName) {
      console.log(`Profile: ${chalk.cyan(profileName)}`);
    }
    console.log('Please provide your Confluence connection details:\n');

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'protocol',
        message: 'Protocol:',
        choices: PROTOCOL_CHOICES,
        default: 'https'
      },
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
        message: 'Email / username:',
        when: (responses) => responses.authType === 'basic',
        validate: requiredInput('Email / username')
      },
      {
        type: 'password',
        name: 'token',
        message: 'API token / password:',
        validate: requiredInput('API token / password')
      }
    ]);

    saveConfig(answers, profileName);
    return;
  }

  // Non-interactive or hybrid mode: CLI options provided
  // Validate provided options
  const validationErrors = validateCliOptions(providedValues);
  if (validationErrors.length > 0) {
    console.error(chalk.red('❌ Configuration Error:'));
    validationErrors.forEach(error => {
      console.error(chalk.red(`  • ${error}`));
    });
    process.exit(1);
  }

  // Check if all required values are provided for non-interactive mode
  // Non-interactive requires: domain, token, and either authType or email (for inference)
  const hasRequiredValues = Boolean(
    providedValues.domain &&
    providedValues.token &&
    (providedValues.authType || providedValues.email)
  );

  if (hasRequiredValues) {
    // Non-interactive mode: all required values provided
    try {
      // Infer authType if not provided
      let inferredAuthType = providedValues.authType;
      if (!inferredAuthType) {
        inferredAuthType = providedValues.email ? 'basic' : 'bearer';
      }

      const normalizedAuthType = normalizeAuthType(inferredAuthType, Boolean(providedValues.email));
      const normalizedDomain = providedValues.domain.trim();

      // Verify basic auth has email
      if (normalizedAuthType === 'basic' && !providedValues.email) {
        console.error(chalk.red('❌ Email is required for basic authentication'));
        process.exit(1);
      }

      // Verify API path format if provided
      if (providedValues.apiPath) {
        normalizeApiPath(providedValues.apiPath, normalizedDomain);
      }

      const configData = {
        domain: normalizedDomain,
        protocol: normalizeProtocol(providedValues.protocol),
        apiPath: providedValues.apiPath || inferApiPath(normalizedDomain),
        token: providedValues.token,
        authType: normalizedAuthType,
        email: providedValues.email
      };

      saveConfig(configData, profileName);
    } catch (error) {
      console.error(chalk.red(`❌ ${error.message}`));
      process.exit(1);
    }
    return;
  }

  // Hybrid mode: some values provided, prompt for the rest
  try {
    console.log(chalk.blue('🚀 Confluence CLI Configuration'));
    if (profileName) {
      console.log(`Profile: ${chalk.cyan(profileName)}`);
    }
    console.log('Completing configuration with interactive prompts:\n');

    const mergedValues = await promptForMissingValues(providedValues);

    // Normalize auth type
    mergedValues.authType = normalizeAuthType(mergedValues.authType, Boolean(mergedValues.email));

    saveConfig(mergedValues, profileName);
  } catch (error) {
    console.error(chalk.red(`❌ ${error.message}`));
    process.exit(1);
  }
}

function getConfig(profileName) {
  const envDomain = process.env.CONFLUENCE_DOMAIN || process.env.CONFLUENCE_HOST;
  const envToken = process.env.CONFLUENCE_API_TOKEN || process.env.CONFLUENCE_PASSWORD;
  const envEmail = process.env.CONFLUENCE_EMAIL || process.env.CONFLUENCE_USERNAME;
  const envAuthType = process.env.CONFLUENCE_AUTH_TYPE;
  const envApiPath = process.env.CONFLUENCE_API_PATH;
  const envProtocol = process.env.CONFLUENCE_PROTOCOL;

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
      console.error(chalk.red('❌ Basic authentication requires CONFLUENCE_EMAIL or CONFLUENCE_USERNAME.'));
      console.log(chalk.yellow('Set CONFLUENCE_EMAIL (or CONFLUENCE_USERNAME for on-premise) or switch to bearer auth by setting CONFLUENCE_AUTH_TYPE=bearer.'));
      process.exit(1);
    }

    return {
      domain: envDomain.trim(),
      protocol: normalizeProtocol(envProtocol),
      apiPath,
      token: envToken.trim(),
      email: envEmail ? envEmail.trim() : undefined,
      authType
    };
  }

  // Resolve profile: explicit param > CONFLUENCE_PROFILE env var > activeProfile > default
  const resolvedProfileName = profileName
    || process.env.CONFLUENCE_PROFILE
    || null;

  const fileData = readConfigFile();

  if (!fileData) {
    console.error(chalk.red('❌ No configuration found!'));
    console.log(chalk.yellow('Please run "confluence init" to set up your configuration.'));
    console.log(chalk.gray('Or set environment variables: CONFLUENCE_DOMAIN, CONFLUENCE_API_TOKEN (or CONFLUENCE_PASSWORD), CONFLUENCE_EMAIL (or CONFLUENCE_USERNAME), and optionally CONFLUENCE_API_PATH, CONFLUENCE_PROTOCOL.'));
    process.exit(1);
  }

  const targetProfile = resolvedProfileName || fileData.activeProfile || DEFAULT_PROFILE;
  const storedConfig = fileData.profiles && fileData.profiles[targetProfile];

  if (!storedConfig) {
    console.error(chalk.red(`❌ Profile "${targetProfile}" not found!`));
    const available = fileData.profiles ? Object.keys(fileData.profiles) : [];
    if (available.length > 0) {
      console.log(chalk.yellow(`Available profiles: ${available.join(', ')}`));
    }
    console.log(chalk.yellow('Run "confluence init --profile <name>" to create it, or "confluence profile list" to see available profiles.'));
    process.exit(1);
  }

  try {
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
      console.error(chalk.red('❌ Basic authentication requires an email address or username.'));
      console.log(chalk.yellow('Please rerun "confluence init" to add your Confluence email or username.'));
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
      protocol: normalizeProtocol(storedConfig.protocol),
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

function listProfiles() {
  const fileData = readConfigFile();
  if (!fileData || !fileData.profiles || Object.keys(fileData.profiles).length === 0) {
    return { activeProfile: null, profiles: [] };
  }
  return {
    activeProfile: fileData.activeProfile,
    profiles: Object.keys(fileData.profiles).map(name => ({
      name,
      active: name === fileData.activeProfile,
      domain: fileData.profiles[name].domain
    }))
  };
}

function setActiveProfile(profileName) {
  const fileData = readConfigFile();
  if (!fileData) {
    throw new Error('No configuration file found. Run "confluence init" first.');
  }
  if (!fileData.profiles || !fileData.profiles[profileName]) {
    const available = fileData.profiles ? Object.keys(fileData.profiles) : [];
    throw new Error(`Profile "${profileName}" not found. Available: ${available.join(', ')}`);
  }
  fileData.activeProfile = profileName;
  saveConfigFile(fileData);
}

function deleteProfile(profileName) {
  const fileData = readConfigFile();
  if (!fileData || !fileData.profiles || !fileData.profiles[profileName]) {
    throw new Error(`Profile "${profileName}" not found.`);
  }
  if (Object.keys(fileData.profiles).length === 1) {
    throw new Error('Cannot delete the only remaining profile.');
  }
  delete fileData.profiles[profileName];
  if (fileData.activeProfile === profileName) {
    fileData.activeProfile = Object.keys(fileData.profiles)[0];
  }
  saveConfigFile(fileData);
}

module.exports = {
  initConfig,
  getConfig,
  listProfiles,
  setActiveProfile,
  deleteProfile,
  isValidProfileName,
  CONFIG_DIR,
  CONFIG_FILE,
  DEFAULT_PROFILE
};
