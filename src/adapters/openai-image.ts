import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import OpenAI, { toFile } from 'openai';
import type { Uploadable } from 'openai';
import { requireProviderCredentials, redactSecrets, type AppConfig } from '../config.js';
import { createPlaceholderPng, placeholderColour } from '../lib/placeholder-png.js';
import { ProviderError } from '../types.js';

/**
 * OpenAI image adapter (verified against openai@7.4.0, Aug 2026).
 *
 * Facts this implementation relies on, taken from the SDK's shipped types:
 * - GPT image models (including `gpt-image-2`) always return base64 (`b64_json`);
 *   there is no hosted-URL response mode for them.
 * - `gpt-image-2` accepts arbitrary `WIDTHxHEIGHT` sizes: both divisible by 16,
 *   aspect ratio between 1:3 and 3:1, maximum 3840x2160.
 * - `gpt-image-2` does NOT support transparent backgrounds.
 * - `images.edit` accepts up to 16 reference images, which is how brand
 *   reference assets are honoured.
 */

export interface GenerateCreativeInput {
  prompt: string;
  outputDir: string;
  /** Base name used for deterministic output filenames. */
  baseName?: string;
  count?: number;
  /** `WIDTHxHEIGHT` (gpt-image-2), one of the standard sizes, or `auto`. */
  size?: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  referenceAssetUrls?: string[];
}

export interface GeneratedCreative {
  files: string[];
  model: string;
  size: string;
  dryRun: boolean;
  usedReferenceImages: number;
}

export interface OpenAiDeps {
  client?: OpenAI;
  fetchImpl?: typeof fetch;
}

const STANDARD_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536', 'auto']);
const MAX_REFERENCE_IMAGES = 16;

/**
 * Validate a requested size against gpt-image-2's documented constraints.
 * Pure function; unit tested.
 */
export function validateImageSize(size: string): { size: string; width: number; height: number } {
  if (size === 'auto') return { size, width: 1024, height: 1024 };
  const match = /^(\d{2,4})x(\d{2,4})$/.exec(size);
  if (!match) {
    throw new ProviderError('openai', `Unsupported size "${size}". Use WIDTHxHEIGHT or "auto".`);
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (STANDARD_SIZES.has(size)) return { size, width, height };

  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new ProviderError('openai', `gpt-image-2 sizes must be divisible by 16 (got ${size}).`);
  }
  const ratio = width / height;
  if (ratio < 1 / 3 || ratio > 3) {
    throw new ProviderError('openai', `Aspect ratio must be between 1:3 and 3:1 (got ${size}).`);
  }
  if (width > 3840 || height > 2160) {
    throw new ProviderError('openai', `Maximum supported resolution is 3840x2160 (got ${size}).`);
  }
  return { size, width, height };
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'creative'
  );
}

function outputFilename(baseName: string, index: number): string {
  return `${slugify(baseName)}-${String(index + 1).padStart(2, '0')}.png`;
}

async function downloadReferenceImages(
  urls: string[],
  fetchImpl: typeof fetch
): Promise<Uploadable[]> {
  if (urls.length > MAX_REFERENCE_IMAGES) {
    throw new ProviderError(
      'openai',
      `At most ${MAX_REFERENCE_IMAGES} reference images are supported (got ${urls.length}).`
    );
  }
  const files: Uploadable[] = [];
  for (const [index, url] of urls.entries()) {
    if (!url.startsWith('https://')) {
      throw new ProviderError('openai', `Reference asset URLs must be https (got "${url}").`);
    }
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new ProviderError('openai', `Failed to download reference image ${url} (${response.status}).`, {
        status: response.status
      });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? 'image/png';
    files.push(await toFile(bytes, `reference-${index + 1}`, { type: contentType }));
  }
  return files;
}

export async function generateCreative(
  config: AppConfig,
  input: GenerateCreativeInput,
  deps: OpenAiDeps = {}
): Promise<GeneratedCreative> {
  const count = input.count ?? 1;
  if (count < 1 || count > 10) {
    throw new ProviderError('openai', 'count must be between 1 and 10.');
  }
  const { size, width, height } = validateImageSize(input.size ?? '1024x1024');
  const baseName = input.baseName ?? input.prompt;
  await mkdir(input.outputDir, { recursive: true });

  if (config.DRY_RUN) {
    const files: string[] = [];
    for (let i = 0; i < count; i++) {
      const filename = outputFilename(baseName, i);
      const file = path.join(input.outputDir, filename);
      // Distinct colour + stamped label per slide so a rendered dry-run deck
      // can be checked for ORDER visually, not just page count.
      const label = (filename.match(/^\d+/)?.[0] ?? String(i + 1)).padStart(2, '0');
      await writeFile(
        file,
        createPlaceholderPng({ width, height, rgb: placeholderColour(filename), label })
      );
      files.push(file);
    }
    return {
      files,
      model: config.OPENAI_IMAGE_MODEL,
      size,
      dryRun: true,
      usedReferenceImages: 0
    };
  }

  requireProviderCredentials(config, 'openai');
  const client = deps.client ?? new OpenAI({ apiKey: config.OPENAI_API_KEY });
  const fetchImpl = deps.fetchImpl ?? fetch;

  try {
    const referenceUrls = input.referenceAssetUrls ?? [];
    let data;
    if (referenceUrls.length > 0) {
      const referenceImages = await downloadReferenceImages(referenceUrls, fetchImpl);
      const response = await client.images.edit({
        model: config.OPENAI_IMAGE_MODEL,
        prompt: input.prompt,
        image: referenceImages,
        n: count,
        size,
        quality: input.quality ?? 'high',
        input_fidelity: 'high',
        output_format: 'png'
      });
      data = response.data ?? [];
    } else {
      const response = await client.images.generate({
        model: config.OPENAI_IMAGE_MODEL,
        prompt: input.prompt,
        n: count,
        size,
        quality: input.quality ?? 'high',
        output_format: 'png'
      });
      data = response.data ?? [];
    }

    if (data.length === 0) {
      throw new ProviderError('openai', 'The image API returned no images.');
    }

    const files: string[] = [];
    for (const [index, image] of data.entries()) {
      if (!image.b64_json) {
        throw new ProviderError('openai', `Image ${index + 1} was returned without base64 payload.`);
      }
      const file = path.join(input.outputDir, outputFilename(baseName, index));
      await writeFile(file, Buffer.from(image.b64_json, 'base64'));
      files.push(file);
    }
    return {
      files,
      model: config.OPENAI_IMAGE_MODEL,
      size,
      dryRun: false,
      usedReferenceImages: referenceUrls.length
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const status = (error as { status?: number }).status;
    const message = redactSecrets(error instanceof Error ? error.message : String(error), config);
    throw new ProviderError('openai', `Image generation failed: ${message}`, {
      ...(status !== undefined ? { status } : {}),
      hint:
        status === 401
          ? 'Check OPENAI_API_KEY.'
          : status === 400
            ? 'Check the size/quality parameters against gpt-image-2 limits.'
            : undefined,
      cause: error
    });
  }
}
