import { z } from 'zod';

export const PostTypeSchema = z.enum(['text', 'single_image', 'multi_image', 'carousel']);
export type PostType = z.infer<typeof PostTypeSchema>;

export const WorkflowStatusSchema = z.enum([
  'idea',
  'drafted',
  'creative_planned',
  'assets_generated',
  'assets_hosted',
  'buffer_draft',
  'approved',
  'queued',
  'scheduled',
  'sent',
  'failed'
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const BrandProfileSchema = z.object({
  brandName: z.string().min(1),
  audience: z.array(z.string()).default([]),
  voice: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  colors: z.array(z.string()).default([]),
  fonts: z.array(z.string()).default([]),
  logoAssetPath: z.string().optional(),
  referenceAssetUrls: z.array(z.url()).default([]),
  defaultCta: z.string().optional(),
  defaultHashtags: z.array(z.string()).default([])
});
export type BrandProfile = z.infer<typeof BrandProfileSchema>;

export const PostBriefSchema = z.object({
  topic: z.string().min(1),
  objective: z.string().min(1),
  audience: z.string().optional(),
  postType: PostTypeSchema.default('text'),
  sourceNotes: z.array(z.string()).default([]),
  cta: z.string().optional(),
  slideCount: z.number().int().min(2).max(20).optional(),
  desiredPublishAt: z.iso.datetime().optional()
});
export type PostBrief = z.infer<typeof PostBriefSchema>;

// ---------------------------------------------------------------------------
// Hosted / Buffer asset shapes
// ---------------------------------------------------------------------------

export const HostedAssetSchema = z.object({
  publicId: z.string(),
  secureUrl: z.url(),
  resourceType: z.string(),
  format: z.string().optional(),
  bytes: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
});
export type HostedAsset = z.infer<typeof HostedAssetSchema>;

/** Only https URLs may be handed to Buffer (see ARCHITECTURE.md security model). */
export const HttpsUrl = z
  .url()
  .refine((value) => value.startsWith('https://'), { message: 'Asset URLs must use https.' });

export const BufferAssetImageSchema = z.object({
  kind: z.literal('image'),
  url: HttpsUrl
});
export type BufferAssetImage = z.infer<typeof BufferAssetImageSchema>;

export const BufferAssetDocumentSchema = z.object({
  kind: z.literal('document'),
  url: HttpsUrl,
  thumbnailUrl: HttpsUrl,
  title: z.string().min(1).max(200)
});
export type BufferAssetDocument = z.infer<typeof BufferAssetDocumentSchema>;

export const BufferAssetSchema = z.discriminatedUnion('kind', [
  BufferAssetImageSchema,
  BufferAssetDocumentSchema
]);
export type BufferAsset = z.infer<typeof BufferAssetSchema>;

export const BufferPostReceiptSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  dueAt: z.string().nullable().optional(),
  text: z.string().optional(),
  dryRun: z.boolean().optional(),
  notes: z.array(z.string()).optional()
});
export type BufferPostReceipt = z.infer<typeof BufferPostReceiptSchema>;

// ---------------------------------------------------------------------------
// Provider error normalization
// ---------------------------------------------------------------------------

export class ProviderError extends Error {
  readonly provider: 'openai' | 'cloudinary' | 'buffer';
  readonly status?: number;
  readonly code?: string;
  readonly hint?: string;

  constructor(
    provider: 'openai' | 'cloudinary' | 'buffer',
    message: string,
    options: { status?: number; code?: string; hint?: string; cause?: unknown } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ProviderError';
    this.provider = provider;
    if (options.status !== undefined) this.status = options.status;
    if (options.code !== undefined) this.code = options.code;
    if (options.hint !== undefined) this.hint = options.hint;
  }
}
