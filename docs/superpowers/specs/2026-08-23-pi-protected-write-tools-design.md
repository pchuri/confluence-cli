# Pi Protected Confluence Write Tools Design

## Goal

Extend the local `confluence-cli` Pi package with typed Confluence mutation tools while preserving a strict, fail-closed authorization boundary. Write tools are disabled by default, restricted to explicitly allowed spaces, require interactive human confirmation, and never expose arbitrary CLI arguments or the generic `confluence api` command.

This design supersedes the write exclusions in `docs/superpowers/specs/2026-08-22-pi-read-only-package-design.md`. The existing read-only tools and package-local CLI architecture remain supported.

## Scope

### Included

- Existing read-only tools:
  - `confluence_read`
  - `confluence_search`
  - `confluence_info`
  - `confluence_spaces`
  - `confluence_children`
  - `confluence_export`
  - `confluence_convert`
- Additional companion read tools:
  - `confluence_find`
  - `confluence_versions`
  - `confluence_comments`
  - `confluence_attachments`
  - `confluence_property_list`
  - `confluence_property_get`
- Typed mutation tools for every server-mutating command currently implemented by the CLI:
  - `confluence_create`
  - `confluence_create_child`
  - `confluence_update`
  - `confluence_move`
  - `confluence_delete`
  - `confluence_copy_tree_preview`
  - `confluence_copy_tree`
  - `confluence_comment_create`
  - `confluence_comment_delete`
  - `confluence_property_set`
  - `confluence_property_delete`
  - `confluence_attachment_upload`
  - `confluence_attachment_delete`
  - `confluence_version_delete`
  - `confluence_versions_purge_preview`
  - `confluence_versions_purge`
- Package-local subprocess execution through `process.execPath` and `bin/index.js`.
- Environment opt-in, mandatory space allowlisting, payload limits, preflight checks, interactive confirmations, and expiring bulk approvals.
- Unit, integration, packaging, and isolated Pi installation tests.
- README and bundled skill documentation.

### Excluded

- `confluence api` and every arbitrary endpoint, HTTP method, argv, or shell escape hatch.
- Profile management, `init`, credential persistence, and other local CLI configuration commands.
- Direct Confluence HTTP implementation inside the extension.
- Automatic rollback of partial Confluence mutations.
- Automated authenticated writes to a real Confluence instance.
- Non-interactive or headless write authorization.

The CLI `edit` command is not exposed as a mutation tool because it reads server content and optionally writes a local file; equivalent safe behavior is already available through project-contained read/export operations.

## Architecture

The extension continues to invoke the package-local CLI. It does not resolve a global `confluence` executable and does not invoke a shell.

### Components

#### `lib/pi/operation-policy.js`

A declarative registry is the sole source of allowed operations. Each entry defines:

- Pi tool name and CLI operation;
- read, write, destructive, or bulk risk classification;
- typed input-to-argv construction;
- canonical page, parent, destination, or owning-page targets;
- preflight requirements;
- local path and payload rules;
- confirmation summary and exact destructive phrase;
- operation timeout.

An operation missing from the registry cannot execute. `api` is explicitly tested as permanently absent.

#### `lib/pi/command-runner.js`

The generic package-local subprocess runner owns:

- `process.execPath` plus package-relative `bin/index.js` execution;
- fixed argument arrays and `shell: false`;
- a minimal forwarded environment;
- abort-signal propagation and child termination;
- policy-specific timeouts;
- combined stdout/stderr byte limits;
- credential redaction;
- structured JSON invocation for preflight and mutations.

Internal preflight output must be complete, non-truncated valid JSON. Parse failure blocks authorization.

#### `lib/pi/write-authorization.js`

The authorization layer owns:

- write opt-in parsing;
- mandatory space allowlist parsing and matching;
- `CONFLUENCE_READ_ONLY` defense-in-depth checks;
- UI availability checks;
- page-title-aware confirmation messages;
- yes/no confirmation for non-destructive writes;
- exact text confirmation for destructive writes;
- payload-limit validation and file snapshot revalidation.

Model input can never contain an authorization or confirmation flag. Consent is accepted only from Pi's `ctx.ui` methods.

