# Implementation plan

Claude should complete these phases sequentially and commit after each stable phase.

## Phase 1 — foundation

- [x] Resolve current stable package versions from official sources.
- [x] Install dependencies.
- [x] Implement `src/types.ts` schemas/types.
- [x] Implement `src/config.ts` environment validation.
- [x] Add unit tests for config.
- [x] Ensure `npm run typecheck` works.

## Phase 2 — provider adapters

- [x] Implement OpenAI GPT Image 2 adapter.
- [x] Implement Cloudinary upload adapter.
- [x] Implement Buffer GraphQL client.
- [x] Normalize provider errors.
- [x] Add mocked adapter tests.

## Phase 3 — carousel pipeline

- [x] Implement ordered image-to-PDF creation.
- [x] Generate/extract a thumbnail.
- [x] Add deterministic filenames.
- [x] Add tests for page order and output metadata.

## Phase 4 — MCP server

- [x] Resolve current stable MCP TypeScript server SDK.
- [x] Register all tools listed in `CLAUDE.md`.
- [x] Add narrow Zod input schemas.
- [x] Keep tool results compact and machine-readable.
- [x] Add dry-run support.

## Phase 5 — Claude skill

- [x] Refine `skills/linkedin-auto-poster/SKILL.md`.
- [x] Ensure supporting reference files are read only as needed.
- [x] Verify plugin manifest and namespace.
- [ ] Test `/linkedin-content-engine:linkedin-auto-poster` locally. *(requires Claude Code on the local machine; run `./scripts/bootstrap.sh` first)*

## Phase 6 — Buffer safety

- [x] `save_buffer_draft` always uses draft mode.
- [x] `queue_buffer_post` rejects absent/false approval.
- [x] `schedule_buffer_post` rejects absent/false approval.
- [x] Support LinkedIn document assets (PDF + thumbnail + title).
- [x] Verify current Buffer assets schema before finalizing. *(implemented as a runtime gate: `verify_buffer_schema` blocks live writes on mismatch; live confirmation needs credentials)*

## Phase 7 — end-to-end validation

- [x] Run sample text-only dry-run.
- [x] Run sample carousel dry-run.
- [ ] With credentials, generate one test image. *(requires user credentials - see README "Going live")*
- [ ] Upload it to a test Cloudinary folder. *(requires user credentials)*
- [ ] Save one Buffer draft. *(requires user credentials; run `npm run verify:buffer` first)*
- [ ] Confirm nothing was published. *(user checks the Buffer dashboard)*
- [x] Document setup and troubleshooting.

Implementation completed 11 Aug 2026 on the `implementation` branch. Remaining unchecked items are the credential-gated live validation steps in the README runbook.
