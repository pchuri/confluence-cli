jest.mock('../lib/config', () => ({
  getConfig: jest.fn(),
  initConfig: jest.fn(),
  listProfiles: jest.fn(),
  setActiveProfile: jest.fn(),
  deleteProfile: jest.fn(),
  isValidProfileName: jest.fn(),
  getConfigDir: jest.fn(() => '/mock/conf'),
  getConfigFile: jest.fn(() => '/mock/conf/config.json'),
}));

jest.mock('../lib/confluence-client', () => {
  const ClientMock = jest.fn();
  ClientMock.createLocalConverter = jest.fn();
  return ClientMock;
});

const { getConfig } = require('../lib/config');
const ConfluenceClient = require('../lib/confluence-client');
const Analytics = require('../lib/analytics');

const { _test: { withClient, withLocal } } = require('../bin/confluence');

describe('withClient wrapper', () => {
  let trackSpy;
  let exitSpy;
  let errorSpy;

  beforeEach(() => {
    getConfig.mockReset();
    getConfig.mockReturnValue({
      readOnly: false,
      domain: 'example.test',
      token: 't',
      authType: 'bearer',
      apiPath: '/rest/api',
      protocol: 'https'
    });

    ConfluenceClient.mockClear();

    trackSpy = jest.spyOn(Analytics.prototype, 'track').mockImplementation(() => {});
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    trackSpy.mockRestore();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('invokes handler with { client, config, analytics } and forwards action args', async () => {
    const handler = jest.fn().mockResolvedValue();
    const action = withClient('read', handler);

    await action('PAGE-1', { format: 'text' });

    expect(handler).toHaveBeenCalledTimes(1);
    const [ctx, pageId, options] = handler.mock.calls[0];
    expect(ctx).toEqual(expect.objectContaining({
      client: expect.anything(),
      config: expect.objectContaining({ readOnly: false }),
      analytics: expect.anything(),
    }));
    expect(pageId).toBe('PAGE-1');
    expect(options).toEqual({ format: 'text' });
    expect(ConfluenceClient).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('writable: true on read-only profile exits with 1 without invoking handler', async () => {
    getConfig.mockReturnValue({ readOnly: true });
    const handler = jest.fn();
    const action = withClient('create', handler, { writable: true });

    await expect(action('title', 'KEY', {})).rejects.toThrow('process.exit called');
    expect(handler).not.toHaveBeenCalled();
    expect(ConfluenceClient).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('handler throw tracks failure, logs Error message, and exits 1', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    const action = withClient('search', handler);

    await expect(action('q', {})).rejects.toThrow('process.exit called');
    expect(trackSpy).toHaveBeenCalledWith('search', false);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error:'),
      'boom'
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('API response body is logged when no custom error handler is provided', async () => {
    const error = new Error('Request failed with status code 400');
    error.response = { data: { message: 'Storage body is invalid' } };
    const handler = jest.fn().mockRejectedValue(error);
    const action = withClient('create', handler, { writable: true });

    await expect(action('title', 'KEY', {})).rejects.toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('API response:'),
      JSON.stringify({ message: 'Storage body is invalid' }, null, 2)
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('onError receives error + forwarded action args and runs before exit', async () => {
    const onError = jest.fn();
    const handler = jest.fn().mockRejectedValue(new Error('api fail'));
    const action = withClient('comment_create', handler, { writable: true, onError });

    await expect(action('PAGE-1', { location: 'inline' })).rejects.toThrow('process.exit called');

    expect(onError).toHaveBeenCalledTimes(1);
    const [err, pageId, options] = onError.mock.calls[0];
    expect(err.message).toBe('api fail');
    expect(pageId).toBe('PAGE-1');
    expect(options).toEqual({ location: 'inline' });

    const onErrorOrder = onError.mock.invocationCallOrder[0];
    const exitOrder = exitSpy.mock.invocationCallOrder[0];
    expect(onErrorOrder).toBeLessThan(exitOrder);
  });

  test('onError throwing does not block process.exit', async () => {
    const onError = jest.fn(() => { throw new Error('hint crashed'); });
    const handler = jest.fn().mockRejectedValue(new Error('api fail'));
    const action = withClient('comment_create', handler, { onError });

    await expect(action('PAGE-1', {})).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('config loading failure is caught and reported as a failure track', async () => {
    getConfig.mockImplementation(() => { throw new Error('no config'); });
    const handler = jest.fn();
    const action = withClient('read', handler);

    await expect(action('PAGE-1', {})).rejects.toThrow('process.exit called');
    expect(handler).not.toHaveBeenCalled();
    expect(trackSpy).toHaveBeenCalledWith('read', false);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('withLocal wrapper', () => {
  let trackSpy;
  let exitSpy;
  let errorSpy;

  beforeEach(() => {
    trackSpy = jest.spyOn(Analytics.prototype, 'track').mockImplementation(() => {});
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    ConfluenceClient.mockClear();
  });

  afterEach(() => {
    trackSpy.mockRestore();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('invokes handler with { analytics } and forwards action args; never builds a client', async () => {
    const handler = jest.fn().mockResolvedValue();
    const action = withLocal('convert', handler);

    await action({ inputFormat: 'markdown' });

    expect(handler).toHaveBeenCalledTimes(1);
    const [ctx, options] = handler.mock.calls[0];
    expect(ctx).toEqual({ analytics: expect.anything() });
    expect(ctx.client).toBeUndefined();
    expect(ctx.config).toBeUndefined();
    expect(options).toEqual({ inputFormat: 'markdown' });
    expect(ConfluenceClient).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('handler throw tracks failure, logs Error message, and exits 1', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    const action = withLocal('convert', handler);

    await expect(action({})).rejects.toThrow('process.exit called');
    expect(trackSpy).toHaveBeenCalledWith('convert', false);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error:'),
      'boom'
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
