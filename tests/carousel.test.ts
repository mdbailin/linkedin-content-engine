import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { createPlaceholderPng, placeholderColour } from '../src/lib/placeholder-png.js';
import { buildCarouselPdf, slugifyTitle } from '../src/services/carousel.js';

async function makeSlides(dir: string, widths: number[]): Promise<string[]> {
  const files: string[] = [];
  for (const [index, width] of widths.entries()) {
    const file = path.join(dir, `slide-${String(index + 1).padStart(2, '0')}.png`);
    await writeFile(file, createPlaceholderPng({ width, height: 400 }));
    files.push(file);
  }
  return files;
}

describe('buildCarouselPdf', () => {
  it('rejects fewer than two slides', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lce-carousel-'));
    await expect(
      buildCarouselPdf({ orderedImagePaths: ['only-one.png'], outputDir: dir, title: 'x' })
    ).rejects.toThrow(/at least two slides/);
  });

  it('preserves slide order exactly (verified via unique page widths)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lce-carousel-'));
    // Distinct, non-monotonic widths so any reordering is detectable.
    const widths = [320, 640, 480, 800, 560];
    const slides = await makeSlides(dir, widths);
    const built = await buildCarouselPdf({
      orderedImagePaths: slides,
      outputDir: dir,
      title: 'Embedded calculator demos: 5 wins'
    });

    expect(built.pageCount).toBe(5);
    expect(built.bytes).toBeGreaterThan(0);
    expect(built.pageSizes.map((p) => p.width)).toEqual(widths);

    // Independently confirm from the written PDF, not just the return value.
    const reloaded = await PDFDocument.load(await readFile(built.pdfPath));
    expect(reloaded.getPageCount()).toBe(5);
    expect(reloaded.getPages().map((p) => Math.round(p.getWidth()))).toEqual(widths);
  });

  it('uses deterministic slugged filenames and copies slide 1 as the thumbnail', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lce-carousel-'));
    const slides = await makeSlides(dir, [300, 300]);
    const built = await buildCarouselPdf({
      orderedImagePaths: slides,
      outputDir: dir,
      title: 'Why IB AA HL students love this!'
    });
    expect(path.basename(built.pdfPath)).toBe('why-ib-aa-hl-students-love-this.pdf');
    expect(path.basename(built.thumbnailPath)).toBe('why-ib-aa-hl-students-love-this-thumbnail.png');
    const [thumb, first] = await Promise.all([readFile(built.thumbnailPath), readFile(slides[0]!)]);
    expect(thumb.equals(first)).toBe(true);
  });

  it('slugifyTitle is stable and safe', () => {
    expect(slugifyTitle('  Hello, World! ')).toBe('hello-world');
    expect(slugifyTitle('***')).toBe('carousel');
  });
});

describe('placeholder labelling (dry-run legibility)', () => {
  it('gives distinct colours per seed and stamps ink for a label', () => {
    expect(placeholderColour('01-cover.png')).not.toEqual(placeholderColour('02-problem.png'));
    const plain = createPlaceholderPng({ width: 200, height: 200 });
    const labelled = createPlaceholderPng({ width: 200, height: 200, label: '03' });
    expect(labelled.equals(plain)).toBe(false);
  });
});
