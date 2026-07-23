const fs = require('fs');
const { spawnSync } = require('child_process');
const chalk = require('chalk');
const ConfluenceClient = require('../../lib/confluence-client');
const { getConfig } = require('../../lib/config');
const Analytics = require('../../lib/analytics');
const { emitJsonError } = require('../../lib/output');

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function trackAndExit(analytics, code) {
  analytics.track('api', false);
  process.exit(code);
}

function registerApiCommand(program, { getProfileName, readStdin }) {
  program
    .command('api <endpoint>')
    .description('Make an authenticated API request (like gh api)')
    .option('-X, --method <method>', 'HTTP method (default: GET, auto-POST when body provided)')
    .option('-f, --field <key=value>', 'Add a request field (repeatable)', (v, a) => { a.push(v); return a; }, [])
    .option('-H, --header <key:value>', 'Add a request header (repeatable)', (v, a) => { a.push(v); return a; }, [])
    .option('--input <file>', 'Read body from file (use - for stdin)')
    .option('--jq <expression>', 'Filter response with jq')
    .option('-i, --include', 'Include response status and headers')
    .option('--silent', 'Suppress success output (errors still go to stderr)')
    .addHelpText('after', `
Endpoint resolution:
  - Relative path (no leading slash) → resolved against the configured apiPath.
  - Absolute path (leading "/")      → bypasses apiPath; resolved against the host.
    On Confluence Cloud, apiPath is typically /wiki/rest/api, so absolute
    endpoints must include the /wiki prefix (e.g. /wiki/rest/api/content/123).
  - Full URL (https://...)           → used as-is, but only when same-origin
    with the configured host. A cross-origin URL (or an http:// downgrade of an
    https host) is refused so credentials are not leaked to another server.
`)
    .action(async (endpoint, options) => {
      const analytics = new Analytics();
      // When the global --json flag is active, failures emit a single structured
      // JSON object on stderr instead of prose (agents/scripts can then parse
      // errors). Non-JSON output stays byte-identical.
      const jsonMode = Boolean(program.opts().json);
      try {
        const config = getConfig(getProfileName(), { throwOnError: jsonMode });
        const client = new ConfluenceClient(config);

        const fields = {};
        for (const raw of options.field) {
          const idx = raw.indexOf('=');
          if (idx === -1) {
            const message = `Invalid field "${raw}". Must be key=value.`;
            if (jsonMode) emitJsonError(null, { message, code: 'VALIDATION' });
            else console.error(chalk.red(`Error: ${message}`));
            trackAndExit(analytics, 1);
          }
          fields[raw.slice(0, idx)] = raw.slice(idx + 1);
        }

        const extraHeaders = {};
        for (const raw of options.header) {
          const idx = raw.indexOf(':');
          if (idx === -1) {
            const message = `Invalid header "${raw}". Must be key:value.`;
            if (jsonMode) emitJsonError(null, { message, code: 'VALIDATION' });
            else console.error(chalk.red(`Error: ${message}`));
            trackAndExit(analytics, 1);
          }
          extraHeaders[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
        }

        const hasFields = Object.keys(fields).length > 0;
        let body;
        if (options.input) {
          const raw = options.input === '-'
            ? await readStdin()
            : fs.readFileSync(options.input, 'utf-8');
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
        }

        const hasBody = hasFields || body !== undefined;
        const method = (options.method || (hasBody ? 'POST' : 'GET')).toUpperCase();

        if (config.readOnly && WRITE_METHODS.includes(method)) {
          if (jsonMode) {
            emitJsonError(null, {
              message: 'This profile is in read-only mode. Write operations are not allowed.',
              code: 'VALIDATION',
            });
          } else {
            console.error(chalk.red('Error: This profile is in read-only mode. Write operations are not allowed.'));
            console.error(chalk.yellow('Tip: Use "confluence profile add <name>" without --read-only, or set readOnly to false in config.'));
          }
          trackAndExit(analytics, 1);
        }

        const reqOpts = { headers: extraHeaders };
        if (method === 'GET' || method === 'HEAD') {
          if (hasFields) reqOpts.params = fields;
        } else if (body !== undefined && hasFields) {
          reqOpts.data = typeof body === 'object' && body !== null ? { ...body, ...fields } : fields;
        } else if (hasFields) {
          reqOpts.data = fields;
        } else if (body !== undefined) {
          reqOpts.data = body;
        }

        const result = await client.rawRequest(method, endpoint, reqOpts);

        if (options.silent) {
          analytics.track('api', true);
          return;
        }

        let output = '';
        if (options.include) {
          output += `HTTP ${result.status}\n`;
          for (const [key, value] of Object.entries(result.headers)) {
            output += `${key}: ${value}\n`;
          }
          output += '\n';
        }

        const bodyStr = typeof result.data === 'string'
          ? result.data
          : JSON.stringify(result.data, null, 2);

        if (options.jq) {
          const r = spawnSync('jq', [options.jq], {
            input: bodyStr,
            encoding: 'utf-8',
          });
          if (r.error) {
            const message = r.error.code === 'ENOENT'
              ? 'jq is not installed (--jq requires jq in PATH).'
              : `jq failed: ${r.error.message}`;
            if (jsonMode) emitJsonError(null, { message, code: 'VALIDATION' });
            else if (r.error.code === 'ENOENT') console.error(chalk.red(`Error: ${message}`));
            else console.error(chalk.red('Error: jq failed:'), r.error.message);
            trackAndExit(analytics, 2);
          }
          if (r.status !== 0) {
            const stderr = (r.stderr || '').toString().trim();
            const message = `jq exited with status ${r.status}${stderr ? `\n${stderr}` : ''}`;
            if (jsonMode) emitJsonError(null, { message, code: 'VALIDATION' });
            else console.error(chalk.red(`Error: ${message}`));
            trackAndExit(analytics, 2);
          }
          output += r.stdout;
        } else {
          output += bodyStr;
        }

        process.stdout.write(output);
        if (!output.endsWith('\n')) {
          process.stdout.write('\n');
        }
        analytics.track('api', true);
      } catch (error) {
        analytics.track('api', false);
        if (jsonMode) {
          emitJsonError(error);
        } else if (error.response) {
          const errBody = error.response.data;
          const errStr = typeof errBody === 'string' ? errBody : JSON.stringify(errBody, null, 2);
          process.stderr.write(errStr + '\n');
        } else {
          console.error(chalk.red('Error:'), error.message);
        }
        process.exit(1);
      }
    });
}

module.exports = registerApiCommand;
