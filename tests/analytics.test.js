const fs = require('fs');
const os = require('os');
const path = require('path');

const ORIGINAL_ANALYTICS_ENV = process.env.CONFLUENCE_CLI_ANALYTICS;

const removeDirRecursive = (dir) => {
  if (!dir || !fs.existsSync(dir)) return;
  if (fs.rmSync) {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }
  fs.readdirSync(dir).forEach((entry) => {
    const entryPath = path.join(dir, entry);
    if (fs.lstatSync(entryPath).isDirectory()) {
      removeDirRecursive(entryPath);
    } else {
      fs.unlinkSync(entryPath);
    }
  });
  fs.rmdirSync(dir);
};

describe('Analytics', () => {
  let tempHome;
  let originalHomedir;
  let Analytics;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-cli-analytics-'));
    originalHomedir = os.homedir;
    os.homedir = () => tempHome;

    delete process.env.CONFLUENCE_CLI_ANALYTICS;

    jest.resetModules();
    Analytics = require('../lib/analytics');
  });

  afterEach(() => {
    os.homedir = originalHomedir;
    removeDirRecursive(tempHome);

    if (ORIGINAL_ANALYTICS_ENV === undefined) {
      delete process.env.CONFLUENCE_CLI_ANALYTICS;
    } else {
      process.env.CONFLUENCE_CLI_ANALYTICS = ORIGINAL_ANALYTICS_ENV;
    }
  });

  describe('track', () => {
    test('creates the stats directory and file on first run', () => {
      const analytics = new Analytics();
      const expectedFile = path.join(tempHome, '.confluence-cli', 'stats.json');

      analytics.track('create-page');

      expect(fs.existsSync(expectedFile)).toBe(true);
      const stats = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
      expect(stats.commands['create-page_success']).toBe(1);
      expect(stats.firstUsed).toBeDefined();
      expect(stats.lastUsed).toBeDefined();
    });

    test('increments the counter for repeated commands', () => {
      const analytics = new Analytics();

      analytics.track('search');
      analytics.track('search');
      analytics.track('search');

      expect(analytics.getStats().commands['search_success']).toBe(3);
    });

    test('separates success and error counters for the same command', () => {
      const analytics = new Analytics();

      analytics.track('update-page', true);
      analytics.track('update-page', false);
      analytics.track('update-page', false);

      const stats = analytics.getStats();
      expect(stats.commands['update-page_success']).toBe(1);
      expect(stats.commands['update-page_error']).toBe(2);
    });

    test('preserves firstUsed across writes but advances lastUsed', () => {
      const analytics = new Analytics();

      analytics.track('first');
      const after1 = analytics.getStats();

      // Force lastUsed to differ
      const earlier = new Date(Date.now() - 60_000).toISOString();
      const file = path.join(tempHome, '.confluence-cli', 'stats.json');
      const tampered = { ...after1, firstUsed: earlier, lastUsed: earlier };
      fs.writeFileSync(file, JSON.stringify(tampered));

      analytics.track('second');
      const after2 = analytics.getStats();

      expect(after2.firstUsed).toBe(earlier);
      expect(new Date(after2.lastUsed).getTime()).toBeGreaterThan(new Date(earlier).getTime());
    });

    test('does nothing when CONFLUENCE_CLI_ANALYTICS=false', () => {
      process.env.CONFLUENCE_CLI_ANALYTICS = 'false';
      jest.resetModules();
      const DisabledAnalytics = require('../lib/analytics');
      const analytics = new DisabledAnalytics();

      analytics.track('search');

      expect(fs.existsSync(path.join(tempHome, '.confluence-cli', 'stats.json'))).toBe(false);
    });

    test('does not throw when the stats file is corrupted JSON', () => {
      const dir = path.join(tempHome, '.confluence-cli');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'stats.json'), '{not valid json');

      const analytics = new Analytics();

      expect(() => analytics.track('search')).not.toThrow();
    });
  });

  describe('getStats', () => {
    test('returns null when the stats file does not exist', () => {
      const analytics = new Analytics();
      expect(analytics.getStats()).toBeNull();
    });

    test('returns null when the stats file contains malformed JSON', () => {
      const dir = path.join(tempHome, '.confluence-cli');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'stats.json'), '{broken');

      const analytics = new Analytics();
      expect(analytics.getStats()).toBeNull();
    });

    test('returns parsed stats when the file is valid', () => {
      const analytics = new Analytics();
      analytics.track('list-pages');

      const stats = analytics.getStats();
      expect(stats).not.toBeNull();
      expect(stats.commands['list-pages_success']).toBe(1);
    });
  });

  describe('showStats', () => {
    test('prints "No usage statistics available." when no stats exist', () => {
      const analytics = new Analytics();
      const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

      analytics.showStats();

      expect(spy).toHaveBeenCalledWith('No usage statistics available.');
      spy.mockRestore();
    });

    test('prints command counts when stats exist', () => {
      const analytics = new Analytics();
      analytics.track('search');
      analytics.track('search', false);

      const messages = [];
      const spy = jest.spyOn(console, 'log').mockImplementation((msg) => messages.push(msg));

      analytics.showStats();
      spy.mockRestore();

      const joined = messages.join('\n');
      expect(joined).toContain('search_success: 1 times');
      expect(joined).toContain('search_error: 1 times');
    });
  });
});
