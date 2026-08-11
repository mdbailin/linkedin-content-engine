---
name: linkedin-auto-poster
description: Draft, design, prepare, and optionally queue or schedule LinkedIn posts and carousel documents using the project's LinkedIn content workflow. Use when the user asks to create LinkedIn content, make a LinkedIn carousel, prepare multiple LinkedIn posts, save posts to Buffer, or schedule approved LinkedIn content.
---

# LinkedIn Auto Poster

Create LinkedIn content through a review-first workflow.

## Core rule

Never queue, schedule, or publish content unless the user has explicitly approved that publishing action in the current conversation. Saving a Buffer draft is allowed without publishing approval when requested.

## Workflow

1. Determine output type: text-only, single image, multi-image, or carousel PDF.
2. Read the active brand profile with the `read_brand_profile` MCP tool when available.
3. Draft the LinkedIn copy yourself. Do not ask the MCP server to write marketing copy.
4. For media posts, create a concise creative brief or slide-by-slide carousel plan.
5. Present copy + creative plan for review when the user has not already approved the exact content.
6. After content approval, generate media with `generate_creative` if needed.
7. For carousel posts, build the PDF with `build_carousel_pdf`.
8. Upload required media with `upload_asset`.
9. Default to `save_buffer_draft` if the user asks to store/send it to Buffer but has not explicitly instructed you to queue or schedule.
10. Use `queue_buffer_post` or `schedule_buffer_post` only after explicit approval and pass `approved: true`.
11. Return a compact receipt: workflow ID, Buffer ID/status, asset URLs, and schedule time if applicable.

## Batch content

For multiple posts, keep each post as an independent record with:
- topic
- copy status
- creative status
- Buffer status
- planned or scheduled date

Do not let approval of one post implicitly approve other posts.

## Writing standards

Read [reference/writing-guide.md](reference/writing-guide.md) when drafting or revising copy.

## Creative standards

Read [reference/creative-guide.md](reference/creative-guide.md) before generating images or carousel slides.

## Detailed flow

Read [reference/workflow.md](reference/workflow.md) for state transitions, approval behavior, and failure recovery.

## API/tool details

Read [reference/api-contracts.md](reference/api-contracts.md) only when you need provider/tool-specific details.
