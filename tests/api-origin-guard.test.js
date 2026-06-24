const http = require('http');
const ConfluenceClient = require('../lib/confluence-client');

// Spin up a throwaway HTTP server that records every request it receives,
// so we can assert whether credentials reached a given origin.
function startServer() {
  const received = [];
  const server = http.createServer((req, res) => {
    received.push({
      url: req.url,
      authorization: req.headers['authorization'] || null,
      cookie: req.headers['cookie'] || null,
    });
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end('{}');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, received });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

describe('rawRequest cross-origin credential guard', () => {
  let configured;
  let attacker;

  beforeEach(async () => {
    configured = await startServer();
    attacker = await startServer();
  });

  afterEach(async () => {
    await closeServer(configured.server);
    await closeServer(attacker.server);
  });

  function makeClient(overrides = {}) {
    return new ConfluenceClient({
      domain: `127.0.0.1:${configured.port}`,
      protocol: 'http',
      apiPath: '/rest/api',
      authType: 'basic',
      email: 'victim@example.com',
      token: 'SUPER_SECRET_TOKEN',
      ...overrides,
    });
  }

  test('allows a same-origin absolute URL and sends the auth header', async () => {
    const client = makeClient();
    const res = await client.rawRequest('GET', `http://127.0.0.1:${configured.port}/rest/api/content/1`);
    expect(res.status).toBe(200);
    expect(configured.received).toHaveLength(1);
    expect(configured.received[0].authorization).toMatch(/^Basic /);
  });

  test('refuses a cross-origin absolute URL and does NOT leak the auth header', async () => {
    const client = makeClient();
    await expect(
      client.rawRequest('GET', `http://127.0.0.1:${attacker.port}/exfil`)
    ).rejects.toThrow(/does not match the configured Confluence origin/);
    // The foreign host must have received nothing — the token was not leaked.
    expect(attacker.received).toHaveLength(0);
  });

  test('refuses an http downgrade against an https-configured client', async () => {
    const client = makeClient({ protocol: 'https' });
    await expect(
      client.rawRequest('GET', `http://127.0.0.1:${configured.port}/rest/api/content/1`)
    ).rejects.toThrow(/does not match the configured Confluence origin/);
    // No request reached the server over the downgraded scheme.
    expect(configured.received).toHaveLength(0);
  });

  test('still resolves relative endpoints against the configured host', async () => {
    const client = makeClient();
    const res = await client.rawRequest('GET', 'content/1');
    expect(res.status).toBe(200);
    expect(configured.received).toHaveLength(1);
    expect(configured.received[0].authorization).toMatch(/^Basic /);
  });
});
