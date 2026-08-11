# Claude implementation brief

You are implementing a production-quality Claude Code plugin and local MCP server called **LinkedIn Content Engine**.

## Goal

Turn a user's content idea into a polished LinkedIn text post or carousel workflow:

1. Claude writes the post using the bundled skill and brand profile.
2. Claude prepares an image/carousel creative brief.
3. The MCP server generates images using OpenAI GPT Image 2.
4. Generated assets are uploaded to Cloudinary.
5. Carousel slide images are assembled into a PDF when needed.
6. The PDF and thumbnail are uploaded to Cloudinary.
7. Buffer stores the prepared post as a draft by default.
8. Only after explicit user approval may the system add the post to the Buffer queue or schedule a custom publication time.

## Architecture constraints

- TypeScript / Node.js.
- Keep API providers behind adapters.
- MCP tools must have narrow, typed schemas.
- Do not let the MCP layer author marketing copy. Claude/the skill is the copywriter.
- Separate pure planning functions from side-effect functions.
- Prefer explicit return values containing IDs, URLs, status, and provider error details.
- Never log secrets or full Authorization headers.
- Never commit `.env`.
- Mark Buffer-created posts as AI-assisted when the API supports it.
- Default Buffer write action to `saveToDraft: true`.
- Queue/schedule requires an explicit `approved: true` argument and the skill must ask for approval first.
- Support dry-run mode for every side-effecting workflow.

## Required MCP tools

Implement these tools (exact names preferred):

### read_brand_profile
Loads and validates the active brand profile.

### generate_creative
Inputs: creative brief, aspect ratio/size, number of outputs, optional reference asset URLs.
Output: local generated file paths + generation metadata.
Provider: OpenAI GPT Image 2.

### upload_asset
Inputs: local path, asset kind, logical folder, tags.
Output: Cloudinary public ID, secure URL, resource type, format, bytes.

### build_carousel_pdf
Inputs: ordered local image paths, output title/slug.
Output: local PDF path, page count, bytes, optional generated thumbnail path.
No network side effect.

### save_buffer_draft
Inputs: LinkedIn text, channel ID, optional assets, optional first comment, tags.
Output: Buffer post ID/status/dueAt.
Must always save as draft.

### queue_buffer_post
Inputs: existing draft/post payload or post definition, channel ID, `approved: true`.
Output: Buffer post ID/status/dueAt.
Reject when approval is not exactly true.

### schedule_buffer_post
Inputs: post definition, channel ID, ISO timestamp, `approved: true`.
Output: Buffer post ID/status/dueAt.
Reject when approval is not exactly true.

### list_buffer_posts
Inputs: channel ID(s), status filter, limit.
Output: compact list of scheduled/draft/sent posts.

## Carousel behavior

- A carousel is 4-10 slides by default unless the user specifies otherwise.
- Use one generated image per slide.
- Preserve slide order.
- Build a PDF from the slide images.
- Upload the PDF as a raw/document-compatible asset.
- Upload the first slide or a generated cover as the required thumbnail.
- Create Buffer document asset using PDF URL, thumbnail URL, and a human-readable title.

## Skill behavior

The bundled `linkedin-auto-poster` skill must:

- identify whether the user wants text-only, single-image, multi-image, or carousel;
- request only information that is actually missing;
- draft the copy before generating media;
- show copy + creative plan to the user before any publishing action;
- permit media generation/upload before publishing approval if requested;
- save to Buffer draft by default;
- never queue or schedule until the user explicitly approves;
- allow batch creation of multiple posts, each with its own status and assets;
- return a compact final summary with post IDs, asset URLs, and scheduled times.

## Testing requirements

- Unit tests for config validation and pure transformations.
- Mocked contract tests for OpenAI, Cloudinary, and Buffer adapters.
- Tests proving queue/schedule fail without `approved: true`.
- Tests proving draft mode never publishes.
- Tests proving Buffer document asset uses PDF + thumbnail.
- At least one end-to-end dry-run fixture using `samples/post-brief.example.json`.

## Implementation style

Prefer small modules and plain data structures. Avoid unnecessary framework layers. Add comments only where API behavior or safety constraints are non-obvious.

## Finish criteria

The repository is done when:

- `npm test` passes;
- `npm run typecheck` passes;
- `npm run mcp` starts a local stdio MCP server;
- Claude Code can load the plugin and see the `linkedin-auto-poster` skill;
- a dry-run can produce a complete planned LinkedIn carousel workflow without credentials;
- with test credentials, a post can be saved as a Buffer draft without publishing it.
