#!/usr/bin/env tsx
/**
 * Phase 7 live validation: send EXACTLY ONE text-only Buffer draft.
 *
 *   DRY_RUN=false npm run first-draft            # shows what it would send
 *   DRY_RUN=false npm run first-draft -- --send  # actually sends it
 *
 * This script imports only saveBufferDraft. There is no import of
 * queueBufferPost or scheduleBufferPost here, so it cannot publish, queue, or
 * schedule anything even if invoked wrongly.
 */
import { loadConfig } from '../src/config.js';
import { saveBufferDraft } from '../src/adapters/buffer.js';
import { ProviderError } from '../src/types.js';

const TEXT = `Test draft from linkedin-content-engine.

If you are reading this in the Buffer dashboard, the integration works. Safe to delete.`;

const config = loadConfig();
const send = process.argv.includes('--send');

if (config.DRY_RUN) {
  console.error('This is the live check: run with DRY_RUN=false.');
  process.exit(2);
}
if (!config.BUFFER_LINKEDIN_CHANNEL_ID) {
  console.error('Set BUFFER_LINKEDIN_CHANNEL_ID in .env (run `npm run channels` to find it).');
  process.exit(2);
}

console.log('\nAbout to save ONE draft:');
console.log(`  channel: ${config.BUFFER_LINKEDIN_CHANNEL_ID}`);
console.log(`  mode:    draft (saveToDraft=true) — never queued, scheduled, or published`);
console.log(`  assets:  none (text only — no OpenAI or Cloudinary calls)`);
console.log(`\n---\n${TEXT}\n---\n`);

if (!send) {
  console.log('Preview only. Re-run with --send to actually save it:');
  console.log('  DRY_RUN=false npm run first-draft -- --send\n');
  process.exit(0);
}

try {
  const receipt = await saveBufferDraft(config, {
    text: TEXT,
    channelId: config.BUFFER_LINKEDIN_CHANNEL_ID
  });
  console.log('Draft saved:');
  console.log(JSON.stringify(receipt, null, 2));
  console.log('\nNow open https://publish.buffer.com and confirm:');
  console.log('  1. The post appears under Drafts (not Queue, not Sent).');
  console.log('  2. Nothing was published to LinkedIn.');
  console.log('  3. Delete the test draft when done.\n');
} catch (error) {
  if (error instanceof ProviderError) {
    console.error(`\nBuffer rejected the draft: ${error.message}`);
    if (error.hint) console.error(`Hint: ${error.hint}`);
    process.exit(1);
  }
  throw error;
}
