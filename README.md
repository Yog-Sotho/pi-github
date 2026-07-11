<div align="center">
  <h1>pi-github</h1>
  <p><strong>Streaming NDJSON GitHub tool bridge for AI coding agents.</strong></p>
  <p>
    <a href="https://www.npmjs.com/package/pi-github-agent"><img src="https://img.shields.io/npm/v/pi-github-agent" alt="npm"></a>
    <a href="https://github.com/Yog-Sotho/pi-github/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Yog-Sotho/pi-github/ci.yml?branch=main" alt="CI"></a>
    <img src="https://img.shields.io/badge/TypeScript-Strict-blue" alt="TypeScript">
    <img src="https://img.shields.io/badge/Node-%3E=20.0.0-brightgreen" alt="Node">
    <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
  </p>
</div>

## What it is

`pi-github` is a small, typed bridge between LLM coding agents and the GitHub API. It speaks **NDJSON (newline-delimited JSON)** over `stdin`/`stdout`, validates every request against strict [zod](https://zod.dev) schemas before touching the network, and ships a ready-made [Pi coding agent](https://github.com/badlogic/pi-mono) extension that registers all of its tools natively.

```text
┌──────────────────┐        NDJSON frames        ┌───────────────────────┐
│  AI Coding Agent │ <─────────────────────────> │      pi-github        │
│ (Pi/Claude/etc.) │    (stdin/stdout stream)    │                       │
└──────────────────┘                             │  ┌─────────────────┐  │
                                                 │  │ Protocol layer  │  │
                                                 │  │ (NDJSON parser) │  │
                                                 │  └────────┬────────┘  │
                                                 │  ┌────────▼────────┐  │
                                                 │  │ Zod validation  │  │
                                                 │  └────────┬────────┘  │
                                                 │  ┌────────▼────────┐  │
                                                 │  │  Octokit core   │  │
                                                 │  │ (retry/breaker) │  │
                                                 │  └─────────────────┘  │
                                                 └───────────────────────┘
```

## Installation

> Published on npm as **`pi-github-agent`** (the unscoped name `pi-github` is taken by an unrelated package). The installed CLI binary is still `pi-github`.

```bash
npm install pi-github-agent        # library + CLI
npm install -g pi-github-agent     # CLI on PATH (needed for the Pi extension)
```

## Configuration

Set a GitHub token (classic PAT with `repo` scope, or a fine-grained token with contents + pull-requests permissions):

```bash
export GITHUB_TOKEN="ghp_..."
```

## Usage

### 1. Pi coding agent extension

`extensions/pi-github.ts` registers every tool below as a native Pi tool, discovered dynamically from the CLI's manifest:

```bash
npm install -g pi-github-agent
cp "$(npm root -g)/pi-github-agent/extensions/pi-github.ts" ~/.pi/agent/extensions/
# or project-local: cp ... .pi/extensions/
```

Reload Pi (`/reload`) and the model can call `github_list_repos`, `github_create_pr`, etc. New tools added to the CLI appear automatically — the extension reads the manifest at session start.

### 2. NDJSON streaming protocol

Each request is one JSON line on stdin; each response is one or more frames on stdout. The `id` you send is echoed on **every** frame for correlation. Logs go to stderr only — stdout carries protocol frames exclusively.

```bash
echo '{"id":"req_1","tool":"get_file_content","args":{"owner":"vercel","repo":"next.js","path":"package.json","ref":"main"}}' \
  | pi-github stream
```

```json
{"id":"req_1","type":"log","level":"info","msg":"Executing tool: get_file_content"}
{"id":"req_1","type":"result","data":{"path":"package.json","size":4521,"content":"{...}","sha":"..."}}
```

Frame types: `log`, `chunk`, `result`, `error`. Payloads larger than 256 KiB are streamed as sequential `chunk` frames (`seq` starts at 0) and the final `result` carries `{chunked: true, field, chunks, bytes}` for reassembly. Requests are processed sequentially, so frames of different requests never interleave.

### 3. One-shot execution

```bash
pi-github exec get_repo '{"owner":"octocat","repo":"hello-world"}'
```

### 4. Tool discovery

```bash
pi-github tools   # JSON manifest: name, description, streaming flag, JSON Schema parameters
```

### 5. Programmatic API

```typescript
import { AgentBridge } from 'pi-github-agent';

const bridge = new AgentBridge({ token: process.env.GITHUB_TOKEN! });

const result = await bridge.execute(
  'get_diff',
  { owner: 'facebook', repo: 'react', base: 'main', head: 'canary' },
  (frame) => {
    if (frame.type === 'chunk') process.stdout.write(String(frame.data));
  },
  'my-request-id',
);
```

Every call — CLI or programmatic — is validated against the same zod schemas before any network request is made.

## Tools

| Tool | Description | Streaming |
| :--- | :--- | :---: |
| `list_repos` | List the authenticated user's repositories. | ❌ |
| `get_repo` | Fetch repository metadata. | ❌ |
| `get_file_content` | Fetch decoded file content at a ref (large files chunked). | ✅ |
| `get_diff` | Unified diff between two refs (large diffs chunked). | ✅ |
| `create_branch` | Create a branch from a source branch. | ❌ |
| `commit_files` | Commit multiple files atomically via the Git Trees API (UTF-8 or base64). | ❌ |
| `create_pr` | Open a pull request. | ❌ |
| `search_code` | Search code with GitHub search syntax. | ✅ |
| `list_issues` | List issues/PRs filtered by state. | ✅ |

## Security model

1. **Schema enforcement** — every input is validated with zod before execution; commit paths reject `..` traversal segments.
2. **Path sandbox** — `SecuritySandbox` resolves paths against a workspace root with boundary-aware prefix checks and `realpath`-based symlink-escape detection.
3. **No credential leakage** — the pino logger redacts tokens/authorization headers and writes exclusively to stderr, so credentials can never corrupt or leak into the protocol stream.
4. **Isolated temp dirs** — created with `0700` permissions and wiped with `fs.rm` when destroyed.

## Resilience

- **Circuit breaker** ([opossum](https://github.com/nodeshift/opossum)): opens after 50% failures, 30s reset, configurable per-request timeout (default 120s). Breaker states are reported as typed protocol errors (`CIRCUIT_OPEN`, `TIMEOUT`).
- **Retries with full jitter**: exponential backoff for transient failures; auth/not-found/validation errors abort immediately.
- **Rate-limit handling**: octokit throttling plugin honors primary and secondary rate limits (bounded retries).
- **Bounded memory**: the NDJSON parser enforces a 10 MiB line cap and decodes multibyte UTF-8 correctly across chunk boundaries.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint (flat config, typescript-eslint)
npm test            # vitest (msw-mocked GitHub API)
npm run test:coverage
npm run build       # emits dist/
```

See [AUDIT.md](AUDIT.md) for the full audit that preceded the v2.1 rewrite.

## License

MIT © YogSotho
