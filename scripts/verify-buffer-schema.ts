#!/usr/bin/env tsx
/**
 * Live Buffer schema verification runbook step.
 *
 * Usage: DRY_RUN=false npm run verify:buffer
 * Read-only: sends a single introspection query, never a write.
 */
import { loadConfig } from '../src/config.js';
import { verifyBufferSchema } from '../src/adapters/buffer.js';

const config = loadConfig();
if (config.DRY_RUN) {
  console.error('DRY_RUN=true — set DRY_RUN=false and BUFFER_API_KEY to verify against the live schema.');
  process.exit(2);
}

const report = await verifyBufferSchema(config);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  console.error('\nSchema mismatch. Update src/adapters/buffer-operations.ts to match the live schema before any write.');
  process.exit(1);
}
console.error('\nSchema OK — safe to attempt a first draft with save_buffer_draft.');