#### `lib/pi/preflight.js`

The preflight coordinator invokes only registry-approved read commands and returns normalized target records containing canonical IDs, titles, space keys, ownership facts, affected counts, and snapshot fingerprints. It owns operation-specific target resolution, paginated comment and attachment ownership checks, property/version existence checks, and page-title-aware confirmation summaries. Any incomplete, malformed, truncated, missing, ambiguous, or inaccessible result fails closed.

#### `lib/pi/preflight-store.js`

An in-memory store issues cryptographically random, opaque approval IDs for bulk previews. Every record binds:

- operation name;
- normalized input fingerprint;
- canonical source and destination identifiers;
- space keys;
- affected target count;
- target snapshot fingerprint;
- creation and expiry time.

Approvals expire after five minutes, are consumed before mutation execution, are single-use, and disappear when the extension reloads or Pi exits.

#### `.pi/extensions/confluence-cli.ts`

The extension defines TypeBox schemas, conditionally registers write tools, coordinates Pi UI prompts, and renders tool results. It delegates command construction, preflight, authorization, and process execution to the focused CommonJS modules.

## Registration and Configuration

Read tools are always registered. Write and bulk-preview tools are registered only when both conditions are satisfied at extension load time:

```bash
CONFLUENCE_PI_WRITES=true
CONFLUENCE_PI_WRITE_SPACES=SPACE1,SPACE2
```

Space keys are comma-separated, trimmed, normalized case-insensitively, deduplicated, and must contain at least one non-empty key. Wildcards are not accepted.

Changing either variable requires `/reload` or restarting Pi. Every write rechecks both variables immediately before authorization and immediately before spawning the mutation. This prevents a tool registered under an earlier environment from bypassing a later restriction.

The Pi authorization layer treats `1`, `true`, `yes`, and `on` case-insensitively as enabled values for `CONFLUENCE_READ_ONLY` and blocks every write even if write tools were registered. This is intentionally stricter than the existing CLI parser, which recognizes the exact lowercase string `true`. The variable may be unset or explicitly false when writes are enabled. Existing CLI profile-level read-only mode remains an independent safeguard.

The intended Server/Data Center configuration is:

```bash
export CONFLUENCE_DOMAIN=confluence.example.com
export CONFLUENCE_API_PATH=/rest/api
export CONFLUENCE_AUTH_TYPE=bearer
export CONFLUENCE_API_TOKEN='<personal-access-token>'
export CONFLUENCE_READ_ONLY=false
export CONFLUENCE_PI_WRITES=true
export CONFLUENCE_PI_WRITE_SPACES='SAFE1,SAFE2'
```

Credentials and approval IDs are not persisted by the extension.

## Tool Inputs

### Structured text and files

Page bodies, comments, and property values may be supplied inline or through project-contained files. Inputs that support both enforce exactly one source. Create/update schemas preserve the CLI's supported content formats. Folder creation rejects body input in the same cases as the CLI.

Property values accept typed JSON values inline or a project-contained JSON file. Inline values are serialized once for byte-limit checks and CLI argv construction.

### Attachments

Attachment upload accepts one or more files. Every file must:

- exist and be a regular file;
- resolve canonically beneath Pi's current project root;
- satisfy per-file and aggregate size limits;
- retain the same canonical path, size, modification metadata, and content fingerprint between confirmation and execution.

### Filesystem containment

Lexical path checks are insufficient because project-local symlinks can point outside the project. Input paths use `realpath`. Output paths resolve the nearest existing ancestor canonically and reject any ancestor outside the project. The same containment policy applies to existing export, conversion, and attachment-download destinations.

## Payload Limits

Defaults are:

```bash
CONFLUENCE_PI_MAX_BODY_BYTES=1048576
CONFLUENCE_PI_MAX_PROPERTY_BYTES=262144
CONFLUENCE_PI_MAX_ATTACHMENT_FILES=10
CONFLUENCE_PI_MAX_ATTACHMENT_FILE_BYTES=26214400
CONFLUENCE_PI_MAX_ATTACHMENT_TOTAL_BYTES=104857600
```

