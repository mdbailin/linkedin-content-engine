import { z } from 'zod';

export const PostTypeSchema = z.enum(['text', 'single_image', 'multi_image', 'carousel']);
export type PostType = z.infer<typeof PostTypeSchema>;

export const WorkflowStatusSchema = z.enum([
  'idea','drafted','creative_planned','assets_generated','assets_hosted','buffer_draft','approved','queued','scheduled','sent','failed'
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
  referenceAssetUrls: z.array(z.string().url()).default([]),
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
  desiredPublishAt: z.string().datetime().optional()
});
export type PostBrief = z.infer<typeof PostBriefSchema>;

export interface HostedAsset { publicId: string; secureUrl: string; resourceType: string; format?: string; bytes?: number; }
export interface BufferAssetImage { kind: 'image'; url: string; }
export interface BufferAssetDocument { kind: 'document'; url: string; thumbnailUrl: string; title: string; }
export type BufferAsset = BufferAssetImage | BufferAssetDocument;
export interface BufferPostReceipt { id: string; status?: string; dueAt?: string | null; text?: string; }
