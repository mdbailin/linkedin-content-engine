# Prompt to give Claude Code

Copy the prompt below into Claude Code from the repository root.

---

Read `README.md`, `CLAUDE.md`, `ARCHITECTURE.md`, and `IMPLEMENTATION_PLAN.md` before changing code.

This repository is a scaffold reconstructed from the high-level architecture of a LinkedIn automation workflow. Your job is to turn it into a production-quality Claude Code plugin + local MCP server.

Important constraints:

- Keep the architecture: Claude skill for writing/orchestration; GPT Image 2 for visual generation; Cloudinary for creative storage; Buffer for drafts/queue/scheduling.
- Verify all current SDK/API details against official vendor documentation before implementing them. It is August 2026; do not rely on stale examples.
- Work through `IMPLEMENTATION_PLAN.md` sequentially.
- Use TypeScript and strict schemas.
- Do not put secrets in source files.
- The default Buffer action must be draft creation.
- Queue/schedule tools must reject calls unless `approved: true` is supplied.
- Do not automate LinkedIn directly with browser scraping or unofficial/private APIs.
- Add tests before attempting a live Buffer write.
- Preserve the plugin skill under `skills/linkedin-auto-poster/` and the namespace `linkedin-content-engine`.
- Keep MCP responses small; write generated images/files to disk and return paths/URLs.

Before coding, give me a short implementation assessment: current MCP package choice, current OpenAI image call, current Cloudinary upload method, current Buffer GraphQL mutations/assets schema, and any adjustments you need to make to this scaffold. Then implement Phase 1 and continue through the plan, pausing only if a credential or irreversible external action is required.

---
