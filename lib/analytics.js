const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * Simple anonymous usage analytics
 * Helps understand which features are most used
 */
class Analytics {
  constructor() {
    this.enabled = process.env.CONFLUENCE_CLI_ANALYTICS !== 'false';
    this.configDir = path.join(os.homedir(), '.confluence-cli');
    this.statsFile = path.join(this.configDir, 'stats.json');
  }

  /**
   * Track command usage (anonymous)
   */
  track(command, success = true) {
    if (!this.enabled) return;

    try {
      let stats = {};
      
      // Read existing stats
      if (fs.existsSync(this.statsFile)) {
        stats = JSON.parse(fs.readFileSync(this.statsFile, 'utf8'));
      }

      // Initialize stats structure
      if (!stats.commands) stats.commands = {};
      if (!stats.firstUsed) stats.firstUsed = new Date().toISOString();
      stats.lastUsed = new Date().toISOString();

      // Track command usage
      const commandKey = `${command}_${success ? 'success' : 'error'}`;
      stats.commands[commandKey] = (stats.commands[commandKey] || 0) + 1;

      // Create directory if it doesn't exist
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }

      // Save stats
      fs.writeFileSync(this.statsFile, JSON.stringify(stats, null, 2));
    } catch (error) {
      // Silently fail - analytics should never break the main functionality
    }
  }

  /**
   * Get usage statistics
   */
  getStats() {
    if (!fs.existsSync(this.statsFile)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(this.statsFile, 'utf8'));
    } catch (error) {
      return null;
    }
  }

  /**
   * Show usage stats to user
   */
  showStats() {
    const stats = this.getStats();
    if (!stats) {
      console.log('No usage statistics available.');
      return;
    }

    console.log('📊 Usage Statistics:');
    console.log(`First used: ${new Date(stats.firstUsed).toLocaleDateString()}`);
    console.log(`Last used: ${new Date(stats.lastUsed).toLocaleDateString()}`);
    console.log('\nCommand usage:');
    
    Object.entries(stats.commands).forEach(([command, count]) => {
      console.log(`  ${command}: ${count} times`);
    });
  }
}

module.exports = Analytics;
