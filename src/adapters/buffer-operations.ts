/**
 * Buffer GraphQL operations — the single source of truth for every document
 * this project sends to Buffer.
 *
 * ✅ SCHEMA STATUS: VERIFIED BY LIVE INTROSPECTION (11 Aug 2026).
 *
 * Buffer publishes no official npm SDK, so this file was corrected against the
 * real schema via `npm run dump:buffer`. Confirmed facts it encodes:
 *
 * - `createPost(input: CreatePostInput!): PostActionPayload!` — a UNION of
 *   PostActionSuccess plus six typed error branches, so the mutation needs
 *   __typename and inline fragments. There is no bare `id` on the result.
 * - Scheduling mode is the `ShareMode` ENUM (addToQueue | customScheduled |
 *   shareNext | shareNow), NOT a set of booleans. This project only ever emits
 *   addToQueue and customScheduled; the two immediate-publish values are
 *   unreachable by construction and asserted so in tests.
 * - `mode`, `schedulingType` (automatic | notification) and `needsApproval` are
 *   all REQUIRED. `assets` is a required non-null list — send [] when empty.
 * - `saveToDraft: Boolean` is what makes a post a draft; it is orthogonal to
 *   `mode`, which must still be supplied.
 * - The AI flag is `aiAssisted`, not `isAiAssisted`.
 * - First comments are LinkedIn-specific: metadata.linkedin.firstComment.
 *   `linkAttachment` is mutually exclusive with a non-empty assets array.
 * - Asset variants: image { url, thumbnailUrl?, metadata? } and
 *   document { url!, thumbnailUrl!, title! }.
 *
 * If Buffer's schema changes, fix THIS file only — nothing else in the
 * codebase encodes field names.
 */

export const CREATE_POST_MUTATION = /* GraphQL */ `
  mutation LceCreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess {
        post {
          id
          status
          dueAt
          text
          shareMode
          isCustomScheduled
          createdAt
        }
      }
      ... on NotFoundError { message }
      ... on UnauthorizedError { message }
      ... on UnexpectedError { message }
      ... on LimitReachedError { message }
      ... on InvalidInputError { message }
      ... on RestProxyError { message code link }
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
  /** Fields we set on the createPost input object (all verified present). */
  createPostInputFields: [
    'channelId',
    'text',
    'mode',
    'schedulingType',
    'needsApproval',
    'saveToDraft',
    'assets',
    'dueAt'
  ],
  /** Optional niceties: used only when introspection confirms them. */
  optionalCreatePostInputFields: ['aiAssisted', 'tagIds', 'metadata', 'source']
} as const;

// ---------------------------------------------------------------------------
// Input serialization
// ---------------------------------------------------------------------------

import { BufferAssetSchema, ProviderError, type BufferAsset } from '../types.js';

export type BufferWriteMode = 'draft' | 'queue' | 'schedule';

/**
 * Buffer's ShareMode enum. `shareNext` and `shareNow` publish immediately and
 * are deliberately NOT in this map: no code path in this project can produce
 * them, which is asserted in tests.
 */
export const SHARE_MODE_BY_WRITE_MODE = {
  draft: 'addToQueue',
  queue: 'addToQueue',
  schedule: 'customScheduled'
} as const satisfies Record<BufferWriteMode, 'addToQueue' | 'customScheduled'>;

export interface SerializedAsset {
  image?: { url: string };
  document?: { url: string; thumbnailUrl: string; title: string };
}

/** Pure + unit tested: asset union → Buffer's AssetInput (exactly one variant). */
export function serializeAssets(assets: BufferAsset[] | undefined): SerializedAsset[] {
  if (!assets || assets.length === 0) return [];
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
  dueAt?: string | undefined;
  /** Only included when the live schema confirmed support. */
  markAiAssisted?: boolean;
  supportedOptionalFields?: ReadonlySet<string>;
}

/**
 * Pure + unit tested: build the createPost `input`.
 *
 * Safety-relevant invariants:
 * - `mode` is only ever addToQueue or customScheduled — never an immediate share.
 * - `saveToDraft` is true for draft writes and false otherwise.
 * - `dueAt` only accompanies customScheduled.
 * - `needsApproval` is false: Buffer's own approval queue is a separate feature
 *   from this project's approval gate, and mixing them would be confusing.
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

  // First comments live under LinkedIn-specific metadata, not at the top level.
  const metadata =
    input.firstComment && (!supported || supported.has('metadata'))
      ? { metadata: { linkedin: { firstComment: input.firstComment } } }
      : {};

  return {
    channelId: input.channelId,
    text: input.text,
    mode: SHARE_MODE_BY_WRITE_MODE[input.mode],
    schedulingType: 'automatic',
    needsApproval: false,
    saveToDraft: input.mode === 'draft',
    assets: serializeAssets(input.assets), // required non-null list
    ...(input.mode === 'schedule' ? { dueAt: input.dueAt } : {}),
    ...metadata,
    ...optional('tagIds', input.tagIds && input.tagIds.length > 0 ? input.tagIds : undefined),
    ...optional('aiAssisted', input.markAiAssisted === true ? true : undefined)
  };
}

// ---------------------------------------------------------------------------
// Response parsing (createPost returns a union)
// ---------------------------------------------------------------------------

export interface ParsedPost {
  id: string;
  status?: string;
  dueAt?: string | null;
  text?: string;
  shareMode?: string;
  isCustomScheduled?: boolean;
}

/**
 * Unwrap PostActionPayload. Error branches carry a `message`; a successful
 * write carries the full Post. Anything else is treated as an error rather
 * than silently returning an undefined id.
 */
export function parsePostActionPayload(payload: unknown): ParsedPost {
  const result = payload as { __typename?: string; message?: string; code?: number; post?: ParsedPost } | null;
  if (!result || typeof result !== 'object') {
    throw new ProviderError('buffer', 'Buffer returned an empty createPost payload.');
  }
  if (result.__typename === 'PostActionSuccess') {
    if (!result.post?.id) {
      throw new ProviderError('buffer', 'Buffer reported success but returned no post id.');
    }
    return result.post;
  }
  const kind = result.__typename ?? 'UnknownError';
  const hints: Record<string, string> = {
    UnauthorizedError: 'Check BUFFER_API_KEY and that it can post to this channel.',
    NotFoundError: 'Check BUFFER_LINKEDIN_CHANNEL_ID.',
    LimitReachedError: 'Buffer plan or daily posting limit reached.',
    InvalidInputError: 'The createPost input was rejected — see src/adapters/buffer-operations.ts.'
  };
  throw new ProviderError(
    'buffer',
    `Buffer rejected the write (${kind}): ${result.message ?? 'no message'}`,
    hints[kind] ? { hint: hints[kind]! } : {}
  );
}
