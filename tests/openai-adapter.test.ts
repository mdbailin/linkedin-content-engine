import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { generateCreative, validateImageSize } from '../src/adapters/openai-image.js';
import { loadConfig } from '../src/config.js';
import { ProviderError } from '../src/types.js';

const env = { PATH: '/usr/bin' } as NodeJS.ProcessEnv;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const tinyB64 = Buffer.from('fake-image-bytes').toString('base64');

function fakeClient(spy: ReturnType<typeof vi.fn>, edits?: ReturnType<typeof vi.fn>): OpenAI {
  return { images: { generate: spy, edit: edits ?? vi.fn() } } as unknown as OpenAI;
}

describe('validateImageSize', () => {
  it('accepts standard sizes and gpt-image-2 arbitrary sizes', () => {
    expect(validateImageSize('1024x1536').size).toBe('1024x1536');
    expect(validateImageSize('1200x1504')).toEqual({ size: '1200x1504', width: 1200, height: 1504 });
    expect(validateImageSize('auto').size).toBe('auto');
  });

  it('rejects sizes outside gpt-image-2 documented limits', () => {
    expect(() => validateImageSize('1201x1500')).toThrow(/divisible by 16/);
    expect(() => validateImageSize('3200x800')).toThrow(/Aspect ratio/); // 4:1
    expect(() => validateImageSize('3856x2160')).toThrow(/3840x2160/);
    expect(() => validateImageSize('banana')).toThrow(/Unsupported size/);
  });
});

describe('generateCreative (dry-run)', () => {
  it('writes real PNG placeholders at the requested dimensions and count', async () => {
    const config = loadConfig({ ...env, DRY_RUN: 'true' });
    const dir = await mkdtemp(path.join(tmpdir(), 'lce-openai-'));
    const result = await generateCreative(config, {
      prompt: 'Slide one: why embedded calculator demos matter',
      baseName: 'slide-cover',
      outputDir: dir,
      count: 3,
      size: '1200x1504'
    });
    expect(result.dryRun).toBe(true);
    expect(result.files).toHaveLength(3);
    expect(result.files[0]).toContain('slide-cover-01.png');
    const bytes = await readFile(result.files[0]!);
    expect(bytes.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
    // IHDR width at offset 16, height at offset 20
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(1504);
  });
});

describe('generateCreative (live, mocked client)', () => {
  it('decodes b64_json to disk and never returns base64 in the result', async () => {
    const config = loadConfig({ ...env, DRY_RUN: 'false', OPENAI_API_KEY: 'sk-test' });
    const dir = await mkdtemp(path.join(tmpdir(), 'lce-openai-'));
    const generate = vi.fn().mockResolvedValue({ data: [{ b64_json: tinyB64 }, { b64_json: tinyB64 }] });
    const result = await generateCreative(
      config,
      { prompt: 'hero image', outputDir: dir, count: 2, size: '1536x1024' },
      { client: fakeClient(generate) }
    );
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-image-2', n: 2, size: '1536x1024', output_format: 'png' })
    );
    expect(result.files).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain(tinyB64);
    const written = await readFile(result.files[1]!, 'utf8');
    expect(written).toBe('fake-image-bytes');
  });

  it('routes through images.edit when reference assets are provided', async () => {
    const config = loadConfig({ ...env, DRY_RUN: 'false', OPENAI_API_KEY: 'sk-test' });
    const dir = await mkdtemp(path.join(tmpdir(), 'lce-openai-'));
    const generate = vi.fn();
    const edit = vi.fn().mockResolvedValue({ data: [{ b64_json: tinyB64 }] });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(Buffer.from('ref'), { status: 200, headers: { 'content-type': 'image/png' } })
    ) as unknown as typeof fetch;
    await generateCreative(
      config,
      {
        prompt: 'branded slide',
        outputDir: dir,
        referenceAssetUrls: ['https://res.cloudinary.com/demo/brand-ref.png']
      },
      { client: fakeClient(generate, edit), fetchImpl }
    );
    expect(generate).not.toHaveBeenCalled();
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ input_fidelity: 'high' }));
  });

  it('rejects non-https reference URLs before any network call', async () => {
    const config = loadConfig({ ...env, DRY_RUN: 'false', OPENAI_API_KEY: 'sk-test' });
    const dir = await mkdtemp(path.join(tmpdir(), 'lce-openai-'));
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      generateCreative(
        config,
        { prompt: 'x', outputDir: dir, referenceAssetUrls: ['http://insecure.example/ref.png'] },
        { client: fakeClient(vi.fn(), vi.fn().mockResolvedValue({ data: [] })), fetchImpl }
      )
    ).rejects.toThrow(/https/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('normalizes provider failures into ProviderError with redacted secrets', async () => {
    const config = loadConfig({ ...env, DRY_RUN: 'false', OPENAI_API_KEY: 'sk-supersecret' });
    const dir = await mkdtemp(path.join(tmpdir(), 'lce-openai-'));
    const generate = vi.fn().mockRejectedValue(Object.assign(new Error('401 bad key sk-supersecret'), { status: 401 }));
    const error = await generateCreative(
      config,
      { prompt: 'x', outputDir: dir },
      { client: fakeClient(generate) }
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).status).toBe(401);
    expect((error as ProviderError).message).not.toContain('sk-supersecret');
  });
});
