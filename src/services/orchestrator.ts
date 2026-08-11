import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import type { BufferPostReceipt } from '../types.js';
import { saveBufferDraft } from '../adapters/buffer.js';

/**
 * Pure planning helpers + thin convenience flows.
 *
 * Claude (via the skill) owns copywriting and orchestration decisions; nothing
 * in this module authors content.
 */

export function slugifyTopic(topic: string): string {
  return (
    topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'post'
  );
}

/** `YYYYMMDD-<topic-slug>-<rand4>` per ARCHITECTURE.md. */
export function newWorkflowId(topic: string, now: Date = new Date()): string {
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `${yyyymmdd}-${slugifyTopic(topic)}-${randomBytes(2).toString('hex')}`;
}

export interface AssetLayout {
  workflowId: string;
  root: string;
  slidesDir: string;
  carouselDir: string;
  singleDir: string;
  cloudinaryFolders: { slides: string; carousel: string; single: string };
}

/** Local + Cloudinary layout for one workflow (see ARCHITECTURE.md "Asset layout"). */
export function planAssetLayout(config: AppConfig, workflowId: string): AssetLayout {
  const root = path.join(config.outputDirAbsolute, workflowId);
  return {
    workflowId,
    root,
    slidesDir: path.join(root, 'slides'),
    carouselDir: path.join(root, 'carousel'),
    singleDir: path.join(root, 'single'),
    cloudinaryFolders: {
      slides: `${workflowId}/slides`,
      carousel: `${workflowId}/carousel`,
      single: `${workflowId}/single`
    }
  };
}

export interface DraftWorkflowInput {
  text: string;
  channelId: string;
}

export async function saveTextPostAsDraft(
  config: AppConfig,
  input: DraftWorkflowInput
): Promise<BufferPostReceipt> {
  return saveBufferDraft(config, { text: input.text, channelId: input.channelId });
}
