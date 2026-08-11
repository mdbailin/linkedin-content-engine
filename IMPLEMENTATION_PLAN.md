# Implementation plan

Claude should complete these phases sequentially and commit after each stable phase.

## Phase 1 — foundation

- [ ] Resolve current stable package versions from official sources.
- [ ] Install dependencies.
- [ ] Implement `src/types.ts` schemas/types.
- [ ] Implement `src/config.ts` environment validation.
- [ ] Add unit tests for config.
- [ ] Ensure `npm run typecheck` works.

## Phase 2 — provider adapters

- [ ] Implement OpenAI GPT Image 2 adapter.
- [ ] Implement Cloudinary upload adapter.
- [ ] Implement Buffer GraphQL client.
- [ ] Normalize provider errors.
- [ ] Add mocked adapter tests.

## Phase 3 — carousel pipeline

- [ ] Implement ordered image-to-PDF creation.
- [ ] Generate/extract a thumbnail.
- [ ] Add deterministic filenames.
- [ ] Add tests for page order and output metadata.

## Phase 4 — MCP server

- [ ] Resolve current stable MCP TypeScript server SDK.
- [ ] Register all tools listed in `CLAUDE.md`.
- [ ] Add narrow Zod input schemas.
- [ ] Keep tool results compact and machine-readable.
- [ ] Add dry-run support.

## Phase 5 — Claude skill

- [ ] Refine `skills/linkedin-auto-poster/SKILL.md`.
- [ ] Ensure supporting reference files are read only as needed.
- [ ] Verify plugin manifest and namespace.
- [ ] Test `/linkedin-content-engine:linkedin-auto-poster` locally.

## Phase 6 — Buffer safety

- [ ] `save_buffer_draft` always uses draft mode.
- [ ] `queue_buffer_post` rejects absent/false approval.
- [ ] `schedule_buffer_post` rejects absent/false approval.
- [ ] Support LinkedIn document assets (PDF + thumbnail + title).
- [ ] Verify current Buffer assets schema before finalizing.

## Phase 7 — end-to-end validation

- [ ] Run sample text-only dry-run.
- [ ] Run sample carousel dry-run.
- [ ] With credentials, generate one test image.
- [ ] Upload it to a test Cloudinary folder.
- [ ] Save one Buffer draft.
- [ ] Confirm nothing was published.
- [ ] Document setup and troubleshooting.
