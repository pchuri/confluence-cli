# Pi Read-Only Package Integration Design

> Historical note: the read-only boundary in this document is superseded by
> `2026-08-23-pi-protected-write-tools-design.md` for protected write support.

## Goal

Make a local checkout of `confluence-cli` installable with:

```bash
pi install /absolute/path/to/confluence-cli
```

The installation must load the existing `confluence` skill and register package-local, read-only Pi tools. It must not require `confluence-cli` to be globally installed or available on `PATH`.

This is a local-only experiment. It will not be pushed or proposed upstream.

## Scope

### Included

- Pi package metadata in `package.json`.
- Discovery of the existing skill at `plugins/confluence/skills/confluence/`.
- A Pi extension that runs the existing `bin/index.js` through the Node runtime bundled with the Pi process.
- Typed tools for only these operations:
  - `confluence_read`
  - `confluence_search`
  - `confluence_info`
  - `confluence_spaces`
  - `confluence_children`
  - `confluence_export`
  - `confluence_convert`
- Unit tests for the subprocess adapter and command policy.
- An isolated `pi install /local/path` smoke test.

### Excluded

- All server-mutating operations: create, create-child, update, move, delete, comments, property writes/deletes, attachment uploads/deletes, and version deletion/purge.
- The generic `confluence api` command.
- Publishing, forking, or opening an upstream pull request.
- Reimplementing Confluence HTTP client behavior in the extension.
- Changing the existing CLI command implementation.

## Package Layout

```text
confluence-cli/
├── package.json
├── .pi/extensions/confluence-cli.ts
├── lib/pi/read-only-runner.js
├── plugins/confluence/skills/confluence/SKILL.md
├── bin/index.js
└── tests/pi-read-only-runner.test.js
```

`package.json` will declare the existing skill location and the new extension with a `pi` manifest. It will add the Pi runtime packages used by the extension as peer dependencies. The existing `bin` mapping and Claude plugin manifest remain unchanged.

## Extension Architecture

`.pi/extensions/confluence-cli.ts` is a small Pi-facing adapter. It registers the typed tools and delegates command construction and process execution to `lib/pi/read-only-runner.js`.

The runner:

1. Resolves `bin/index.js` relative to the installed package root.
2. Invokes it with `process.execPath` and an argument array. It does not invoke a shell and does not resolve `confluence` from `PATH`.
3. Applies a fixed allowlist of read-only CLI subcommands.
4. Sets a process timeout and caps captured stdout and stderr.
5. Returns structured success or failure information without exposing credential values.

The extension must not accept arbitrary CLI strings or argument arrays from the model. Each registered tool maps its validated parameters to a predefined CLI argument layout.

## Tool Policy

The extension enforces its read-only policy independently of `CONFLUENCE_READ_ONLY`. The environment variable remains a defense-in-depth CLI safeguard, but a caller cannot bypass the extension policy by changing it.

| Tool | CLI command | Server effect | Local filesystem effect |
|---|---|---|---|
| `confluence_read` | `read` | Read | None |
| `confluence_search` | `search` | Read | None |
| `confluence_info` | `info` | Read | None |
| `confluence_spaces` | `spaces` | Read | None |
| `confluence_children` | `children` | Read | None |
| `confluence_export` | `export` | Read | Writes exported content beneath the project directory |
| `confluence_convert` | `convert` | None | May write output beneath the project directory |

`confluence_export` and `confluence_convert` require an explicit destination. The extension resolves the destination and rejects it unless it is inside Pi's current project directory. This prevents these read-only server operations from writing elsewhere on the host.

The extension does not register an `api` escape hatch because that command can perform arbitrary HTTP methods.

## Authentication and Server/DC Support

The extension forwards only the configuration required by the existing CLI:

- `CONFLUENCE_DOMAIN`
- `CONFLUENCE_API_PATH`
- `CONFLUENCE_AUTH_TYPE`
- `CONFLUENCE_EMAIL` when basic authentication is used
- `CONFLUENCE_API_TOKEN`
- `CONFLUENCE_PROFILE`
- `CONFLUENCE_READ_ONLY`
- `CONFLUENCE_FORCE_CLOUD`
- `CONFLUENCE_LINK_STYLE`
- `NETRC`

It does not write credentials to Pi settings, sessions, package configuration, command arguments, logs, or tool output. It fails with a generic configuration error when required authentication is missing.

For the Arcadyan instance, the intended configuration is Server/Data Center-style bearer authentication:

```bash
export CONFLUENCE_DOMAIN=confluence.example.com
export CONFLUENCE_API_PATH=/rest/api
export CONFLUENCE_AUTH_TYPE=bearer
export CONFLUENCE_API_TOKEN='<personal-access-token>'
export CONFLUENCE_READ_ONLY=true
```

No authenticated network test is automated. A manual `confluence_read` or `confluence_search` test is opt-in after local package installation.

## Content Safety and Errors

Confluence page content and search results are untrusted external data. Tool descriptions and results will state that retrieved content is untrusted and must not be treated as instructions.

Errors include command category, exit status, and bounded stderr, but never the process environment or token. Oversized output is truncated with an explicit marker. Timed-out processes are terminated and return a clear timeout error.

## Skill Changes

The existing `SKILL.md` remains the only command reference. Its installation section will be updated to distinguish:

- `pi install /path/to/confluence-cli` for package-local Pi tools; and
- `npm install -g confluence-cli` for standalone terminal use.

The skill will direct Pi agents to use the registered typed tools for supported read-only operations. It will state that write operations are unavailable through this Pi integration.

## Verification

1. Run the existing test suite: `npm test`.
2. Add Jest tests for allowlisting, command-to-argv mapping, project-root checks, output caps, timeout handling, and secret redaction.
3. Test the local converter through the runner; it requires no credentials or network connection.
4. Run `npm pack --dry-run` and confirm the Pi extension and skill are present in the package tarball.
5. With a temporary `PI_CODING_AGENT_DIR`, run `pi install /absolute/path/to/confluence-cli`.
6. Verify the package appears in `pi list`, that Pi discovers the skill and extension, and that a local `confluence_convert` operation succeeds.
7. Optionally configure the Arcadyan Server/DC variables and perform one read-only live request. No server mutation is permitted.

## Acceptance Criteria

- `pi install /local/path` completes successfully in an isolated Pi directory.
- Pi loads the `confluence` skill and the new extension from that package.
- Registered tools can invoke the package-local CLI when `confluence` is absent from `PATH`.
- No registered tool can issue a server write operation or call the generic API command.
- Export and convert outputs cannot escape the current project directory.
- Credentials never appear in tool output, errors, or persisted Pi configuration.
- Existing upstream tests continue to pass.
