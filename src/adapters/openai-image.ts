import type { AppConfig } from '../config.js';

export interface GenerateCreativeInput {
  prompt: string;
  outputDir: string;
  count?: number;
  size?: string;
  referenceAssetUrls?: string[];
}

export interface GeneratedCreative {
  files: string[];
  model: string;
  dryRun: boolean;
}

/** TODO(Claude): implement against the current official OpenAI Node SDK using GPT Image 2. */
export async function generateCreative(config: AppConfig, input: GenerateCreativeInput): Promise<GeneratedCreative> {
  if (config.DRY_RUN) {
    return {
      files: Array.from({ length: input.count ?? 1 }, (_, i) => `${input.outputDir}/dry-run-${i + 1}.png`),
      model: config.OPENAI_IMAGE_MODEL,
      dryRun: true
    };
  }
  throw new Error('OpenAI image adapter not implemented. Follow IMPLEMENTATION_PLAN.md Phase 2.');
}
