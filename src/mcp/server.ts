import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig, redactSecrets, type AppConfig } from '../config.js';
import {
  listBufferPosts,
  queueBufferPost,
  saveBufferDraft,
  scheduleBufferPost,
  verifyBufferSchema,
  type BufferDeps
} from '../adapters/buffer.js';
import { generateCreative, type OpenAiDeps } from '../adapters/openai-image.js';
import { uploadAsset, type CloudinaryDeps } from '../adapters/cloudinary.js';
import { buildCarouselPdf } from '../services/carousel.js';
import { readBrandProfile } from '../services/brand-profile.js';
import { newWorkflowId, planAssetLayout } from '../services/orchestrator.js';
import { BufferAssetSchema, ProviderError } from '../types.js';

/**
 * linkedin-content-engine MCP server (stdio).
 *
 * Built on @modelcontextprotocol/sdk@1.30.0 using the current registerTool API.
 * Safety model:
 * - save_buffer_draft is the ONLY default write path and can never publish.
 * - queue_buffer_post / schedule_buffer_post require `approved: true`
 *   (enforced here AND in the adapter).
 * - Tool results are compact JSON; generated media stays on disk.
 * - Secrets never appear in results; provider errors are redacted.
 */

export interface ServerDeps {
  openai?: OpenAiDeps;
  cloudinary?: CloudinaryDeps;
  buffer?: BufferDeps;
}

const SERVER_INFO = { name: 'linkedin-content-engine', version: '0.1.0' } as const;

function ok(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload as Record<string, unknown>
  };
}

function fail(config: AppConfig, error: unknown) {
  const parts: string[] = [];
  if (error instanceof ProviderError) {
    parts.push(`[${error.provider}] ${error.message}`);
    if (error.status !== undefined) parts.push(`status=${error.status}`);
    if (error.hint) parts.push(`hint: ${error.hint}`);
  } else {
    parts.push(error instanceof Error ? error.message : String(error));
  }
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: redactSecrets(parts.join(' | '), config) }]
  };
}

function resolveChannelId(config: AppConfig, provided: string | undefined): string {
  const channelId = provided ?? config.BUFFER_LINKEDIN_CHANNEL_ID;
  if (!channelId) {
    throw new Error('No channelId provided and BUFFER_LINKEDIN_CHANNEL_ID is not set.');
  }
  return channelId;
}

const receiptOutput = {
  id: z.string(),
  status: z.string().optional(),
  dueAt: z.string().nullable().optional(),
  text: z.string().optional(),
  dryRun: z.boolean().optional(),
  notes: z.array(z.string()).optional()
};

const postInputShape = {
  text: z.string().min(1).max(3000).describe('Final LinkedIn post text (authored by Claude, not this server).'),
  channelId: z.string().min(1).optional().describe('Buffer channel ID; defaults to BUFFER_LINKEDIN_CHANNEL_ID.'),
  assets: z
    .array(BufferAssetSchema)
    .max(20)
    .optional()
    .describe('Hosted https assets: images ({kind:"image",url}) or one carousel document ({kind:"document",url,thumbnailUrl,title}).'),
  firstComment: z.string().max(2000).optional().describe('Optional first comment to attach.'),
  tagIds: z.array(z.string()).max(20).optional().describe('Optional Buffer tag IDs.')
};

