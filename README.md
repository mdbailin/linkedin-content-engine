# LinkedIn Content Engine

A Claude Code plugin + local MCP server scaffold for producing branded LinkedIn posts and carousel documents, storing creative assets in Cloudinary, generating visuals with OpenAI GPT Image 2, and saving/queueing posts through Buffer.

This repository is intentionally structured as a **Claude handoff repo**: the architecture, interfaces, safety rules, schemas, prompts, and implementation tasks are defined so Claude Code can finish the production implementation without having to infer the system from a video.

## Target workflow

```text
User brief / content idea
        |
        v
Claude skill: linkedin-auto-poster
  - selects post type
  - writes LinkedIn copy
  - creates visual/carousel brief
  - requests approval before side effects
        |
        v
Local MCP server
  |-- OpenAI adapter ------> GPT Image 2 ------> generated PNG slides
  |-- PDF service ---------> carousel PDF
  |-- Cloudinary adapter --> hosted PNG/PDF/thumbnail URLs
  `-- Buffer adapter ------> draft / queue / scheduled LinkedIn post
```

## Design decisions

1. **Claude owns the writing.** The skill contains the writing workflow and brand/style references. The MCP server performs deterministic integration work and side effects.
2. **GPT Image 2 is used for visual generation**, not for post copy.
3. **Cloudinary is the creative asset store** for generated slides, PDFs, thumbnails, and other media.
4. **Buffer is the publishing queue/system of record** for multiple prepared posts.
5. **Human approval is mandatory before queueing or scheduling.** Generating drafts and assets is allowed; publication is not implicit.
6. **Adapters are replaceable.** OpenAI, Cloudinary, and Buffer are isolated behind small interfaces.
7. **Carousel output is a PDF document.** Slide images are assembled into a PDF, hosted, then attached to Buffer as a document asset.

## Repository layout

```text
.
├── .claude-plugin/plugin.json
├── CLAUDE.md
├── ARCHITECTURE.md
├── IMPLEMENTATION_PLAN.md
├── .env.example
├── package.json
├── tsconfig.json
├── skills/
│   └── linkedin-auto-poster/
│       ├── SKILL.md
│       └── reference/
│           ├── workflow.md
│           ├── writing-guide.md
│           ├── creative-guide.md
│           └── api-contracts.md
├── src/
│   ├── config.ts
│   ├── types.ts
│   ├── adapters/
│   │   ├── openai-image.ts
│   │   ├── cloudinary.ts
│   │   └── buffer.ts
│   ├── services/
│   │   ├── carousel.ts
│   │   └── orchestrator.ts
│   └── mcp/
│       └── server.ts
├── samples/
│   ├── brand-profile.example.json
│   └── post-brief.example.json
├── tests/
│   └── README.md
└── docs/
    └── CLAUDE_HANDOFF_PROMPT.md
