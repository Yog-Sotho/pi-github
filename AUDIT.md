# Codebase Audit Report

Full audit of `pi-github` (2026-07-10). Findings are grouped by severity.
Every item listed here was fixed on branch `claude/pi-agent-audit-enhance-ao0aim` —
the **Fix** line describes what was done.

## A. Build-breaking defects (project did not compile)

### A1. Phantom dependencies
- `src/core/auth.ts` imported `p-retry` — not declared in `package.json`.
- `src/core/git.ts` imported `simple-git` — not declared in `package.json`.
- **Fix:** replaced `p-retry` with a small in-repo `withRetry()` helper (exponential
  backoff + jitter, abort on non-retryable errors). Removed `git.ts` entirely (see C3).

### A2. `InstanceType` imported from `@octokit/rest`
`tool-registry.ts`, `tools/repo.ts`, `tools/branche.ts`, `tools/files.ts`, `tools/pr.ts`
all did `import { InstanceType } from '@octokit/rest'`. `InstanceType` is a TypeScript
built-in utility type; it is not an export of Octokit. Compile error in five files.
- **Fix:** export a concrete `OctokitClient` type from `core/auth.ts` and use it everywhere.

### A3. `RetryOctokit` imported but never exported
The same five files imported `RetryOctokit` from `core/auth.ts`, which never exported it.
- **Fix:** `core/auth.ts` now exports the plugin-enhanced constructor and the
  `OctokitClient` instance type.

### A4. Misnamed module: `src/tools/branche.ts`
`tool-registry.ts` imported `../tools/branch`, but the file on disk was `branche.ts`.
Module-not-found at compile time.
- **Fix:** renamed to `src/tools/branch.ts`.

### A5. Missing `.js` extensions under NodeNext resolution
`tsconfig.json` uses `"moduleResolution": "NodeNext"`, which requires explicit `.js`
extensions on relative ESM imports. `tool-registry.ts` and all of `src/tools/*` used
extensionless imports.
- **Fix:** all relative imports now carry `.js` extensions.

### A6. `tool-registry.ts` disagreed with the schema
- Handled a tool named `'commit'`; the schema defines `'commit_files'`.
- Accessed `request.args.branch.name` — the schema declares `branch` as a `string`.
- Ran `gitOps.checkout(branch, true)` against a *local* temp repo before making a
  *remote* API call, which was pointless.
- **Fix:** the file was a broken duplicate of `core/registry.ts`; deleted. The single
  dispatch path is now `AgentBridge` delegating to the `src/tools/*` modules.

### A7. ESLint configuration could not run
`eslint.config.mjs` imported the `typescript-eslint` meta-package, but `package.json`
declared only ESLint 8 with the legacy `@typescript-eslint/parser` / `eslint-plugin`
pair. Flat `tseslint.config()` needs ESLint 9 + `typescript-eslint`.
- **Fix:** upgraded to ESLint 9 + `typescript-eslint`, kept flat config.

## B. Runtime & logic bugs

### B1. Request-ID correlation was broken (protocol contract violation)
`cli.ts` called `bridge.execute(req.tool, req.args, …)` — dropping `req.id`. The bridge
then invented a fresh ID (`args.id || crypto.randomUUID()`), so every streamed response
carried an ID the client never sent. For an NDJSON RPC protocol whose whole point is
multiplexed correlation, this made responses un-matchable.
- **Fix:** `execute()` now takes the request ID explicitly; the CLI passes `req.id`
  through, and all stream frames echo it.

### B2. Logs corrupted the stdout protocol stream
`pino-pretty` transport (any non-production env) writes to **stdout** by default. The
CLI speaks NDJSON on stdout, so any log line interleaved garbage into the protocol
stream. The README's "telemetry" claim made this worse, not better.
- **Fix:** logger now always writes to **stderr** (`destination: 2` for both pretty and
  JSON modes). stdout is reserved exclusively for protocol frames.

### B3. `tools/files.ts` read a nonexistent field
`repoRes.data.head.sha` — the `repos.get` response has no `head` property. Committing to
the default branch always crashed with `TypeError: Cannot read properties of undefined`.
- **Fix:** resolve the branch head via `repos.getBranch` unconditionally.

### B4. Path-prefix check allowed sibling-directory escape
`SecuritySandbox.validatePath()` used `resolved.startsWith(this.workspaceRoot)`. With a
workspace of `/tmp/work`, the path `/tmp/work-evil/x` passes the check. Same flaw in the
symlink branch.
- **Fix:** boundary-aware comparison (`root === p || p.startsWith(root + path.sep)`).

### B5. `git.ts` existence check was always false-y… actually always truthy
`const exists = await fs.access(p).catch(() => false)` — `fs.access` resolves
`undefined` on success, so `exists` was never truthy and `git init` ran every time.
- **Fix:** file deleted (dead code, phantom dependency — see C3).

### B6. Declared `encoding` on committed files was ignored
The `commit_files` schema accepts `encoding: 'base64'`, but the tree items always sent
`content` as UTF-8 text, so base64 payloads were committed as literal base64 strings.
- **Fix:** base64 files are uploaded via `git.createBlob` with `encoding: 'base64'` and
  referenced by SHA in the tree.

