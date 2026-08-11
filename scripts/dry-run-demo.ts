#!/usr/bin/env tsx
/**
 * Dry-run demo: drives the built MCP server over stdio the same way the
 * linkedin-auto-poster skill would, with DRY_RUN=true.
 *
 * Not part of the shipped surface — a rehearsal harness.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SLIDES = [
  {
    base: '01-cover',
    brief:
      'Cover slide. Large headline "Your students can do induction. They still lose the marks." Bold sans-serif, high contrast, deep navy background, single accent stripe. No imagery, no logos.'
  },
  {
    base: '02-problem',
    brief:
      'Headline "The proof is right. The write-up is not." Below it one line: "Marks are lost in the scaffolding, not the algebra." Same navy background, generous margins.'
  },
  {
    base: '03-step-one',
    brief:
      'Headline "1. The base case is not optional." Supporting line: "n = 1 stated, verified, and closed off in one line." Consistent left-aligned type hierarchy.'
  },
  {
    base: '04-step-two',
    brief:
      'Headline "2. Name the assumption." Supporting line: "Assume true for n = k — written explicitly, not implied by the working."'
  },
  {
    base: '05-step-three',
    brief:
      'Headline "3. Show where the assumption is used." Supporting line: "Examiners look for the moment P(k) enters the algebra. Point at it."'
  },
  {
    base: '06-takeaway',
    brief:
      'Final slide. Headline "Teach the skeleton, not just the algebra." Small CTA line: "Free AA/AI resources — link in comments." Accent colour block.'
  }
];

const POST_TEXT = `Your IB AA HL students can do proof by induction. They still lose marks on it.

Not on the algebra — that part is usually fine. They lose marks on the scaffolding around it:

• The base case gets assumed rather than verified.
• "Assume true for n = k" never actually appears on the page.
• The inductive step works, but nowhere is it clear where P(k) was used.

An examiner is reading for a structure. If the structure isn't visible, the marks aren't there, however good the manipulation is.

The fix I've had most success with: teach the skeleton separately from the algebra. Get students writing the four lines of an induction proof with the working left blank. Once the shape is automatic, the algebra slots into it.

Full carousel below.`;

const client = new Client({ name: 'dry-run-demo', version: '0.1.0' });
await client.connect(
  new StdioClientTransport({
    command: 'node',
    args: ['dist/mcp/server.js'],
    env: { ...process.env, DRY_RUN: 'true' } as Record<string, string>
  })
);

function payload(result: unknown): any {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  const text = content.find((c) => c.type === 'text')?.text ?? '{}';
  if ((result as { isError?: boolean }).isError) throw new Error(text);
  return JSON.parse(text);
}

const call = async (name: string, args: Record<string, unknown> = {}) =>
  payload(await client.callTool({ name, arguments: args }));

const log = (step: string, detail: string) => console.log(`  ${step.padEnd(22)} ${detail}`);

console.log('\n=== DRY RUN: carousel workflow via MCP stdio ===\n');

const layout = await call('new_workflow_id', { topic: 'induction proof write-up marks' });
log('new_workflow_id', layout.workflowId);

const slidePaths: string[] = [];
for (const slide of SLIDES) {
  const result = await call('generate_creative', {
    prompt: slide.brief,
    workflowId: layout.workflowId,
    category: 'slides',
    baseName: slide.base,
    size: '1200x1504'
  });
  slidePaths.push(result.files[0]);
  log('generate_creative', `${slide.base}.png  (dryRun=${result.dryRun}, size=${result.size})`);
}

const carousel = await call('build_carousel_pdf', {
  orderedImagePaths: slidePaths,
  title: 'Why students lose marks on induction',
  workflowId: layout.workflowId
});
log('build_carousel_pdf', `${carousel.pageCount} pages, ${carousel.bytes} bytes`);

const pdfAsset = await call('upload_asset', {
  localPath: carousel.pdfPath,
  folder: layout.cloudinaryFolders.carousel,
  assetKind: 'document',
  tags: [layout.workflowId]
});
const thumbAsset = await call('upload_asset', {
  localPath: carousel.thumbnailPath,
  folder: layout.cloudinaryFolders.carousel,
  assetKind: 'image',
  tags: [layout.workflowId]
});
log('upload_asset (pdf)', pdfAsset.secureUrl);
log('upload_asset (thumb)', thumbAsset.secureUrl);

const receipt = await call('save_buffer_draft', {
  text: POST_TEXT,
  channelId: 'demo-linkedin-channel',
  assets: [
    {
      kind: 'document',
      url: pdfAsset.secureUrl,
      thumbnailUrl: thumbAsset.secureUrl,
      title: 'Why students lose marks on induction'
    }
  ]
});
log('save_buffer_draft', `id=${receipt.id} status=${receipt.status} dryRun=${receipt.dryRun}`);

console.log('\n--- safety check: same post, queue without approval ---');
const refused = await client.callTool({
  name: 'queue_buffer_post',
  arguments: { text: POST_TEXT, channelId: 'demo-linkedin-channel', approved: false }
});
const refusedText = (refused as any).content[0].text as string;
console.log(`  isError=${(refused as any).isError}`);
console.log(`  ${refusedText}\n`);

console.log(`PDF: ${carousel.pdfPath}`);
await client.close();