```

## Quick handoff to Claude Code

1. Put this folder in a new Git repository.
2. Open the repository in Claude Code.
3. Start with `docs/CLAUDE_HANDOFF_PROMPT.md`.
4. Ask Claude to work through `IMPLEMENTATION_PLAN.md` in order.
5. Do not add real credentials until the validation/tests are in place.

Once implemented, test the plugin locally with Claude Code's plugin development mode and invoke the skill as:

```text
/linkedin-content-engine:linkedin-auto-poster
```

## Environment variables

Copy `.env.example` to `.env` and add secrets locally. `.env` must remain gitignored.

## External API status (verified 11 Aug 2026)

Verified against the official vendor SDK packages on npm:

- **OpenAI** — `openai@7.4.0`. `gpt-image-2` is a valid image model (snapshot `gpt-image-2-2026-04-21`). GPT image models always return base64; `gpt-image-2` supports arbitrary `WIDTHxHEIGHT` sizes (divisible by 16, aspect 1:3-3:1, max 3840x2160) and does **not** support transparent backgrounds. Reference imagery goes through `images.edit` (up to 16 images, `input_fidelity: "high"`).
- **Cloudinary** — `cloudinary@2.10.0`. Server-side signed uploads via `v2.uploader.upload`; images as `resource_type: "image"`, carousel PDFs as `resource_type: "raw"`.
- **MCP** — `@modelcontextprotocol/sdk@1.30.0` (`McpServer` + `registerTool`, stdio transport, zod v3.25+/v4 peer).
- **Buffer** — ⚠️ **assumed, not live-verified.** Buffer ships no official npm SDK and the GraphQL schema could not be introspected while implementing. Every document lives in `src/adapters/buffer-operations.ts`, and a read-only introspection gate (`verify_buffer_schema` tool / `npm run verify:buffer`) compares the live schema against the assumed contract **before the first live write** and feature-detects optional fields such as `isAiAssisted`. If it reports a mismatch, fix that one file.

Claude Code plugin conventions (`.claude-plugin/plugin.json`, `skills/<name>/SKILL.md`, `mcpServers` with `${CLAUDE_PLUGIN_ROOT}`) follow the current docs; if plugin loading ever changes, re-check https://docs.claude.com/en/docs/claude-code/overview.

## Setup

```bash
./scripts/bootstrap.sh        # copies .env.example -> .env, installs, builds dist/
npm test                      # 55 tests, all offline/mocked
npm run typecheck
npm run mcp                   # stdio MCP server (dev, via tsx)
```

The plugin manifest runs the built server: `node dist/mcp/server.js` — re-run `npm run build` after source changes.

With `DRY_RUN=true` (default) every tool runs end-to-end offline: creatives are placeholder PNGs at the exact requested size, uploads return `dry-run.invalid` URLs, Buffer receipts are simulated and marked `dryRun: true`.

## MCP tools

| Tool | Effect | Notes |
| --- | --- | --- |
| `read_brand_profile` | none | Validates `BRAND_PROFILE_PATH` |
| `new_workflow_id` | none | `YYYYMMDD-topic-rand4` + folder layout |
| `generate_creative` | writes local PNGs | GPT Image 2; paths only, never base64 |
| `build_carousel_pdf` | writes local PDF + thumbnail | Order-preserving; thumbnail = slide 1 |
| `upload_asset` | Cloudinary upload | `image` or `raw`; returns `secure_url` |
| `save_buffer_draft` | Buffer **draft** | The default write; cannot publish |
| `queue_buffer_post` | Buffer queue | **Requires `approved: true`** |
| `schedule_buffer_post` | Buffer schedule | **Requires `approved: true` + ISO `dueAt`** |
| `list_buffer_posts` | none | Read-only inventory |
| `verify_buffer_schema` | none | Read-only introspection gate |

## Safety model

- Draft is the only unapproved Buffer write; queue/schedule reject anything but literal `approved: true` at **both** the tool and adapter layers (tested).
- Live Buffer writes are blocked until introspection confirms the assumed schema (`BUFFER_SKIP_SCHEMA_CHECK=true` bypasses at your own risk).
- Only https asset URLs are accepted; secrets exist only in `.env`; provider errors are redacted before they reach logs or tool results.
- No LinkedIn browser automation or private LinkedIn endpoints — Buffer is the sole publishing path.

## Going live (runbook)

1. Fill `.env` (`DRY_RUN=false`) and copy `samples/brand-profile.example.json` to `brand-profile.json`.
2. `npm run verify:buffer` — read-only; must print `ok: true` before anything else. On mismatch, update `src/adapters/buffer-operations.ts` to the live schema and re-run.
3. Generate **one** test image (`generate_creative`), upload it to a test folder (`upload_asset`), and `save_buffer_draft` **one** post.
4. Confirm in the Buffer dashboard that it is a draft and nothing was published, then delete the test artifacts.
5. Only then use the skill for real batches; queue/schedule still require explicit approval per post.

## Troubleshooting

- **HTTP 404/401 from Buffer** — check `BUFFER_GRAPHQL_ENDPOINT` (the GraphQL path may differ from the default) and `BUFFER_API_KEY`.
- **`verify_buffer_schema` mismatch** — the live schema drifted from the assumed contract; every field name lives in `src/adapters/buffer-operations.ts`.
- **OpenAI 400 on size** — gpt-image-2 sizes must be divisible by 16, aspect 1:3-3:1, ≤3840x2160.
- **Plugin loads but tools missing** — run `npm install && npm run build`; the manifest points at `dist/mcp/server.js`.

## Non-goals

- Automating LinkedIn by browser scraping or private LinkedIn endpoints.
- Publishing without explicit user approval.
- Storing API secrets in repository files.
- Hard-coding Full Marks Education branding into application code; branding belongs in a configurable profile.

## License

MIT