export function createServer(config: AppConfig, deps: ServerDeps = {}): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    'read_brand_profile',
    {
      title: 'Read brand profile',
      description:
        'Load and validate the active brand profile (BRAND_PROFILE_PATH). Read this before drafting copy or creative briefs.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async () => {
      try {
        return ok(await readBrandProfile(config));
      } catch (error) {
        return fail(config, error);
      }
    }
  );

  server.registerTool(
    'new_workflow_id',
    {
      title: 'New workflow ID',
      description:
        'Create a stable workflow ID (YYYYMMDD-topic-rand4) plus the local/Cloudinary folder layout for one post. Pure planning; no side effects.',
      inputSchema: { topic: z.string().min(1).max(120) },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ topic }) => {
      const workflowId = newWorkflowId(topic);
      return ok(planAssetLayout(config, workflowId));
    }
  );

  server.registerTool(
    'generate_creative',
    {
      title: 'Generate creative (OpenAI GPT Image 2)',
      description:
        'Generate slide/hero images from a creative brief. Writes PNG files to disk under OUTPUT_DIR/<workflowId>/ and returns paths only. In DRY_RUN, writes placeholder PNGs at the exact requested size. gpt-image-2 sizes: WIDTHxHEIGHT divisible by 16, aspect 1:3–3:1, max 3840x2160 (e.g. 1200x1504 for carousel slides, 1536x800 for landscape heroes).',
      inputSchema: {
        prompt: z.string().min(1).max(32000).describe('The creative brief for this image.'),
        workflowId: z.string().min(1).describe('Workflow ID from new_workflow_id.'),
        category: z.enum(['slides', 'single']).default('single').describe('Local subfolder to write into.'),
        baseName: z.string().min(1).max(80).optional().describe('Deterministic filename base, e.g. "01-cover".'),
        count: z.number().int().min(1).max(10).default(1),
        size: z.string().default('1200x1504').describe('WIDTHxHEIGHT, a standard size, or "auto".'),
        quality: z.enum(['low', 'medium', 'high', 'auto']).default('high'),
        referenceAssetUrls: z
          .array(z.url())
          .max(16)
          .optional()
          .describe('Optional https brand-reference images; switches to the edit endpoint with high input fidelity.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
    },
    async ({ prompt, workflowId, category, baseName, count, size, quality, referenceAssetUrls }) => {
      try {
        const layout = planAssetLayout(config, workflowId);
        const outputDir = category === 'slides' ? layout.slidesDir : layout.singleDir;
        const result = await generateCreative(
          config,
          {
            prompt,
            outputDir,
            count,
            size,
            quality,
            ...(baseName ? { baseName } : {}),
            ...(referenceAssetUrls ? { referenceAssetUrls } : {})
          },
          deps.openai ?? {}
        );
        return ok(result);
      } catch (error) {
        return fail(config, error);
      }
    }
  );

  server.registerTool(
    'build_carousel_pdf',
    {
      title: 'Build carousel PDF',
      description:
        'Assemble ordered slide images into a LinkedIn carousel PDF plus a thumbnail (copy of slide 1). Local only; no network. Returns file paths and page metadata.',
      inputSchema: {
        orderedImagePaths: z.array(z.string().min(1)).min(2).max(20).describe('Slide files in exact display order.'),
        title: z.string().min(1).max(200).describe('Human-readable carousel title (also used for the Buffer document asset).'),
        workflowId: z.string().min(1),
        slug: z.string().min(1).max(80).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    },
    async ({ orderedImagePaths, title, workflowId, slug }) => {
      try {
        const layout = planAssetLayout(config, workflowId);
        const result = await buildCarouselPdf({
          orderedImagePaths,
          outputDir: layout.carouselDir,
          title,
          ...(slug ? { slug } : {})
        });
        return ok(result);
      } catch (error) {
        return fail(config, error);
      }
    }
  );

  server.registerTool(
    'upload_asset',
    {
      title: 'Upload asset to Cloudinary',
      description:
        'Upload a local file to Cloudinary under CLOUDINARY_BASE_FOLDER/<folder>. Use folder "<workflowId>/slides", "<workflowId>/carousel", or "<workflowId>/single". Images upload as image resources; PDFs as raw. Returns public ID and secure https URL.',
      inputSchema: {
        localPath: z.string().min(1),
        folder: z.string().min(1).max(200),
        assetKind: z.enum(['image', 'document', 'raw']),
        tags: z.array(z.string().min(1).max(60)).max(10).optional().describe('Include the workflowId as a tag.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
    },
    async ({ localPath, folder, assetKind, tags }) => {
      try {
        return ok(await uploadAsset(config, { localPath, folder, assetKind, ...(tags ? { tags } : {}) }, deps.cloudinary ?? {}));
      } catch (error) {
        return fail(config, error);
      }
    }
  );

  server.registerTool(
    'save_buffer_draft',
    {
      title: 'Save Buffer draft (default write action)',
      description:
        'Save a LinkedIn post to Buffer as a DRAFT. This is the default and only unapproved write action; it can never publish, queue, or schedule.',
      inputSchema: postInputShape,
      outputSchema: receiptOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
    },
    async ({ text, channelId, assets, firstComment, tagIds }) => {
      try {
        const receipt = await saveBufferDraft(
          config,
          {
            text,
            channelId: resolveChannelId(config, channelId),
            ...(assets ? { assets } : {}),
            ...(firstComment ? { firstComment } : {}),
            ...(tagIds ? { tagIds } : {})
          },
          deps.buffer ?? {}
        );
        return ok(receipt);
      } catch (error) {
        return fail(config, error);
      }
    }
  );

  server.registerTool(
    'queue_buffer_post',
    {
      title: 'Queue Buffer post (requires approval)',
      description:
        'Add a post to the Buffer queue. REQUIRES approved:true, which may only be passed after the user explicitly approved queueing this exact post in the current conversation. Without approval, use save_buffer_draft.',
      inputSchema: {
        ...postInputShape,
        approved: z
          .boolean()
          .describe('Must be exactly true, and only after explicit user approval of this post for queueing.')
      },
      outputSchema: receiptOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
    },
    async ({ text, channelId, assets, firstComment, tagIds, approved }) => {
      try {
        if (approved !== true) {
          throw new ProviderError(
            'buffer',
            'Refused: queue_buffer_post requires approved=true after explicit user approval. Use save_buffer_draft instead.'
          );
        }
        const receipt = await queueBufferPost(
          config,
          {
            text,
            channelId: resolveChannelId(config, channelId),
            approved,
            ...(assets ? { assets } : {}),
            ...(firstComment ? { firstComment } : {}),
            ...(tagIds ? { tagIds } : {})
          },
          deps.buffer ?? {}
        );
        return ok(receipt);
      } catch (error) {
        return fail(config, error);
      }
    }
  );

  server.registerTool(
    'schedule_buffer_post',
    {
      title: 'Schedule Buffer post (requires approval)',
      description:
        'Schedule a post for a custom time. REQUIRES approved:true (only after explicit user approval of this exact post and time) and an ISO-8601 dueAt. Without approval, use save_buffer_draft.',
      inputSchema: {
        ...postInputShape,
        dueAt: z.iso.datetime({ offset: true }).describe('ISO-8601 publication time, e.g. 2026-09-01T09:00:00Z.'),
        approved: z
          .boolean()
          .describe('Must be exactly true, and only after explicit user approval of this post and time.')
      },
      outputSchema: receiptOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
    },
    async ({ text, channelId, assets, firstComment, tagIds, dueAt, approved }) => {
      try {
        if (approved !== true) {
          throw new ProviderError(
            'buffer',
            'Refused: schedule_buffer_post requires approved=true after explicit user approval. Use save_buffer_draft instead.'
          );
        }
        const receipt = await scheduleBufferPost(
          config,
          {
            text,
            channelId: resolveChannelId(config, channelId),
            approved,
            dueAt,
            ...(assets ? { assets } : {}),
            ...(firstComment ? { firstComment } : {}),
            ...(tagIds ? { tagIds } : {})
          },
          deps.buffer ?? {}
        );
        return ok(receipt);
      } catch (error) {
        return fail(config, error);
      }
    }
  );

  server.registerTool(
    'list_buffer_posts',
    {
      title: 'List Buffer posts',
      description: 'List draft/queued/scheduled/sent posts for one or more channels. Read-only.',
      inputSchema: {
        channelIds: z.array(z.string().min(1)).min(1).max(10).optional().describe('Defaults to BUFFER_LINKEDIN_CHANNEL_ID.'),
        status: z.string().max(40).optional().describe('Optional status filter, e.g. draft | scheduled | sent.'),
        limit: z.number().int().min(1).max(100).default(20)
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ channelIds, status, limit }) => {
      try {
        const resolved = channelIds ?? [resolveChannelId(config, undefined)];
        const posts = await listBufferPosts(
          config,
          { channelIds: resolved, ...(status ? { status } : {}), limit },
          deps.buffer ?? {}
        );
        return ok({ posts, count: posts.length });
      } catch (error) {
        return fail(config, error);
      }
    }
  );

  server.registerTool(
    'verify_buffer_schema',
    {
      title: 'Verify Buffer schema',
      description:
        'Introspect the live Buffer GraphQL schema and compare it with the contract this project assumes (src/adapters/buffer-operations.ts). Read-only. Run this with credentials before the first live write.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async () => {
      try {
        return ok(await verifyBufferSchema(config, deps.buffer ?? {}));
      } catch (error) {
        return fail(config, error);
      }
    }
  );

  return server;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer(config);
  // stdout is reserved for the MCP protocol; log to stderr only.
  console.error(
    `[linkedin-content-engine] MCP server starting (stdio). DRY_RUN=${config.DRY_RUN} ` +
      `model=${config.OPENAI_IMAGE_MODEL} output=${config.outputDirAbsolute}`
  );
  await server.connect(new StdioServerTransport());
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error('[linkedin-content-engine] fatal:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
