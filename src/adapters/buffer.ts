import type { AppConfig } from '../config.js';
import type { BufferAsset, BufferPostReceipt } from '../types.js';

export interface BufferPostInput {
  text: string;
  channelId: string;
  assets?: BufferAsset[];
  firstComment?: string;
  tagIds?: string[];
}

export interface ScheduleBufferPostInput extends BufferPostInput {
  approved: boolean;
  dueAt?: string;
}

function assertApproved(approved: boolean): void {
  if (approved !== true) throw new Error('Publishing action rejected: explicit approved=true is required.');
}

/** TODO(Claude): implement with current Buffer GraphQL createPost schema; MUST use saveToDraft: true. */
export async function saveBufferDraft(config: AppConfig, input: BufferPostInput): Promise<BufferPostReceipt> {
  if (config.DRY_RUN) return { id: 'dry-run-buffer-draft', status: 'draft', dueAt: null, text: input.text };
  throw new Error('Buffer adapter not implemented. Follow IMPLEMENTATION_PLAN.md Phase 2.');
}

/** TODO(Claude): use createPost with addToQueue mode after assertApproved. */
export async function queueBufferPost(config: AppConfig, input: ScheduleBufferPostInput): Promise<BufferPostReceipt> {
  assertApproved(input.approved);
  if (config.DRY_RUN) return { id: 'dry-run-buffer-queued', status: 'scheduled', dueAt: null, text: input.text };
  throw new Error('Buffer queue adapter not implemented. Follow IMPLEMENTATION_PLAN.md Phase 2.');
}

/** TODO(Claude): use customScheduled + dueAt after assertApproved. */
export async function scheduleBufferPost(config: AppConfig, input: ScheduleBufferPostInput): Promise<BufferPostReceipt> {
  assertApproved(input.approved);
  if (!input.dueAt) throw new Error('dueAt is required for custom scheduling.');
  if (config.DRY_RUN) return { id: 'dry-run-buffer-scheduled', status: 'scheduled', dueAt: input.dueAt, text: input.text };
  throw new Error('Buffer scheduling adapter not implemented. Follow IMPLEMENTATION_PLAN.md Phase 2.');
}

export async function listBufferPosts(_config: AppConfig, _channelIds: string[]): Promise<BufferPostReceipt[]> {
  throw new Error('Buffer listing adapter not implemented. Follow IMPLEMENTATION_PLAN.md Phase 2.');
}
