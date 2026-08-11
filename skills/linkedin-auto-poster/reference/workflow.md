# Workflow reference

## State machine

`idea -> drafted -> creative_planned -> assets_generated -> assets_hosted -> buffer_draft -> approved -> queued/scheduled -> sent`

### Allowed shortcuts
- Text-only: `drafted -> buffer_draft`.
- Single image: skip PDF building.
- User may approve content before media generation, but publication approval is still distinct unless they explicitly say to queue/schedule the finished post.

## Approval semantics

Content approval means the copy/creative direction may be executed.
Publishing approval means a specific post may be placed into the queue or assigned a publication time.

Examples that count as publication approval:
- “Queue this.”
- “Schedule this for Thursday at 9.”
- “Yes, put these three into Buffer’s queue.”

Examples that do not count:
- “Looks good.”
- “Generate the images.”
- “Save it.”
- “Put it in Buffer” (default to draft unless the user says queue/schedule/publish).

## Failure recovery

- Image generation fails: retain approved copy and creative brief; do not create a Buffer post with missing required media.
- Cloudinary upload fails: preserve local generated files and return the failed asset path.
- PDF build fails: preserve ordered slide images.
- Buffer fails: preserve hosted asset URLs and copy; return provider error without retrying publication blindly.
- Partial batch failure: report per-post status; do not roll successful drafts into publishing.

## Dry-run

With `DRY_RUN=true` every tool completes without external calls: creatives are
placeholder PNGs at the requested size, uploads return `dry-run.invalid` URLs,
and Buffer receipts carry `dryRun: true`. Use it to rehearse a full workflow;
always tell the user when receipts are dry-run.

## First live Buffer write of a session

1. `verify_buffer_schema` (read-only). If it reports a mismatch, stop and say
   `src/adapters/buffer-operations.ts` must be updated — do not attempt writes.
2. `save_buffer_draft` for one post.
3. Ask the user to confirm the draft looks right in Buffer before any batch or
   any publishing action.
