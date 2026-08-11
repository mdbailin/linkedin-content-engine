---
name: linkedin-auto-poster
description: Draft, design, prepare, and optionally queue or schedule LinkedIn posts and carousel documents using the project's LinkedIn content workflow. Use when the user asks to create LinkedIn content, write a LinkedIn post, make a LinkedIn carousel, prepare multiple LinkedIn posts, save posts to Buffer, or schedule approved LinkedIn content.
---

# LinkedIn Auto Poster

Create LinkedIn content through a review-first workflow. You write the copy; the
`linkedin-content-engine` MCP server handles credentialed side effects (image
generation, hosting, Buffer).

## Core rule

Never queue, schedule, or publish content unless the user has explicitly
approved that publishing action for that specific post in the current
conversation. Saving a Buffer **draft** is allowed without publishing approval.
Only `queue_buffer_post` and `schedule_buffer_post` publish, and both require
`approved: true` — pass it only after explicit approval (see
[reference/workflow.md](reference/workflow.md) for what counts). "Put it in
Buffer" or "save it" means **draft**.

## Tool inventory (MCP server: linkedin-content-engine)

- `read_brand_profile` — load brand voice/colors/CTA defaults. Read first.
- `new_workflow_id` — one per post; returns the ID plus local/Cloudinary folder layout.
- `generate_creative` — GPT Image 2 → PNG files on disk (paths only). Default slide size 1200x1504 (portrait 4:5-ish); heroes 1536x800 or 1536x1024. Pass brand `referenceAssetUrls` when the profile provides them.
- `build_carousel_pdf` — ordered slide paths → PDF + thumbnail (slide 1). Local only.
- `upload_asset` — local file → Cloudinary https URL. Folder `<workflowId>/slides|carousel|single`; tag with the workflowId.
- `save_buffer_draft` — the DEFAULT Buffer write. Never publishes.
- `queue_buffer_post` / `schedule_buffer_post` — publishing actions; require `approved: true` (schedule also needs ISO `dueAt`).
- `list_buffer_posts` — read-only inventory.
- `verify_buffer_schema` — read-only introspection; run once before the first live Buffer write of a session if credentials are configured.

If `DRY_RUN=true` (the default until credentials are configured), every tool
runs end-to-end with placeholder images and simulated receipts marked
`dryRun: true` — say so in your summary instead of implying anything was
generated or saved for real.

## Workflow

1. Determine output type: text-only, single image, multi-image, or carousel PDF.
2. `read_brand_profile`; ask only for information that is actually missing.
3. Draft the LinkedIn copy yourself, following [reference/writing-guide.md](reference/writing-guide.md). Never ask the MCP server to write marketing copy.
4. For media posts, write a creative brief (or slide-by-slide plan) per [reference/creative-guide.md](reference/creative-guide.md).
5. Present copy + creative plan for review unless the user already approved the exact content.
6. After content approval: `new_workflow_id`, then `generate_creative` (one call per slide when text fidelity matters, `category: "slides"`, `baseName` like `01-cover`). Inspect/describe results honestly; regenerate any slide with rendering errors.
7. Carousel: `build_carousel_pdf` with the slide paths in exact display order.
8. `upload_asset` for every file Buffer needs: slides/heroes as `image`, the PDF as `document`, the thumbnail as `image`.
9. Buffer write:
   - Default: `save_buffer_draft` with the text and assets — images as `{kind:"image",url}`, a carousel as ONE `{kind:"document", url: <pdf secureUrl>, thumbnailUrl: <thumbnail secureUrl>, title}`.
   - Only with explicit publishing approval: `queue_buffer_post` or `schedule_buffer_post` with `approved: true`.
10. Finish with a compact receipt per post:
    `workflowId · Buffer id/status · asset URLs · scheduled time (if any) · dryRun flag`.

## Batch content

Track each post independently (topic, copy status, creative status, Buffer
status, planned date). Approval of one post never approves another. On partial
failure, report per-post status and follow the recovery rules in
[reference/workflow.md](reference/workflow.md); never roll surviving drafts
into a publishing action.

## References

- [reference/workflow.md](reference/workflow.md) — states, approval semantics, failure recovery.
- [reference/writing-guide.md](reference/writing-guide.md) — copy standards. Read when drafting.
- [reference/creative-guide.md](reference/creative-guide.md) — slide briefs and consistency. Read before generating media.
- [reference/api-contracts.md](reference/api-contracts.md) — provider details, only when needed.
