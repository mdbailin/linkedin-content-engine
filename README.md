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

## Current external API assumptions

These assumptions were checked against current vendor documentation when the scaffold was created (August 2026):

- OpenAI exposes `gpt-image-2` for image generation/editing.
- Cloudinary's Node SDK supports server-side uploads and raw-file storage.
- Buffer's API is GraphQL at `https://api.buffer.com` and supports LinkedIn, drafts, queue/scheduling modes, images, and document assets.
- Claude Code project/plugin skills use `SKILL.md`; plugin skills live under `skills/<name>/SKILL.md` and are namespaced by the plugin name.

Before production use, Claude should re-check vendor schemas and SDK package versions rather than assuming this scaffold's examples are frozen forever.

## Non-goals

- Automating LinkedIn by browser scraping or private LinkedIn endpoints.
- Publishing without explicit user approval.
- Storing API secrets in repository files.
- Hard-coding Full Marks Education branding into application code; branding belongs in a configurable profile.

## License

MIT
