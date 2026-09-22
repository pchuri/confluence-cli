// Keep the test suite away from the developer's real macOS Keychain: any test
// that resolves a profile without a stored token would otherwise spawn
// /usr/bin/security (and could hang on a locked keychain). Keychain-specific
// suites mock the module or clear this variable themselves.
process.env.CONFLUENCE_KEYCHAIN = 'off';
