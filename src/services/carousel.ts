export interface BuildCarouselInput {
  orderedImagePaths: string[];
  outputPath: string;
  title: string;
}

export interface BuiltCarousel {
  pdfPath: string;
  thumbnailPath: string;
  pageCount: number;
  bytes?: number;
}

/** TODO(Claude): implement with pdf-lib or another small library; preserve image order exactly. */
export async function buildCarouselPdf(input: BuildCarouselInput): Promise<BuiltCarousel> {
  if (input.orderedImagePaths.length < 2) throw new Error('A carousel PDF requires at least two slides.');
  throw new Error('Carousel PDF service not implemented. Follow IMPLEMENTATION_PLAN.md Phase 3.');
}
