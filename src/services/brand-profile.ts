import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BrandProfileSchema, type BrandProfile } from '../types.js';
import type { AppConfig } from '../config.js';

export async function readBrandProfile(config: AppConfig): Promise<BrandProfile> {
  const profilePath = path.resolve(process.cwd(), config.BRAND_PROFILE_PATH);
  let raw: string;
  try {
    raw = await readFile(profilePath, 'utf8');
  } catch {
    throw new Error(
      `No brand profile found at ${profilePath}. Copy samples/brand-profile.example.json to ` +
        `${config.BRAND_PROFILE_PATH} (gitignored) and adjust it, or set BRAND_PROFILE_PATH.`
    );
  }
  try {
    return BrandProfileSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new Error(
      `Brand profile at ${profilePath} is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
