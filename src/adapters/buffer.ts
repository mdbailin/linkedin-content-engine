import { requireProviderCredentials, redactSecrets, type AppConfig } from '../config.js';
import { ProviderError, type BufferAsset, type BufferPostReceipt } from '../types.js';
import {
  buildCreatePostInput,
  CREATE_POST_MUTATION,
  LIST_POSTS_QUERY,
  REQUIRED_SCHEMA,
  SCHEMA_INTROSPECTION_QUERY,
  type BufferWriteMode
} from './buffer-operations.js';

/**
 * Buffer adapter.
 *
 * Safety model (see CLAUDE.md):
 * - `saveBufferDraft` ALWAYS writes with saveToDraft mode; it cannot publish.
 * - `queueBufferPost` / `scheduleBufferPost` throw unless `approved === true`
 *   (strict identity check — truthy values like 1 or "yes" are rejected).
 * - Before the first live write, the live schema is introspected and compared
 *   against REQUIRED_SCHEMA unless BUFFER_SKIP_SCHEMA_CHECK=true.
 * - The Authorization header is never logged and never appears in errors.
 */

export interface BufferPostInput {
  text: string;
  channelId: string;
  assets?: BufferAsset[];
  firstComment?: string;
  tagIds?: string[];
}

export interface ScheduleBufferPostInput extends BufferPostInput {
  approved: boolean;
  dueAt?: string;
}

export interface ListBufferPostsInput {
  channelIds: string[];
  status?: string;
  limit?: number;
}

interface GraphQLResponse {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
}

export type BufferTransport = (query: string, variables?: unknown) => Promise<GraphQLResponse>;

export interface BufferDeps {
  transport?: BufferTransport;
}

