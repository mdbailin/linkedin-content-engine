import { describe, expect, it } from 'vitest';
import { loadConfig, redactSecrets, requireProviderCredentials } from '../src/config.js';

const baseEnv = { PATH: '/usr/bin' } as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    const config = loadConfig(baseEnv);
    expect(config.DRY_RUN).toBe(true);
    expect(config.OPENAI_IMAGE_MODEL).toBe('gpt-image-2');
    expect(config.CLOUDINARY_BASE_FOLDER).toBe('linkedin-content-engine');
    expect(config.BUFFER_GRAPHQL_ENDPOINT).toBe('https://api.buffer.com');
    expect(config.BUFFER_MARK_AI_ASSISTED).toBe(true);
    expect(config.BUFFER_SKIP_SCHEMA_CHECK).toBe(false);
    expect(config.OUTPUT_DIR).toBe('.generated');
    expect(config.outputDirAbsolute.endsWith('.generated')).toBe(true);
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('parses DRY_RUN case-insensitively', () => {
    expect(loadConfig({ ...baseEnv, DRY_RUN: 'FALSE' }).DRY_RUN).toBe(false);
    expect(loadConfig({ ...baseEnv, DRY_RUN: 'True' }).DRY_RUN).toBe(true);
    expect(loadConfig({ ...baseEnv, DRY_RUN: 'nope' }).DRY_RUN).toBe(false);
  });

  it('rejects a malformed CLOUDINARY_URL', () => {
    expect(() => loadConfig({ ...baseEnv, CLOUDINARY_URL: 'https://not-cloudinary' })).toThrow();
  });

  it('rejects a non-URL Buffer endpoint', () => {
    expect(() => loadConfig({ ...baseEnv, BUFFER_GRAPHQL_ENDPOINT: 'not a url' })).toThrow();
  });
});

describe('requireProviderCredentials', () => {
  it('never throws in dry-run mode', () => {
    const config = loadConfig({ ...baseEnv, DRY_RUN: 'true' });
    for (const provider of ['openai', 'cloudinary', 'buffer'] as const) {
      expect(() => requireProviderCredentials(config, provider)).not.toThrow();
    }
  });

  it('throws per-provider when live and unconfigured', () => {
    const config = loadConfig({ ...baseEnv, DRY_RUN: 'false' });
    expect(() => requireProviderCredentials(config, 'openai')).toThrow(/OPENAI_API_KEY/);
    expect(() => requireProviderCredentials(config, 'cloudinary')).toThrow(/CLOUDINARY_URL/);
    expect(() => requireProviderCredentials(config, 'buffer')).toThrow(/BUFFER_API_KEY/);
  });
});

describe('redactSecrets', () => {
  it('removes every configured secret, including the Cloudinary secret segment', () => {
    const config = loadConfig({
      ...baseEnv,
      OPENAI_API_KEY: 'sk-test-abc123',
      BUFFER_API_KEY: 'buf-token-999',
      CLOUDINARY_URL: 'cloudinary://key123:supersecret@demo-cloud'
    });
    const noisy =
      'openai said sk-test-abc123 while buffer used Bearer buf-token-999 and cloudinary://key123:supersecret@demo-cloud plus raw supersecret';
    const clean = redactSecrets(noisy, config);
    expect(clean).not.toContain('sk-test-abc123');
    expect(clean).not.toContain('buf-token-999');
    expect(clean).not.toContain('supersecret');
    expect(clean).toContain('[redacted]');
  });
});

describe('blank env vars behave as unset', () => {
  it('loads an untouched .env.example-style environment with DRY_RUN=false', () => {
    // Exactly what dotenv produces from the shipped template plus one real key.
    const config = loadConfig({
      PATH: '/usr/bin',
      OPENAI_API_KEY: '',
      OPENAI_IMAGE_MODEL: 'gpt-image-2',
      CLOUDINARY_URL: '',
      CLOUDINARY_BASE_FOLDER: '',
      BUFFER_API_KEY: 'buf-real-key',
      BUFFER_GRAPHQL_ENDPOINT: '',
      BUFFER_LINKEDIN_CHANNEL_ID: '',
      BUFFER_ORGANIZATION_ID: '',
      BRAND_PROFILE_PATH: '',
      OUTPUT_DIR: '',
      DRY_RUN: 'false',
      LOG_LEVEL: ''
    } as NodeJS.ProcessEnv);

    expect(config.BUFFER_API_KEY).toBe('buf-real-key');
    expect(config.OPENAI_API_KEY).toBeUndefined();
    expect(config.CLOUDINARY_URL).toBeUndefined();
    // Blanks must fall through to defaults, not empty strings.
    expect(config.BUFFER_GRAPHQL_ENDPOINT).toBe('https://api.buffer.com');
    expect(config.CLOUDINARY_BASE_FOLDER).toBe('linkedin-content-engine');
    expect(config.OUTPUT_DIR).toBe('.generated');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.DRY_RUN).toBe(false);
  });

  it('still enforces credentials per provider at point of use', () => {
    const config = loadConfig({ PATH: '/usr/bin', BUFFER_API_KEY: 'k', DRY_RUN: 'false' } as NodeJS.ProcessEnv);
    expect(() => requireProviderCredentials(config, 'buffer')).not.toThrow();
    expect(() => requireProviderCredentials(config, 'openai')).toThrow(/OPENAI_API_KEY/);
    expect(() => requireProviderCredentials(config, 'cloudinary')).toThrow(/CLOUDINARY_URL/);
  });
});
