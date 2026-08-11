import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from 'cloudinary';
import { requireProviderCredentials, redactSecrets, type AppConfig } from '../config.js';
import { ProviderError, type HostedAsset } from '../types.js';

/**
 * Cloudinary adapter (verified against cloudinary@2.10.0, Aug 2026).
 *
 * Server-side signed uploads via `v2.uploader.upload(file, options)`, configured
 * from the CLOUDINARY_URL environment variable. Images upload as
 * `resource_type: "image"`; carousel PDFs upload as `resource_type: "raw"` so
 * the original bytes are preserved for Buffer's document asset.
 */

export type AssetKind = 'image' | 'document' | 'raw';

export interface UploadAssetInput {
  localPath: string;
  /** Logical folder below CLOUDINARY_BASE_FOLDER, e.g. `<workflow-id>/slides`. */
  folder: string;
  assetKind: AssetKind;
  tags?: string[];
}

export type CloudinaryUploader = (
  file: string,
  options: UploadApiOptions
) => Promise<UploadApiResponse>;

export interface CloudinaryDeps {
  upload?: CloudinaryUploader;
}

let configured = false;

function realUploader(config: AppConfig): CloudinaryUploader {
  if (!configured) {
    // cloudinary v2 reads CLOUDINARY_URL from the environment; `secure` forces https URLs.
    cloudinary.config({ secure: true });
    configured = true;
  }
  return (file, options) => cloudinary.uploader.upload(file, options);
}

function sanitizeFolder(folder: string): string {
  const clean = folder
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== '.' && part !== '..')
    .join('/');
  if (!clean) throw new ProviderError('cloudinary', `Invalid folder "${folder}".`);
  return clean;
}

export function resolveResourceType(kind: AssetKind): 'image' | 'raw' {
  return kind === 'image' ? 'image' : 'raw';
}

export async function uploadAsset(
  config: AppConfig,
  input: UploadAssetInput,
  deps: CloudinaryDeps = {}
): Promise<HostedAsset> {
  const folder = `${config.CLOUDINARY_BASE_FOLDER}/${sanitizeFolder(input.folder)}`;
  const resourceType = resolveResourceType(input.assetKind);

  if (config.DRY_RUN) {
    const file = input.localPath.split('/').pop() ?? 'asset';
    return {
      publicId: `${folder}/${file}`,
      secureUrl: `https://dry-run.invalid/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`,
      resourceType
    };
  }

  requireProviderCredentials(config, 'cloudinary');
  const upload = deps.upload ?? realUploader(config);

  try {
    const response = await upload(input.localPath, {
      folder,
      resource_type: resourceType,
      // Deterministic, human-readable public IDs derived from local filenames.
      use_filename: true,
      unique_filename: false,
      overwrite: false,
      tags: input.tags ?? []
    });
    return {
      publicId: response.public_id,
      secureUrl: response.secure_url,
      resourceType: response.resource_type,
      ...(response.format ? { format: response.format } : {}),
      ...(typeof response.bytes === 'number' ? { bytes: response.bytes } : {}),
      ...(typeof response.width === 'number' ? { width: response.width } : {}),
      ...(typeof response.height === 'number' ? { height: response.height } : {})
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const status = (error as { http_code?: number }).http_code;
    const message = redactSecrets(error instanceof Error ? error.message : String(error), config);
    throw new ProviderError('cloudinary', `Upload failed: ${message}`, {
      ...(status !== undefined ? { status } : {}),
      hint: status === 401 ? 'Check CLOUDINARY_URL credentials.' : undefined,
      cause: error
    });
  }
}
