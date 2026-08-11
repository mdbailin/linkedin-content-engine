# API contracts

These are design contracts for the local MCP implementation. Re-check current official provider docs before final implementation.

## OpenAI

Purpose: generate/edit visual creative.
Default model: `gpt-image-2`.
Return local file paths rather than exposing large base64 payloads through MCP results.

## Cloudinary

Purpose: persistent media storage and public HTTPS delivery.
Use the server-side Node SDK.
Never expose API secrets to client-side code.
Upload images as image resources and carousel PDFs as raw/document-compatible resources. Return `secure_url` and `public_id`.

## Buffer

Endpoint: GraphQL API.
Authorization: Bearer API key.
Default action: create draft.

The implementation must support:
- text posts;
- image assets;
- document assets for carousel PDFs;
- LinkedIn first comment if requested;
- add-to-queue mode;
- custom scheduled mode with dueAt;
- draft mode;
- post listing.

A document asset needs:
- PDF URL;
- thumbnail URL;
- title.

Provider asset schemas have changed before; inspect the current GraphQL schema before implementation.
