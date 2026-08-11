import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

/**
 * Carousel PDF builder (pdf-lib@1.17.1) — pure local processing, no network.
 *
 * Each slide image becomes one PDF page sized exactly to the image's pixel
 * dimensions (1px = 1pt), preserving input order. LinkedIn renders carousel
 * documents page by page, so page order IS slide order.
 *
 * The thumbnail is a byte-for-byte copy of the first slide, per CLAUDE.md
 * ("upload the first slide or a generated cover as the required thumbnail").
 */

export interface BuildCarouselInput {
  orderedImagePaths: string[];
  /** Directory for the PDF + thumbnail. Created if missing. */
  outputDir: string;
  /** Used for deterministic filenames and PDF metadata. */
  title: string;
  slug?: string;
}

export interface BuiltCarousel {
  pdfPath: string;
  thumbnailPath: string;
  pageCount: number;
  bytes: number;
  pageSizes: Array<{ width: number; height: number }>;
}

export function slugifyTitle(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'carousel'
  );
}

function isPng(bytes: Buffer): boolean {
  return bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47;
}

function isJpg(bytes: Buffer): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export async function buildCarouselPdf(input: BuildCarouselInput): Promise<BuiltCarousel> {
  if (input.orderedImagePaths.length < 2) {
    throw new Error('A carousel PDF requires at least two slides.');
  }
  await mkdir(input.outputDir, { recursive: true });
  const slug = input.slug ?? slugifyTitle(input.title);

  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title);
  pdf.setProducer('linkedin-content-engine');

  const pageSizes: Array<{ width: number; height: number }> = [];
  for (const imagePath of input.orderedImagePaths) {
    const bytes = await readFile(imagePath);
    const image = isPng(bytes)
      ? await pdf.embedPng(bytes)
      : isJpg(bytes)
        ? await pdf.embedJpg(bytes)
        : (() => {
            throw new Error(`Unsupported slide format (need PNG or JPEG): ${imagePath}`);
          })();
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    pageSizes.push({ width: image.width, height: image.height });
  }

  const pdfPath = path.join(input.outputDir, `${slug}.pdf`);
  await writeFile(pdfPath, await pdf.save());

  const firstSlide = input.orderedImagePaths[0]!;
  const thumbnailPath = path.join(input.outputDir, `${slug}-thumbnail${path.extname(firstSlide) || '.png'}`);
  await copyFile(firstSlide, thumbnailPath);

  const { size } = await stat(pdfPath);
  return { pdfPath, thumbnailPath, pageCount: pageSizes.length, bytes: size, pageSizes };
}