Limits are parsed as positive base-10 integers. Invalid, zero, negative, non-integer, or unsafe integer values fail closed. Limits are checked before confirmation and rechecked before execution. Configured values may tighten or relax defaults but do not bypass project containment or confirmation.

## Preflight and Space Enforcement

Every mutation performs a read-only preflight before prompting.

- Create resolves and displays the destination space.
- Create-child resolves the parent page title, canonical ID, and space.
- Update/delete resolve the target page title, canonical ID, and space.
- Move resolves the source and destination parent titles, IDs, and spaces; both spaces must be allowed.
- Copy-tree resolves source and destination targets; both spaces must be allowed.
- Comment creation resolves its owning page. Comment deletion additionally requires `pageId` in the Pi schema and verifies that the comment belongs to that page.
- Property operations resolve the owning page; delete verifies that the key exists.
- Attachment operations resolve the owning page; delete verifies that the attachment belongs to it.
- Version operations resolve the owning page and verify version state; the current version cannot be deleted.

Paged CLI reads are used when verifying comment or attachment ownership. A missing target, truncated response, malformed JSON, ambiguous ownership, unsupported Server/DC behavior, or inaccessible target blocks the write.

Every source, destination, parent, and owning page must belong to `CONFLUENCE_PI_WRITE_SPACES`. A PAT's broader server permissions do not expand this extension allowlist.

## Human Confirmation

### Page-title hints

Every prompt displays canonical page titles alongside IDs. Examples:

```text
Update "Release Notes" (ID: 12345, SPACE: ENG)?
```

```text
Move "Deployment Guide" (ID: 12345, SPACE: ENG)
to "Operations Runbooks" (ID: 67890, SPACE: OPS)?
```

Comment, property, attachment, and version prompts display the owning page title, ID, and space. Creation prompts display the destination space or parent title and ID.

### Non-destructive mutations

Create, create-child, update, move, comment creation, property setting, and attachment upload use `ctx.ui.confirm`. The prompt includes target identity, operation summary, body or file byte counts, attachment names and sizes, and any overwrite/replace behavior. Full body content is not duplicated into the confirmation dialog.

A false response, closed dialog, unavailable UI, timeout, or abort returns a structured cancellation and never spawns the mutation.

### Destructive mutations

Delete operations use `ctx.ui.input` and require an exact case-sensitive phrase derived only from canonical preflight data. Examples include:

```text
DELETE PAGE 12345
DELETE COMMENT 678 FROM 12345
DELETE ATTACHMENT 678 FROM 12345
DELETE PROPERTY key FROM 12345
DELETE VERSION 4 FROM 12345
PURGE 12 VERSIONS FROM 12345
```

The dialog shows the page title and ID before requesting the phrase. The extension passes the CLI's `--yes` flag only after this Pi-owned confirmation succeeds, preventing the subprocess from attempting a second terminal prompt.

## Bulk Preview and Approval

### Copy tree

`confluence_copy_tree_preview` invokes the CLI's dry-run mode, canonicalizes source and destination data, captures the planned root title and affected count, and returns an approval ID.

`confluence_copy_tree` requires that approval ID. It verifies normalized inputs and target snapshot, consumes the approval, displays source and destination page names and the affected count, and requires an exact phrase before running without `--dry-run`.

### Version purge

`confluence_versions_purge_preview` lists versions, identifies the current version, computes the historical versions to remove, and returns an approval ID.

`confluence_versions_purge` requires that approval ID. It revalidates the current-version snapshot, consumes the approval, displays the owning page title and historical count, and requires the exact purge phrase before invoking the CLI with `--yes`.

A stale, mismatched, expired, reused, or reloaded approval is rejected with instructions to preview again. A consumed approval remains consumed even if the subprocess fails.

## Process and Content Safety

Confluence results remain untrusted external data, including responses returned after writes. Tool descriptions and output continue to state that returned content must not be treated as instructions.

The runner forwards only required Confluence configuration, platform home/config lookup values, and non-secret output settings. Credential-bearing values are redacted from stdout, stderr, spawn errors, timeout errors, and validation diagnostics. Neither environment dumps nor raw argv containing credentials are returned.

