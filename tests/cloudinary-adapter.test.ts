import { describe, expect, it, vi } from 'vitest';
import { resolveResourceType, uploadAsset } from '../src/adapters/cloudinary.js';
import { loadConfig } from '../src/config.js';
import { ProviderError } from '../src/types.js';

const env = { PATH: '/usr/bin' } as NodeJS.ProcessEnv;

describe('resolveResourceType', () => {
  it('maps images to image and documents/raw to raw', () => {
    expect(resolveResourceType('image')).toBe('image');
    expect(resolveResourceType('document')).toBe('raw');
    expect(resolveResourceType('raw')).toBe('raw');
  });
});

describe('uploadAsset', () => {
  it('returns an https dry-run URL without touching the network', async () => {
    const config = loadConfig({ ...env, DRY_RUN: 'true' });
    const upload = vi.fn();
    const asset = await uploadAsset(
      config,
      { localPath: '/tmp/x/slide-01.png', folder: '20260811-demo/slides', assetKind: 'image' },
      { upload }
    );
    expect(upload).not.toHaveBeenCalled();
    expect(asset.secureUrl.startsWith('https://')).toBe(true);
    expect(asset.publicId).toContain('linkedin-content-engine/20260811-demo/slides');
  });

  it('joins the base folder, maps resource_type, and passes tags on live uploads', async () => {
    const config = loadConfig({
      ...env,
      DRY_RUN: 'false',
      CLOUDINARY_URL: 'cloudinary://key:secret@demo'
    });
    const upload = vi.fn().mockResolvedValue({
      public_id: 'linkedin-content-engine/wf/carousel/deck',
      secure_url: 'https://res.cloudinary.com/demo/raw/upload/v1/linkedin-content-engine/wf/carousel/deck.pdf',
      resource_type: 'raw',
      format: 'pdf',
      bytes: 1234
    });
    const asset = await uploadAsset(
      config,
      { localPath: '/tmp/deck.pdf', folder: 'wf/carousel', assetKind: 'document', tags: ['wf'] },
      { upload }
    );
    expect(upload).toHaveBeenCalledWith(
      '/tmp/deck.pdf',
      expect.objectContaining({
        folder: 'linkedin-content-engine/wf/carousel',
        resource_type: 'raw',
        tags: ['wf'],
        use_filename: true,
        overwrite: false
      })
    );
    expect(asset).toMatchObject({ resourceType: 'raw', format: 'pdf', bytes: 1234 });
    expect(asset.secureUrl.endsWith('.pdf')).toBe(true);
  });

  it('rejects path-traversal folders and normalizes provider failures', async () => {
    const config = loadConfig({ ...env, DRY_RUN: 'false', CLOUDINARY_URL: 'cloudinary://key:secret@demo' });
    await expect(
      uploadAsset(config, { localPath: '/tmp/a.png', folder: '../..', assetKind: 'image' }, { upload: vi.fn() })
    ).rejects.toThrow(/Invalid folder/);

    const failing = vi.fn().mockRejectedValue(Object.assign(new Error('Invalid signature secret'), { http_code: 401 }));
    const error = await uploadAsset(
      config,
      { localPath: '/tmp/a.png', folder: 'wf/slides', assetKind: 'image' },
      { upload: failing }
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).provider).toBe('cloudinary');
    expect((error as ProviderError).status).toBe(401);
    expect((error as ProviderError).message).not.toContain('secret@');
  });
});
