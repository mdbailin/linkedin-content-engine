import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-2'),
  CLOUDINARY_URL: z.string().min(1).optional(),
  CLOUDINARY_BASE_FOLDER: z.string().default('linkedin-content-engine'),
  BUFFER_API_KEY: z.string().min(1).optional(),
  BUFFER_LINKEDIN_CHANNEL_ID: z.string().min(1).optional(),
  BUFFER_ORGANIZATION_ID: z.string().min(1).optional(),
  BRAND_PROFILE_PATH: z.string().default('./brand-profile.json'),
  DRY_RUN: z.string().default('true').transform((value) => value.toLowerCase() === 'true'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(env);
}

export function requireProviderCredentials(config: AppConfig, provider: 'openai' | 'cloudinary' | 'buffer'): void {
  if (config.DRY_RUN) return;

  if (provider === 'openai' && !config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required when DRY_RUN=false');
  if (provider === 'cloudinary' && !config.CLOUDINARY_URL) throw new Error('CLOUDINARY_URL is required when DRY_RUN=false');
  if (provider === 'buffer' && !config.BUFFER_API_KEY) throw new Error('BUFFER_API_KEY is required when DRY_RUN=false');
}