### B7. Raw request args spread into Octokit calls
`getRepo`/`createBranch`/`createPR`/`getFileContent` spread the full args object
(including `id`, `source`, `branch`, …) into REST calls, leaking protocol fields as
query parameters.
- **Fix:** every tool now passes an explicit, minimal parameter object.

### B8. Programmatic API bypassed validation entirely
`AgentBridge.execute()` cast unvalidated input `as ToolRequest` — despite the README's
"Schema Enforcement: every input is validated" claim, only the CLI validated. Library
consumers hit the network with arbitrary args.
- **Fix:** `execute()` validates `{tool, args}` against the zod schema before dispatch.

### B9. NDJSON parser: multibyte + memory-safety issues
- `chunk.toString()` on a `Buffer` can split a multibyte UTF-8 character across chunks,
  corrupting JSON at chunk boundaries.
- The line buffer grew without bound — a single unterminated line could exhaust memory
  ("<50MB constant footprint" claim was false).
- Parse failures were logged but the requester was never told.
- **Fix:** `StringDecoder` for chunk decoding; 10 MiB max-line guard; malformed lines
  emit a structured `parse_error` event that the CLI turns into an error frame.

### B10. Concurrent, interleaved request execution in the CLI
The async `parser.on('data', …)` handler ran requests concurrently, interleaving stream
frames of different requests *and* losing ordering guarantees. Also: no non-zero exit on
stream errors, and `rawReq.id` was echoed without type-checking.
- **Fix:** requests are queued and executed sequentially; invalid `id` values are
  normalized; parser errors produce protocol error frames.

### B11. Circuit breaker misconfiguration
A single 30 s opossum timeout applied to every tool — large diffs or tree commits can
legitimately exceed it, and a burst of validation errors could open the breaker and
block all traffic. Raw `'Breaker is open'` / `'Timed out'` errors leaked to clients.
- **Fix:** timeout raised & made configurable, validation failures no longer route
  through the breaker, breaker errors mapped to clear protocol errors.

### B12. `console.warn` in library code
`auth.ts` used `console.warn` for throttle warnings — inconsistent with pino and a
violation of the repo's own `no-console` lint rule.
- **Fix:** routed through the shared stderr logger.

## C. Dead code & repo hygiene

### C1. Two parallel, divergent execution paths
`core/registry.ts` (used) and `core/tool-registry.ts` + `src/tools/*` (dead, broken)
implemented the same tools twice with different behavior.
- **Fix:** consolidated — `AgentBridge` is the only dispatcher and delegates to
  `src/tools/*` implementations.

### C2. Stray files
`src/tools/test` (empty), `tree.txt` (stale listing referencing the old package name).
- **Fix:** deleted.

### C3. `core/git.ts` unused
No live code path referenced `GitOperations`; it depended on the undeclared
`simple-git` and contained bug B5. The README's "Sandboxed Git Operations" story is
implemented by `SecuritySandbox` temp dirs, not by this class.
- **Fix:** deleted.

### C4. Packaging problems
- No lockfile, no `.gitignore`, no `LICENSE` despite `"license": "MIT"`, no CI workflow
  despite a CI badge in the README.
- `package.json` name `pi-github-agent` vs README instructing `npm install pi-github`.
- Unused deps: `uuid`/`@types/uuid` (Node 20 has `crypto.randomUUID`), `msw` pinned but
  fine, `pino-pretty` in `dependencies` though only useful for dev.
- **Fix:** added `.gitignore`, `LICENSE` (MIT), CI workflow, lockfile; unified naming;
  pruned unused dependencies.

## D. Test-suite defects

### D1. `tool-protocol.test.ts` failed against its own schema
- `create_branch` case passed `branch: { name: … }` (an object) and asserted success —
  the schema requires a string, so the test failed.
- Every case omitted the required `id` field, so even the `list_repos` "success" case
  failed validation.
- The "rejects directory traversal" case used tool name `'commit'`, which isn't in the
  discriminated union — the test passed vacuously without exercising the path check.
- **Fix:** tests rewritten against the real schema; the traversal case now targets
  `commit_files` and asserts the actual refinement.

### D2. Lint-breaking unused imports
`vi`, `beforeEach` imported and unused in test files.
- **Fix:** removed; suite expanded (protocol parser, sandbox, retry, CLI correlation).

### D3. Unrealistic coverage gate
85 % line-coverage threshold with dead modules and failing tests meant
`npm run test:coverage` (and therefore `prepublishOnly`) could never pass.
- **Fix:** dead code removed and tests added; thresholds now enforced and met.

## E. Documentation drift (README)

False or unverifiable claims corrected: "cryptographic path validation" (it's
`realpath`-based, not cryptographic), `rimraf` (uses `fs.rm`), "GraphQL optimization"
(REST only), "100% test coverage", `undici` connection pooling, badge URLs pointing at
`yourusername`, install instructions naming a different package. The README now
describes what the code actually does, including the Pi extension integration.
