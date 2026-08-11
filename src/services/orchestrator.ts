import type { AppConfig } from '../config.js';
import type { BufferPostReceipt } from '../types.js';
import { saveBufferDraft } from '../adapters/buffer.js';

export interface DraftWorkflowInput {
  text: string;
  channelId: string;
}

/** Claude/the skill is responsible for copy and creative decisions. */
export async function saveTextPostAsDraft(config: AppConfig, input: DraftWorkflowInput): Promise<BufferPostReceipt> {
  return saveBufferDraft(config, { text: input.text, channelId: input.channelId });
}
