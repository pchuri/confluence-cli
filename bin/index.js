#!/usr/bin/env node

/**
 * confluence-cli
 * A powerful command-line interface for Atlassian Confluence
 * 
 * @author Your Name
 * @license MIT
 */

'use strict';

// Make sure we're using a supported Node.js version
const nodeVersion = process.version;
const requiredVersion = '14.0.0';

if (!nodeVersion.startsWith('v') || 
    parseInt(nodeVersion.slice(1).split('.')[0]) < parseInt(requiredVersion.split('.')[0])) {
  console.error(`Error: Node.js ${requiredVersion} or higher is required. You are using ${nodeVersion}.`);
  process.exit(1);
}

// Load the main CLI application
require('./confluence.js');
