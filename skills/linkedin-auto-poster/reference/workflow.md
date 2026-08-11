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
