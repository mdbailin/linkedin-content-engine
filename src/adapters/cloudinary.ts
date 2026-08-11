import type { AppConfig } from '../config.js';
import type { HostedAsset } from '../types.js';

export interface UploadAssetInput {
  localPath: string;
  folder: string;
  assetKind: 'image' | 'document' | 'raw';
  tags?: string[];
}

/** TODO(Claude): implement with Cloudinary's current server-side Node SDK. */
export async function uploadAsset(config: AppConfig, input: UploadAssetInput): Promise<HostedAsset> {
  if (config.DRY_RUN) {
    const file = input.localPath.split('/').pop() ?? 'asset';
    return {
      publicId: `dry-run/${input.folder}/${file}`,
      secureUrl: `https://example.invalid/${encodeURIComponent(input.folder)}/${encodeURIComponent(file)}`,
      resourceType: input.assetKind === 'image' ? 'image' : 'raw'
    };
  }
  throw new Error('Cloudinary adapter not implemented. Follow IMPLEMENTATION_PLAN.md Phase 2.');
}
