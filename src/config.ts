import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const BooleanString = z
  .string()
  .default('false')
  .transform((value) => value.trim().toLowerCase() === 'true');

const EnvSchema = z.object({
  // OpenAI
  OPENAI_API_KEY: z.string().min(1).optional(),
  /**
   * Verified against openai@7.4.0 types (Aug 2026): valid GPT image models include
   * gpt-image-2, gpt-image-2-2026-04-21, gpt-image-1.5, gpt-image-1, gpt-image-1-mini.
   * The API default is gpt-image-1.5, so we always pass the model explicitly.
   */
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-2'),

  // Cloudinary
  CLOUDINARY_URL: z.string().startsWith('cloudinary://').optional(),
  CLOUDINARY_BASE_FOLDER: z.string().default('linkedin-content-engine'),

  // Buffer
  BUFFER_API_KEY: z.string().min(1).optional(),
  BUFFER_GRAPHQL_ENDPOINT: z.url().default('https://api.buffer.com'),
  BUFFER_LINKEDIN_CHANNEL_ID: z.string().min(1).optional(),
  BUFFER_ORGANIZATION_ID: z.string().min(1).optional(),
  /** When true, sets the AI-assisted flag on created posts if the live schema supports it. */
  BUFFER_MARK_AI_ASSISTED: z
    .string()
    .default('true')
    .transform((value) => value.trim().toLowerCase() === 'true'),
  /** Escape hatch: skip the pre-write schema introspection check (not recommended). */
  BUFFER_SKIP_SCHEMA_CHECK: BooleanString,

  // Application
  BRAND_PROFILE_PATH: z.string().default('./brand-profile.json'),
  OUTPUT_DIR: z.string().default('.generated'),
  DRY_RUN: z
    .string()
    .default('true')
    .transform((value) => value.trim().toLowerCase() === 'true'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
});

export type AppConfig = z.infer<typeof EnvSchema> & { outputDirAbsolute: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  return {
    ...parsed,
    outputDirAbsolute: path.resolve(process.cwd(), parsed.OUTPUT_DIR)
  };
}

export type Provider = 'openai' | 'cloudinary' | 'buffer';

export function requireProviderCredentials(config: AppConfig, provider: Provider): void {
  if (config.DRY_RUN) return;

  if (provider === 'openai' && !config.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when DRY_RUN=false');
  }
  if (provider === 'cloudinary' && !config.CLOUDINARY_URL) {
    throw new Error('CLOUDINARY_URL is required when DRY_RUN=false');
  }
  if (provider === 'buffer' && !config.BUFFER_API_KEY) {
    throw new Error('BUFFER_API_KEY is required when DRY_RUN=false');
  }
}

/**
 * Replace any configured secret values appearing in a string with a placeholder.
 * Applied to every provider error before it can reach logs or MCP tool results.
 */
export function redactSecrets(text: string, config: AppConfig): string {
  const secrets = [config.OPENAI_API_KEY, config.BUFFER_API_KEY, config.CLOUDINARY_URL].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  let out = text;
  for (const secret of secrets) {
    out = out.split(secret).join('[redacted]');
  }
  // CLOUDINARY_URL embeds key:secret; also redact the secret segment on its own.
  const cloudinaryMatch = config.CLOUDINARY_URL?.match(/^cloudinary:\/\/([^:]+):([^@]+)@/);
  if (cloudinaryMatch) {
    out = out.split(cloudinaryMatch[2]!).join('[redacted]');
  }
  return out;
}