export function createBufferTransport(config: AppConfig, fetchImpl: typeof fetch = fetch): BufferTransport {
  return async (query, variables) => {
    let response: Response;
    try {
      response = await fetchImpl(config.BUFFER_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.BUFFER_API_KEY ?? ''}`
        },
        body: JSON.stringify({ query, variables })
      });
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error), config);
      throw new ProviderError('buffer', `Could not reach Buffer at ${config.BUFFER_GRAPHQL_ENDPOINT}: ${message}`, {
        cause: error
      });
    }
    if (!response.ok) {
      throw new ProviderError('buffer', `Buffer responded with HTTP ${response.status}.`, {
        status: response.status,
        hint:
          response.status === 401 || response.status === 403
            ? 'Check BUFFER_API_KEY.'
            : response.status === 404
              ? 'Check BUFFER_GRAPHQL_ENDPOINT — the GraphQL path may differ from the default.'
              : undefined
      });
    }
    return (await response.json()) as GraphQLResponse;
  };
}

function unwrap<T>(response: GraphQLResponse, field: string, config: AppConfig): T {
  if (response.errors && response.errors.length > 0) {
    const message = redactSecrets(response.errors.map((e) => e.message).join('; '), config);
    throw new ProviderError('buffer', `GraphQL error: ${message}`, {
      hint: 'If the error mentions unknown fields/types, run verify_buffer_schema and update src/adapters/buffer-operations.ts.'
    });
  }
  const value = response.data?.[field];
  if (value === undefined || value === null) {
    throw new ProviderError('buffer', `GraphQL response missing "${field}".`);
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// Schema verification (introspection)
// ---------------------------------------------------------------------------

export interface BufferSchemaReport {
  ok: boolean;
  endpoint: string;
  missingMutations: string[];
  missingQueries: string[];
  missingInputFields: string[];
  supportedOptionalFields: string[];
  notes: string[];
}

interface IntrospectionField {
  name: string;
  args?: Array<{
    name: string;
    type?: {
      kind?: string;
      name?: string | null;
      inputFields?: Array<{ name: string }> | null;
      ofType?: { kind?: string; name?: string | null; inputFields?: Array<{ name: string }> | null } | null;
    };
  }>;
}

function collectCreatePostInputFields(mutationFields: IntrospectionField[]): Set<string> {
  const createPost = mutationFields.find((f) => f.name === 'createPost');
  const names = new Set<string>();
  const inputArg = createPost?.args?.find((a) => a.name === 'input');
  const type = inputArg?.type;
  for (const holder of [type, type?.ofType]) {
    for (const field of holder?.inputFields ?? []) names.add(field.name);
  }
  return names;
}

export async function verifyBufferSchema(
  config: AppConfig,
  deps: BufferDeps = {}
): Promise<BufferSchemaReport> {
  const notes: string[] = [];
  if (config.DRY_RUN && !deps.transport) {
    return {
      ok: false,
      endpoint: config.BUFFER_GRAPHQL_ENDPOINT,
      missingMutations: [],
      missingQueries: [],
      missingInputFields: [],
      supportedOptionalFields: [],
      notes: ['DRY_RUN=true — no live schema was contacted. Set DRY_RUN=false with credentials to verify.']
    };
  }
  requireProviderCredentials(config, 'buffer');
  const transport = deps.transport ?? createBufferTransport(config);
  const response = await transport(SCHEMA_INTROSPECTION_QUERY);
  if (response.errors && response.errors.length > 0) {
    const message = redactSecrets(response.errors.map((e) => e.message).join('; '), config);
    return {
      ok: false,
      endpoint: config.BUFFER_GRAPHQL_ENDPOINT,
      missingMutations: [...REQUIRED_SCHEMA.mutations],
      missingQueries: [...REQUIRED_SCHEMA.queries],
      missingInputFields: [...REQUIRED_SCHEMA.createPostInputFields],
      supportedOptionalFields: [],
      notes: [`Introspection failed: ${message}`, 'The endpoint may disable introspection or expect a different path.']
    };
  }

  const schema = (response.data as { __schema?: { queryType?: { fields?: IntrospectionField[] }; mutationType?: { fields?: IntrospectionField[] } } } | undefined)?.__schema;
  const queryFields = new Set((schema?.queryType?.fields ?? []).map((f) => f.name));
  const mutationFields = schema?.mutationType?.fields ?? [];
  const mutationNames = new Set(mutationFields.map((f) => f.name));
  const inputFields = collectCreatePostInputFields(mutationFields);

  const missingMutations = REQUIRED_SCHEMA.mutations.filter((name) => !mutationNames.has(name));
  const missingQueries = REQUIRED_SCHEMA.queries.filter((name) => !queryFields.has(name));
  const missingInputFields =
    inputFields.size > 0
      ? REQUIRED_SCHEMA.createPostInputFields.filter((name) => !inputFields.has(name))
      : [...REQUIRED_SCHEMA.createPostInputFields];
  if (inputFields.size === 0) {
    notes.push('Could not resolve createPost input fields from introspection; treat all as unverified.');
  }
  const supportedOptionalFields = REQUIRED_SCHEMA.optionalCreatePostInputFields.filter((name) =>
    inputFields.has(name)
  );

  return {
    ok: missingMutations.length === 0 && missingQueries.length === 0 && missingInputFields.length === 0,
    endpoint: config.BUFFER_GRAPHQL_ENDPOINT,
    missingMutations,
    missingQueries,
    missingInputFields,
    supportedOptionalFields,
    notes
  };
}

const schemaCache = new Map<string, BufferSchemaReport>();

/** Test hook. */
export function _resetBufferSchemaCache(): void {
  schemaCache.clear();
}

async function ensureSchemaVerified(config: AppConfig, deps: BufferDeps): Promise<BufferSchemaReport | undefined> {
  if (config.BUFFER_SKIP_SCHEMA_CHECK) return undefined;
  const cached = schemaCache.get(config.BUFFER_GRAPHQL_ENDPOINT);
  if (cached) return cached;
  const report = await verifyBufferSchema(config, deps);
  if (!report.ok) {
    const detail = [
      report.missingMutations.length ? `mutations: ${report.missingMutations.join(', ')}` : '',
      report.missingQueries.length ? `queries: ${report.missingQueries.join(', ')}` : '',
      report.missingInputFields.length ? `input fields: ${report.missingInputFields.join(', ')}` : ''
    ]
      .filter(Boolean)
      .join(' | ');
    throw new ProviderError('buffer', `Live Buffer schema does not match the assumed contract (${detail || report.notes.join('; ')}).`, {
      hint: 'Update src/adapters/buffer-operations.ts to match the live schema, or set BUFFER_SKIP_SCHEMA_CHECK=true to bypass at your own risk.'
    });
  }
  schemaCache.set(config.BUFFER_GRAPHQL_ENDPOINT, report);
  return report;
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

function assertApproved(approved: unknown): void {
  if (approved !== true) {
    throw new ProviderError(
      'buffer',
      'Publishing action rejected: explicit approved=true is required after human review. Use save_buffer_draft for unapproved content.'
    );
  }
}

interface PostNode {
  id: string;
  status?: string;
  dueAt?: string | null;
  text?: string;
}

async function createPost(
  config: AppConfig,
  mode: BufferWriteMode,
  input: BufferPostInput & { dueAt?: string },
  deps: BufferDeps
): Promise<BufferPostReceipt> {
  if (config.DRY_RUN) {
    const status = mode === 'draft' ? 'draft' : 'scheduled';
    return {
      id: `dry-run-buffer-${mode}`,
      status,
      dueAt: input.dueAt ?? null,
      text: input.text,
      dryRun: true,
      notes: [`DRY_RUN=true — no request was sent to Buffer (mode=${mode}).`]
    };
  }

  requireProviderCredentials(config, 'buffer');
  const notes: string[] = [];
  const report = await ensureSchemaVerified(config, deps);
  const supportedOptionalFields = report ? new Set(report.supportedOptionalFields) : undefined;
  if (!report) notes.push('Schema check skipped (BUFFER_SKIP_SCHEMA_CHECK=true); optional fields were omitted.');

  const markAiAssisted =
    config.BUFFER_MARK_AI_ASSISTED && supportedOptionalFields?.has('isAiAssisted') === true;
  if (config.BUFFER_MARK_AI_ASSISTED && !markAiAssisted) {
    notes.push('isAiAssisted not confirmed by the live schema; flag omitted.');
  }

  const variables = {
    input: buildCreatePostInput({
      mode,
      channelId: input.channelId,
      text: input.text,
      assets: input.assets,
      firstComment: input.firstComment,
      tagIds: input.tagIds,
      organizationId: config.BUFFER_ORGANIZATION_ID,
      dueAt: input.dueAt,
      markAiAssisted,
      ...(supportedOptionalFields ? { supportedOptionalFields } : {})
    })
  };

  const transport = deps.transport ?? createBufferTransport(config);
  const post = unwrap<PostNode>(await transport(CREATE_POST_MUTATION, variables), 'createPost', config);
  return {
    id: post.id,
    ...(post.status !== undefined ? { status: post.status } : {}),
    dueAt: post.dueAt ?? null,
    text: input.text,
    dryRun: false,
    ...(notes.length > 0 ? { notes } : {})
  };
}

/** Always saves as a draft. This function has no publishing path. */
export async function saveBufferDraft(
  config: AppConfig,
  input: BufferPostInput,
  deps: BufferDeps = {}
): Promise<BufferPostReceipt> {
  return createPost(config, 'draft', input, deps);
}

/** Adds to the channel queue. Requires approved === true. */
export async function queueBufferPost(
  config: AppConfig,
  input: ScheduleBufferPostInput,
  deps: BufferDeps = {}
): Promise<BufferPostReceipt> {
  assertApproved(input.approved);
  if (input.dueAt) {
    throw new ProviderError('buffer', 'queueBufferPost does not take dueAt; use scheduleBufferPost for custom times.');
  }
  return createPost(config, 'queue', input, deps);
}

/** Schedules for a custom time. Requires approved === true and an ISO dueAt. */
export async function scheduleBufferPost(
  config: AppConfig,
  input: ScheduleBufferPostInput,
  deps: BufferDeps = {}
): Promise<BufferPostReceipt> {
  assertApproved(input.approved);
  if (!input.dueAt) throw new ProviderError('buffer', 'dueAt is required for custom scheduling.');
  if (Number.isNaN(Date.parse(input.dueAt))) {
    throw new ProviderError('buffer', `dueAt is not a valid ISO-8601 timestamp: "${input.dueAt}".`);
  }
  return createPost(config, 'schedule', { ...input, dueAt: input.dueAt }, deps);
}

export async function listBufferPosts(
  config: AppConfig,
  input: ListBufferPostsInput,
  deps: BufferDeps = {}
): Promise<BufferPostReceipt[]> {
  if (input.channelIds.length === 0) {
    throw new ProviderError('buffer', 'At least one channelId is required.');
  }
  if (config.DRY_RUN) return [];
  requireProviderCredentials(config, 'buffer');
  const transport = deps.transport ?? createBufferTransport(config);
  const posts = unwrap<PostNode[]>(
    await transport(LIST_POSTS_QUERY, {
      channelIds: input.channelIds,
      status: input.status ?? null,
      limit: Math.min(Math.max(input.limit ?? 20, 1), 100)
    }),
    'posts',
    config
  );
  return posts.map((post) => ({
    id: post.id,
    ...(post.status !== undefined ? { status: post.status } : {}),
    dueAt: post.dueAt ?? null,
    ...(post.text !== undefined ? { text: post.text } : {})
  }));
}
