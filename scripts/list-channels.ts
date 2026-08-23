#!/usr/bin/env tsx
/**
 * Read-only: print the authenticated account's organizations and channels, so
 * BUFFER_ORGANIZATION_ID and BUFFER_LINKEDIN_CHANNEL_ID can be copied exactly
 * rather than transcribed from a dashboard URL.
 *
 * Usage: DRY_RUN=false npm run channels
 */
import { loadConfig } from '../src/config.js';
import { getBufferAccount, listBufferChannels } from '../src/adapters/buffer.js';

const config = loadConfig();
if (config.DRY_RUN) {
  console.error('Set DRY_RUN=false (inline is fine) and BUFFER_API_KEY.');
  process.exit(2);
}

const account = await getBufferAccount(config);
console.log(`\nAccount: ${account.id}`);

for (const org of account.organizations ?? []) {
  console.log(`\nOrganization: ${org.name}`);
  console.log(`  BUFFER_ORGANIZATION_ID=${org.id}`);

  const channels = await listBufferChannels(config, org.id);
  if (channels.length === 0) {
    console.log('  (no channels)');
    continue;
  }
  console.log('  Channels:');
  for (const channel of channels) {
    const flags = [
      channel.isDisconnected ? 'DISCONNECTED' : null,
      channel.isLocked ? 'LOCKED' : null
    ].filter(Boolean);
    const label = channel.displayName && channel.displayName !== channel.name ? ` (${channel.displayName})` : '';
    console.log(`    ${channel.id}  ${channel.service.padEnd(10)} ${channel.name}${label}${flags.length ? `  [${flags.join(', ')}]` : ''}`);
  }

  const linkedin = channels.filter((c) => c.service.toLowerCase() === 'linkedin' && !c.isDisconnected);
  for (const channel of linkedin) {
    console.log(`\n  # ${channel.name}\n  BUFFER_LINKEDIN_CHANNEL_ID=${channel.id}`);
  }
}

console.log('');
