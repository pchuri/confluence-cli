jest.mock('child_process', () => ({ spawnSync: jest.fn() }));

const { spawnSync } = require('child_process');

const ORIGINAL_PLATFORM = Object.getOwnPropertyDescriptor(process, 'platform');

function setPlatform(value) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

function loadKeychain() {
  jest.resetModules();
  jest.mock('child_process', () => ({ spawnSync: jest.fn() }));
  const cp = require('child_process');
  const keychain = require('../lib/keychain');
  return { keychain, spawnSync: cp.spawnSync };
}

describe('lib/keychain', () => {
  let savedFlag;

  beforeEach(() => {
    savedFlag = process.env.CONFLUENCE_KEYCHAIN;
    delete process.env.CONFLUENCE_KEYCHAIN;
    setPlatform('darwin');
    spawnSync.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', ORIGINAL_PLATFORM);
    if (savedFlag === undefined) delete process.env.CONFLUENCE_KEYCHAIN;
    else process.env.CONFLUENCE_KEYCHAIN = savedFlag;
  });

  describe('isKeychainSupported', () => {
    test('is true on darwin by default', () => {
      const { keychain } = loadKeychain();
      expect(keychain.isKeychainSupported()).toBe(true);
    });

    test('is false on other platforms', () => {
      const { keychain } = loadKeychain();
      for (const platform of ['linux', 'win32']) {
        expect(keychain.isKeychainSupported({ platform })).toBe(false);
      }
    });

    test.each(['0', 'false', 'off', 'no', ' OFF '])('is disabled by CONFLUENCE_KEYCHAIN=%j', (value) => {
      const { keychain } = loadKeychain();
      expect(keychain.isKeychainSupported({ env: { CONFLUENCE_KEYCHAIN: value } })).toBe(false);
    });
  });

  describe('item naming', () => {
    test('service is per host and account is the login or "bearer"', () => {
      const { keychain } = loadKeychain();
      expect(keychain.keychainService(' Wiki.Example.com ')).toBe('confluence-cli:wiki.example.com');
      expect(keychain.keychainAccount('me@example.com')).toBe('me@example.com');
      expect(keychain.keychainAccount(undefined)).toBe('bearer');
      expect(keychain.keychainAccount('  ')).toBe('bearer');
    });
  });

  describe('encoding', () => {
    test('round-trips arbitrary UTF-8 through the b64 prefix', () => {
      const { keychain } = loadKeychain();
      const token = ' 비밀번호 pass=/+\t';
      const encoded = keychain.encodeToken(token);
      expect(encoded.startsWith('b64:')).toBe(true);
      expect(/^[A-Za-z0-9+/=]+$/.test(encoded.slice(4))).toBe(true);
      expect(keychain.decodeToken(`${encoded}\n`)).toBe(token);
    });

    test('returns hand-written plain values unchanged', () => {
      const { keychain } = loadKeychain();
      expect(keychain.decodeToken('plain-token\n')).toBe('plain-token');
    });
  });

  describe('getKeychainToken', () => {
    test('does not call security off macOS', () => {
      setPlatform('linux');
      const { keychain, spawnSync: spawn } = loadKeychain();
      expect(keychain.getKeychainToken({ host: 'h.example.com' })).toEqual({ token: undefined, attempted: false });
      expect(spawn).not.toHaveBeenCalled();
    });

    test('does not call security when disabled by env', () => {
      process.env.CONFLUENCE_KEYCHAIN = 'off';
      const { keychain, spawnSync: spawn } = loadKeychain();
      expect(keychain.getKeychainToken({ host: 'h.example.com' })).toEqual({ token: undefined, attempted: false });
      expect(spawn).not.toHaveBeenCalled();
    });

    test('reads and decodes a stored token via find-generic-password -w', () => {
      const { keychain, spawnSync: spawn } = loadKeychain();
      spawn.mockReturnValue({ status: 0, stdout: `${keychain.encodeToken('tok-123')}\n`, stderr: '' });

      const result = keychain.getKeychainToken({ host: 'wiki.example.com', login: 'me@example.com' });

      expect(result).toEqual({ token: 'tok-123', attempted: true });
      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/security',
        ['find-generic-password', '-s', 'confluence-cli:wiki.example.com', '-a', 'me@example.com', '-w'],
        expect.objectContaining({ encoding: 'utf8', timeout: expect.any(Number) })
      );
    });

    test('uses the "bearer" account when no login is given', () => {
      const { keychain, spawnSync: spawn } = loadKeychain();
      spawn.mockReturnValue({ status: 0, stdout: 'pat\n', stderr: '' });
      expect(keychain.getKeychainToken({ host: 'wiki.example.com' }).token).toBe('pat');
      expect(spawn.mock.calls[0][1]).toEqual(['find-generic-password', '-s', 'confluence-cli:wiki.example.com', '-a', 'bearer', '-w']);
    });

    test('treats exit 44 / "could not be found" as absent without a warning', () => {
      const { keychain, spawnSync: spawn } = loadKeychain();
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      spawn.mockReturnValue({ status: 44, stdout: '', stderr: 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n' });

      expect(keychain.getKeychainToken({ host: 'wiki.example.com' })).toEqual({ token: undefined, attempted: true });
      expect(errSpy).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });

    test('warns and returns undefined on other failures', () => {
      const { keychain, spawnSync: spawn } = loadKeychain();
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      spawn.mockReturnValue({ status: 1, stdout: '', stderr: 'boom' });

      expect(keychain.getKeychainToken({ host: 'wiki.example.com' })).toEqual({ token: undefined, attempted: true });
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
      errSpy.mockRestore();
    });

    test('explains a locked keychain (exit 36) and falls through', () => {
      const { keychain, spawnSync: spawn } = loadKeychain();
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      spawn.mockReturnValue({ status: 36, stdout: '', stderr: 'security: SecKeychainSearchCopyNext: User interaction is not allowed.' });

      expect(keychain.getKeychainToken({ host: 'wiki.example.com' })).toEqual({ token: undefined, attempted: true });
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('CONFLUENCE_KEYCHAIN=off'));
      errSpy.mockRestore();
    });

    test('warns about a timeout (locked keychain) and falls through', () => {
      const { keychain, spawnSync: spawn } = loadKeychain();
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      spawn.mockReturnValue({ error: Object.assign(new Error('spawnSync timed out'), { code: 'ETIMEDOUT' }), status: null, stdout: '', stderr: '' });

      expect(keychain.getKeychainToken({ host: 'wiki.example.com' })).toEqual({ token: undefined, attempted: true });
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('timed out'));
      errSpy.mockRestore();
    });
  });

  describe('setKeychainToken', () => {
    test('feeds the whole command to `security -i` on stdin, never on argv, and verifies the write', () => {
      const { keychain, spawnSync: spawn } = loadKeychain();
      const encoded = keychain.encodeToken('secret token');
      spawn
        .mockReturnValueOnce({ status: 44, stdout: '', stderr: 'could not be found' }) // pre-check: no item yet
        .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // security -i add
        .mockReturnValueOnce({ status: 0, stdout: `${encoded}\n`, stderr: '' }); // read-back

      const outcome = keychain.setKeychainToken({ host: 'wiki.example.com', login: 'me@example.com', token: 'secret token' });
      expect(outcome).toEqual({ replaced: false });

      const [bin, args, opts] = spawn.mock.calls[1];
      expect(bin).toBe('/usr/bin/security');
      expect(args).toEqual(['-i']);
      expect(opts.input).toBe(
        'add-generic-password -s "confluence-cli:wiki.example.com" -a "me@example.com" '
        + `-l "Confluence CLI (wiki.example.com)" -U -w ${encoded}\n`
      );
      expect(opts.input).not.toContain('secret token');
      expect(spawn.mock.calls[2][1][0]).toBe('find-generic-password');
    });

    test('reports when an existing item with a different value was replaced', () => {
      const { keychain, spawnSync: spawn } = loadKeychain();
      const encoded = keychain.encodeToken('new');
      spawn
        .mockReturnValueOnce({ status: 0, stdout: 'b64:b2xk\n', stderr: '' }) // existing "old"
        .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
        .mockReturnValueOnce({ status: 0, stdout: `${encoded}\n`, stderr: '' });

      expect(keychain.setKeychainToken({ host: 'wiki.example.com', token: 'new' })).toEqual({ replaced: true });
    });

    test('quotes identifiers for the security tokenizer and rejects control characters', () => {
      const { keychain, spawnSync: spawn } = loadKeychain();
      expect(keychain.quoteForSecurity('a b')).toBe('"a b"');
      expect(keychain.quoteForSecurity('-dash')).toBe('"-dash"');
      expect(keychain.quoteForSecurity('q"uote\\back')).toBe('"q\\"uote\\\\back"');

      expect(() => keychain.setKeychainToken({ host: 'wiki.example.com\nfind-generic-password', token: 'x' }))
        .toThrow(/control characters/);
      expect(() => keychain.setKeychainToken({ host: 'wiki.example.com', login: 'me\r@x', token: 'x' }))
        .toThrow(/control characters/);
      expect(spawn).not.toHaveBeenCalled();
    });

    test('throws when the read-back value differs', () => {
      const { keychain, spawnSync: spawn } = loadKeychain();
      spawn
        .mockReturnValueOnce({ status: 44, stdout: '', stderr: 'could not be found' })
        .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
        .mockReturnValueOnce({ status: 0, stdout: 'b64:b3RoZXI=\n', stderr: '' });

      expect(() => keychain.setKeychainToken({ host: 'wiki.example.com', token: 'secret' }))
        .toThrow(/different value/);
    });

    test('throws when security fails', () => {
      const { keychain, spawnSync: spawn } = loadKeychain();
      spawn
        .mockReturnValueOnce({ status: 44, stdout: '', stderr: 'could not be found' })
        .mockReturnValueOnce({ status: 36, stdout: '', stderr: 'User interaction is not allowed.' });

      expect(() => keychain.setKeychainToken({ host: 'wiki.example.com', token: 'secret' }))
        .toThrow(/User interaction is not allowed/);
    });

    test('rejects use off macOS and empty input', () => {
      const { keychain } = loadKeychain();
      expect(() => keychain.setKeychainToken({ host: 'h', token: '' })).toThrow(/non-empty token/);
      expect(() => keychain.setKeychainToken({ token: 'x' })).toThrow(/host is required/);
      setPlatform('linux');
      expect(() => keychain.setKeychainToken({ host: 'h', token: 'x' })).toThrow(/only available on macOS/);
    });
  });

  describe('deleteKeychainToken', () => {
    test('returns true when deleted and false when absent', () => {
      const { keychain, spawnSync: spawn } = loadKeychain();
      spawn.mockReturnValueOnce({ status: 0, stdout: '', stderr: '' });
      expect(keychain.deleteKeychainToken({ host: 'wiki.example.com' })).toBe(true);
      expect(spawn.mock.calls[0][1]).toEqual(['delete-generic-password', '-s', 'confluence-cli:wiki.example.com', '-a', 'bearer']);

      spawn.mockReturnValueOnce({ status: 44, stdout: '', stderr: 'could not be found' });
      expect(keychain.deleteKeychainToken({ host: 'wiki.example.com' })).toBe(false);
    });

    test('is a no-op off macOS', () => {
      setPlatform('linux');
      const { keychain, spawnSync: spawn } = loadKeychain();
      expect(keychain.deleteKeychainToken({ host: 'wiki.example.com' })).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    });
  });
});
