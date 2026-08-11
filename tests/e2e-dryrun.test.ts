import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { PostBriefSchema } from '../src/types.js';
import { generateCreative } from '../src/adapters/openai-image.js';
import { uploadAsset } from '../src/adapters/cloudinary.js';
import { saveBufferDraft } from '../src/adapters/buffer.js';
import { buildCarouselPdf } from '../src/services/carousel.js';
import { newWorkflowId, planAssetLayout, saveTextPostAsDraft } from '../src/services/orchestrator.js';

const env = { PATH: '/usr/bin' } as NodeJS.ProcessEnv;

/** The whole point of dry-run: nothing may leave the machine. */
const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
  throw new Error('Network access attempted during dry-run e2e.');
});

afterEach(() => expect(fetchSpy).not.toHaveBeenCalled());

describe('end-to-end dry-run', () => {
  it('text-only: brief → draft receipt without credentials', async () => {
    const config = loadConfig({ ...env, DRY_RUN: 'true' });
    const receipt = await saveTextPostAsDraft(config, {
      text: 'Embedded calculator demos cut lesson friction. Here is why.',
      channelId: 'linkedin-channel-1'
    });
    expect(receipt.dryRun).toBe(true);
    expect(receipt.status).toBe('draft');
  });

  it('carousel: samples/post-brief.example.json → slides → PDF → hosted → Buffer draft', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'lce-e2e-'));
    const config = loadConfig({ ...env, DRY_RUN: 'true', OUTPUT_DIR: outDir });

    const briefRaw = JSON.parse(
      await readFile(path.join(process.cwd(), 'samples', 'post-brief.example.json'), 'utf8')
    ) as unknown;
    const brief = PostBriefSchema.parse(briefRaw);
    expect(brief.postType).toBe('carousel');
    const slideCount = brief.slideCount ?? 6;

    const workflowId = newWorkflowId(brief.topic, new Date('2026-08-11T08:00:00Z'));
    expect(workflowId).toMatch(/^20260811-[a-z0-9-]+-[0-9a-f]{4}$/);
    const layout = planAssetLayout(config, workflowId);

    // 1) One generated slide per brief slide, in order.
    const slidePaths: string[] = [];
    for (let i = 0; i < slideCount; i++) {
      const result = await generateCreative(config, {
        prompt: `Slide ${i + 1} for: ${brief.topic}`,
        outputDir: layout.slidesDir,
        baseName: `${String(i + 1).padStart(2, '0')}-slide`,
        size: '1200x1504'
      });
      expect(result.dryRun).toBe(true);
      slidePaths.push(result.files[0]!);
    }
    expect(slidePaths).toHaveLength(slideCount);

    // 2) PDF preserves order and page count.
    const carousel = await buildCarouselPdf({
      orderedImagePaths: slidePaths,
      outputDir: layout.carouselDir,
      title: brief.topic
    });
    expect(carousel.pageCount).toBe(slideCount);
    const reloaded = await PDFDocument.load(await readFile(carousel.pdfPath));
    expect(reloaded.getPageCount()).toBe(slideCount);

    // 3) Hosted URLs are https and use the workflow layout.
    const pdfAsset = await uploadAsset(config, {
      localPath: carousel.pdfPath,
      folder: layout.cloudinaryFolders.carousel,
      assetKind: 'document',
      tags: [workflowId]
    });
    const thumbAsset = await uploadAsset(config, {
      localPath: carousel.thumbnailPath,
      folder: layout.cloudinaryFolders.carousel,
      assetKind: 'image',
      tags: [workflowId]
    });
    for (const asset of [pdfAsset, thumbAsset]) {
      expect(asset.secureUrl.startsWith('https://')).toBe(true);
      expect(asset.publicId).toContain(workflowId);
    }

    // 4) Buffer draft with the document asset — never a publishing mode.
    const receipt = await saveBufferDraft(config, {
      text: `New carousel: ${brief.topic}\n\n${brief.cta ?? ''}`.trim(),
      channelId: 'linkedin-channel-1',
      assets: [
        {
          kind: 'document',
          url: pdfAsset.secureUrl,
          thumbnailUrl: thumbAsset.secureUrl,
          title: brief.topic.slice(0, 120)
        }
      ]
    });
    expect(receipt).toMatchObject({ status: 'draft', dryRun: true });
  });
});