Ordinary operations retain short bounded timeouts; uploads and bulk operations receive explicit longer policy timeouts. Output remains byte-capped. Abort signals terminate subprocesses. A truncated mutation response is reported as an unknown-result failure because the server may already have applied the operation.

## Failure Semantics

Authorization and validation failures occur before mutation spawn. User cancellation is not reported as a successful write.

Confluence mutations are not transactionally reversible, so the extension does not attempt rollback. Bulk results report completed and failed targets. Partial failure consumes the approval and requires a new preview before retrying. Errors distinguish:

- configuration or registration failure;
- local validation failure;
- preflight or allowlist failure;
- user cancellation;
- stale approval;
- subprocess timeout or abort;
- CLI/server failure;
- unknown result caused by truncated or interrupted mutation output.

## Testing Strategy

Automated tests use fake package-local entry points and mocked Pi UI. They never issue authenticated writes.

### Policy and registration

- Exact read, preview, and mutation tool inventories.
- Permanent exclusion of `confluence_api`, arbitrary argv, and configuration commands.
- Conditional write registration for valid environment opt-in and non-empty allowlist.
- Rejection after environment or read-only state changes.

### Argument and input validation

- Fixed argv for every exposed operation.
- Inline/file mutual exclusion and supported format enums.
- Default and configured payload limits.
- Project containment for lexical traversal, absolute paths, symlink escapes, and output ancestors.
- File snapshot changes between confirmation and execution.

### Preflight and allowlisting

- Canonical page title and ID resolution for every confirmation.
- Source, parent, destination, and owning-space enforcement.
- Comment and attachment ownership verification across paginated results.
- Property and version existence checks.
- Fail-closed malformed, truncated, missing, ambiguous, and inaccessible targets.

### Confirmation

- Yes/no approval and cancellation.
- Exact destructive phrase matching.
- Missing UI and aborted prompts.
- Proof that model tool parameters cannot represent consent.
- Proof that no mutation subprocess starts before confirmation.

### Bulk approvals

- Preview token creation and normalized input binding.
- Target snapshot binding.
- Five-minute expiry.
- Single-use consumption and replay rejection.
- Reload invalidation.
- Partial failure requiring a new preview.

### Runner and package verification

- Package-local execution with no global `confluence` on `PATH`.
- Abort termination, policy timeouts, output bounds, JSON parsing, and credential redaction.
- Full existing Jest suite and ESLint.
- `npm pack --dry-run` resource verification.
- Isolated `PI_CODING_AGENT_DIR` local-path installation and extension registration smoke tests.

No live Arcadyan mutation is part of automated verification. A manual mutation requires a separate explicit request naming an allowlisted test space and disposable target.

## Documentation

`README.md` and `plugins/confluence/skills/confluence/SKILL.md` will document:

- disabled-by-default writes;
- environment opt-in and mandatory space allowlist;
- `/reload` after registration-setting changes;
- companion reads and all typed mutation tools;
- payload-limit variables;
- page-title-aware confirmations and destructive phrases;
- mandatory bulk previews and approval expiry;
- permanent generic API exclusion;
- project-path and non-interactive restrictions;
- untrusted Confluence response handling.

The historical read-only design remains in the repository and is identified as superseded for write-scope decisions.

## Acceptance Criteria

- Without valid write opt-in and a non-empty space allowlist, Pi registers no write or bulk-preview tools.
- With valid opt-in, Pi registers exactly the documented typed operations and never registers arbitrary API access.
- Every mutation is blocked in non-interactive contexts and until Pi UI confirmation succeeds.
- Every confirmation displays canonical page names with IDs; destructive operations require exact typed phrases.
- Every mutation target, parent, source, destination, and owning page is confined to an explicitly allowed Confluence space.
- Copy-tree and version purge cannot execute without a fresh matching, one-use preview approval.
- Inline and file payloads obey configured limits, and local paths cannot escape through traversal or symlinks.
- The package-local CLI executes without a global `confluence` executable.
- Credentials do not appear in output, errors, persisted Pi configuration, or approval records.
- Existing read-only behavior and the upstream test suite remain green.
