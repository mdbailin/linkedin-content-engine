/**
 * Buffer GraphQL operations — the single source of truth for every document
 * this project sends to Buffer.
 *
 * ⚠️ SCHEMA STATUS: ASSUMED, NOT LIVE-VERIFIED AT BUILD TIME.
 *
 * Buffer publishes no official npm SDK, and this repository is implemented from
 * the contract documented in ARCHITECTURE.md / skills/.../api-contracts.md:
 * GraphQL at BUFFER_GRAPHQL_ENDPOINT, Bearer auth, `createPost` with the
 * saveToDraft / addToQueue / customScheduled(+dueAt) modes, image assets
 * `{ url }`, and document assets `{ url, thumbnailUrl, title }`.
 *
 * Before the first live write, `verifyBufferSchema` introspects the real API
 * and checks everything listed in REQUIRED_SCHEMA below. If Buffer's schema
 * differs, fix THIS file only — nothing else in the codebase encodes field
 * names.
 */

export const CREATE_POST_MUTATION = /* GraphQL */ `
  mutation LceCreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      id
      status
      dueAt
    }
  }
`;

export const LIST_POSTS_QUERY = /* GraphQL */ `
  query LceListPosts($channelIds: [ID!]!, $status: String, $limit: Int) {
    posts(channelIds: $channelIds, status: $status, limit: $limit) {
      id
      status
      dueAt
      text
    }
  }
`;

/**
 * Minimal introspection: enough to confirm the operations and input fields we
 * depend on, small enough to stay well inside any query-cost limits.
 */
export const SCHEMA_INTROSPECTION_QUERY = /* GraphQL */ `
  query LceSchemaCheck {
    __schema {
      queryType {
        fields {
          name
        }
      }
      mutationType {
        fields {
          name
          args {
            name
            type {
              kind
              name
              inputFields {
                name
              }
              ofType {
                kind
                name
                inputFields {
                  name
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const REQUIRED_SCHEMA = {
  mutations: ['createPost'],
  queries: ['posts'],
  /** Fields we set on the createPost input object. */
  createPostInputFields: [
    'channelId',
    'text',
    'saveToDraft',
    'addToQueue',
    'customScheduled',
    'dueAt',
    'assets'
  ],
  /** Optional niceties: used only when introspection confirms them. */
  optionalCreatePostInputFields: ['isAiAssisted', 'firstComment', 'tagIds', 'organizationId']
} as const;

// ---------------------------------------------------------------------------
// Input serialization
// ---------------------------------------------------------------------------

import { BufferAssetSchema, ProviderError, type BufferAsset } from '../types.js';

export type BufferWriteMode = 'draft' | 'queue' | 'schedule';

export interface SerializedAsset {
  image?: { url: string };
  document?: { url: string; thumbnailUrl: string; title: string };
}

/** Pure + unit tested: asset union → Buffer's assumed asset input shape. */
export function serializeAssets(assets: BufferAsset[] | undefined): SerializedAsset[] | undefined {
  if (!assets || assets.length === 0) return undefined;
  return assets.map((asset) => {
    const parsed = BufferAssetSchema.parse(asset); // re-enforces https-only URLs
    if (parsed.kind === 'image') {
      return { image: { url: parsed.url } };
    }
    return {
      document: { url: parsed.url, thumbnailUrl: parsed.thumbnailUrl, title: parsed.title }
    };
  });
}

export interface CreatePostVariablesInput {
  mode: BufferWriteMode;
  channelId: string;
  text: string;
  assets?: BufferAsset[] | undefined;
  firstComment?: string | undefined;
  tagIds?: string[] | undefined;
  organizationId?: string | undefined;
  dueAt?: string | undefined;
  /** Only included when the live schema confirmed support. */
  markAiAssisted?: boolean;
  supportedOptionalFields?: ReadonlySet<string>;
}

/**
 * Pure + unit tested: build the createPost `input` object with EXACTLY one
 * scheduling mode set, per the safety model.
 */
export function buildCreatePostInput(input: CreatePostVariablesInput): Record<string, unknown> {
  if (input.mode === 'schedule' && !input.dueAt) {
    throw new ProviderError('buffer', 'dueAt is required for custom scheduling.');
  }
  if (input.mode !== 'schedule' && input.dueAt) {
    throw new ProviderError('buffer', `dueAt is only valid for schedule mode (got mode=${input.mode}).`);
  }

  const supported = input.supportedOptionalFields;
  const optional = (field: string, value: unknown): Record<string, unknown> => {
    if (value === undefined) return {};
    if (supported && !supported.has(field)) return {};
    return { [field]: value };
  };

  return {
    channelId: input.channelId,
    text: input.text,
    saveToDraft: input.mode === 'draft',
    addToQueue: input.mode === 'queue',
    customScheduled: input.mode === 'schedule',
    ...(input.mode === 'schedule' ? { dueAt: input.dueAt } : {}),
    ...(serializeAssets(input.assets) ? { assets: serializeAssets(input.assets) } : {}),
    ...optional('firstComment', input.firstComment),
    ...optional('tagIds', input.tagIds && input.tagIds.length > 0 ? input.tagIds : undefined),
    ...optional('organizationId', input.organizationId),
    ...optional('isAiAssisted', input.markAiAssisted === true ? true : undefined)
  };
}
