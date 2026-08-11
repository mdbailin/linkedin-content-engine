import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetBufferSchemaCache,
  createBufferTransport,
  listBufferPosts,
  queueBufferPost,
  saveBufferDraft,
  scheduleBufferPost,
  verifyBufferSchema,
  type BufferTransport
} from '../src/adapters/buffer.js';
import {
  SHARE_MODE_BY_WRITE_MODE,
  buildCreatePostInput,
  parsePostActionPayload,
  serializeAssets
} from '../src/adapters/buffer-operations.js';
import { loadConfig } from '../src/config.js';
import { ProviderError } from '../src/types.js';

const env = { PATH: '/usr/bin' } as NodeJS.ProcessEnv;
const liveEnv = { ...env, DRY_RUN: 'false', BUFFER_API_KEY: 'buf-secret', BUFFER_SKIP_SCHEMA_CHECK: 'true' };

beforeEach(() => _resetBufferSchemaCache());

function transportReturning(data: Record<string, unknown>): { transport: BufferTransport; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn().mockResolvedValue({ data });
  return { transport: spy as unknown as BufferTransport, spy };
}

/** createPost returns the PostActionPayload union — mirror that in mocks. */
function createPostSuccess(post: Record<string, unknown>): Record<string, unknown> {
  return { createPost: { __typename: 'PostActionSuccess', post } };
}

function createPostError(typename: string, message: string): Record<string, unknown> {
  return { createPost: { __typename: typename, message } };
}

describe('approval gate', () => {
  const post = { text: 'hello', channelId: 'ch1' };

  it.each([false, undefined, null, 0, 1, 'true', 'yes'])(
    'queueBufferPost rejects approved=%o without any network call',
    async (approved) => {
      const config = loadConfig(liveEnv);
      const { transport, spy } = transportReturning({});
      await expect(
        queueBufferPost(config, { ...post, approved: approved as never }, { transport })
      ).rejects.toThrow(/approved=true is required/);
      expect(spy).not.toHaveBeenCalled();
    }
  );

  it.each([false, undefined, 'yes'])('scheduleBufferPost rejects approved=%o', async (approved) => {
    const config = loadConfig(liveEnv);
    const { transport, spy } = transportReturning({});
    await expect(
      scheduleBufferPost(
        config,
        { ...post, approved: approved as never, dueAt: '2026-09-01T09:00:00Z' },
        { transport }
      )
    ).rejects.toThrow(/approved=true is required/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('the gate applies even in dry-run mode', async () => {
    const config = loadConfig({ ...env, DRY_RUN: 'true' });
    await expect(queueBufferPost(config, { ...post, approved: false })).rejects.toThrow(ProviderError);
  });
});

describe('saveBufferDraft', () => {
  it('always sends saveToDraft=true and no publishing mode', async () => {
    const config = loadConfig(liveEnv);
    const { transport, spy } = transportReturning(
      createPostSuccess({ id: 'p1', status: 'draft', dueAt: null, text: 'draft me', shareMode: 'addToQueue' })
    );
    const receipt = await saveBufferDraft(config, { text: 'draft me', channelId: 'ch1' }, { transport });
    const [, variables] = spy.mock.calls[0] as [string, { input: Record<string, unknown> }];
    expect(variables.input).toMatchObject({
      saveToDraft: true,
      mode: 'addToQueue',
      schedulingType: 'automatic',
      needsApproval: false,
      assets: []
    });
    expect(variables.input).not.toHaveProperty('dueAt');
    expect(receipt).toMatchObject({ id: 'p1', status: 'draft', dryRun: false });
  });

  it('dry-run returns a receipt without calling the transport', async () => {
    const config = loadConfig({ ...env, DRY_RUN: 'true' });
    const { transport, spy } = transportReturning({});
    const receipt = await saveBufferDraft(config, { text: 'x', channelId: 'ch1' }, { transport });
    expect(spy).not.toHaveBeenCalled();
    expect(receipt.dryRun).toBe(true);
    expect(receipt.status).toBe('draft');
  });
});

describe('queue and schedule modes', () => {
  it('queue sets addToQueue only; schedule sets customScheduled + dueAt', async () => {
    const config = loadConfig(liveEnv);
    const q = transportReturning(createPostSuccess({ id: 'q1', status: 'scheduled', dueAt: null, shareMode: 'addToQueue' }));
    await queueBufferPost(config, { text: 'x', channelId: 'ch1', approved: true }, { transport: q.transport });
    expect((q.spy.mock.calls[0] as [string, { input: Record<string, unknown> }])[1].input).toMatchObject({
      saveToDraft: false,
      mode: 'addToQueue'
    });

    const s = transportReturning(
      createPostSuccess({ id: 's1', status: 'scheduled', dueAt: '2026-09-01T09:00:00Z', shareMode: 'customScheduled' })
    );
    await scheduleBufferPost(
      config,
      { text: 'x', channelId: 'ch1', approved: true, dueAt: '2026-09-01T09:00:00Z' },
      { transport: s.transport }
    );
    expect((s.spy.mock.calls[0] as [string, { input: Record<string, unknown> }])[1].input).toMatchObject({
      mode: 'customScheduled',
      saveToDraft: false,
      dueAt: '2026-09-01T09:00:00Z'
    });
  });

  it('schedule rejects a missing or malformed dueAt', async () => {
    const config = loadConfig(liveEnv);
    const { transport } = transportReturning({});
    await expect(
      scheduleBufferPost(config, { text: 'x', channelId: 'ch1', approved: true }, { transport })
    ).rejects.toThrow(/dueAt is required/);
    await expect(
      scheduleBufferPost(config, { text: 'x', channelId: 'ch1', approved: true, dueAt: 'tomorrow-ish' }, { transport })
    ).rejects.toThrow(/ISO-8601/);
  });
});

describe('asset serialization', () => {
  it('document assets carry url + thumbnailUrl + title; images carry url', () => {
    const serialized = serializeAssets([
      { kind: 'image', url: 'https://res.cloudinary.com/demo/slide.png' },
      {
        kind: 'document',
        url: 'https://res.cloudinary.com/demo/deck.pdf',
        thumbnailUrl: 'https://res.cloudinary.com/demo/thumb.png',
        title: 'Embedded calculator demos'
      }
    ])!;
    expect(serialized[0]).toEqual({ image: { url: 'https://res.cloudinary.com/demo/slide.png' } });
    expect(serialized[1]).toEqual({
      document: {
        url: 'https://res.cloudinary.com/demo/deck.pdf',
        thumbnailUrl: 'https://res.cloudinary.com/demo/thumb.png',
        title: 'Embedded calculator demos'
      }
    });
  });

  it('refuses non-https asset URLs', () => {
    expect(() => serializeAssets([{ kind: 'image', url: 'http://insecure.example/a.png' }])).toThrow();
  });

  it('buildCreatePostInput nests firstComment under LinkedIn metadata and honours feature-detection', () => {
    const input = buildCreatePostInput({
      mode: 'draft',
      channelId: 'ch1',
      text: 'x',
      firstComment: 'first!',
      markAiAssisted: true,
      supportedOptionalFields: new Set(['aiAssisted', 'metadata'])
    });
    expect(input).toMatchObject({
      saveToDraft: true,
      mode: 'addToQueue',
      aiAssisted: true,
      metadata: { linkedin: { firstComment: 'first!' } }
    });
    // firstComment is never a top-level field on the real schema.
    expect(input).not.toHaveProperty('firstComment');
    expect(() => buildCreatePostInput({ mode: 'draft', channelId: 'c', text: 'x', dueAt: '2026-09-01T09:00:00Z' })).toThrow(
      /only valid for schedule/
    );
  });
});

describe('transport', () => {
  it('POSTs to the configured endpoint with a Bearer header and JSON body', async () => {
    const config = loadConfig({ ...liveEnv, BUFFER_GRAPHQL_ENDPOINT: 'https://api.buffer.com' });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));
    const transport = createBufferTransport(config, fetchImpl as unknown as typeof fetch);
    await transport('query { ok }', { a: 1 });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.buffer.com');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer buf-secret');
    expect(JSON.parse(init.body as string)).toEqual({ query: 'query { ok }', variables: { a: 1 } });
  });

  it('maps HTTP 401 to a keyed hint and GraphQL errors to redacted ProviderErrors', async () => {
    const config = loadConfig(liveEnv);
    const unauthorized = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
    await expect(createBufferTransport(config, unauthorized as unknown as typeof fetch)('q')).rejects.toThrow(
      /HTTP 401/
    );

    const graphqlError = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: 'Unknown field saveToDraft for token buf-secret' }] }), {
        status: 200
      })
    );
    const transport = createBufferTransport(config, graphqlError as unknown as typeof fetch);
    const error = await saveBufferDraft(config, { text: 'x', channelId: 'c' }, { transport }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toContain('Unknown field');
    expect((error as ProviderError).message).not.toContain('buf-secret');
  });
});

describe('schema verification', () => {
  const introspection = {
    __schema: {
      queryType: { fields: [{ name: 'posts' }, { name: 'account' }] },
      mutationType: {
        fields: [
          {
            name: 'createPost',
            args: [
              {
                name: 'input',
                type: {
                  kind: 'NON_NULL',
                  name: null,
                  inputFields: null,
                  ofType: {
                    kind: 'INPUT_OBJECT',
                    name: 'CreatePostInput',
                    inputFields: [
                      { name: 'channelId' },
                      { name: 'text' },
                      { name: 'mode' },
                      { name: 'schedulingType' },
                      { name: 'needsApproval' },
                      { name: 'saveToDraft' },
                      { name: 'assets' },
                      { name: 'dueAt' },
                      { name: 'aiAssisted' },
                      { name: 'tagIds' }
                    ]
                  }
                }
              }
            ]
          }
        ]
      }
    }
  };

  it('passes when the assumed contract is present and reports optional-field support', async () => {
    const config = loadConfig({ ...env, DRY_RUN: 'false', BUFFER_API_KEY: 'k' });
    const { transport } = transportReturning(introspection);
    const report = await verifyBufferSchema(config, { transport });
    expect(report.ok).toBe(true);
    expect(report.supportedOptionalFields).toContain('aiAssisted');
    expect(report.missingInputFields).toHaveLength(0);
  });

  it('blocks live writes when the schema does not match, with a pointer to the ops module', async () => {
    const config = loadConfig({ ...env, DRY_RUN: 'false', BUFFER_API_KEY: 'k' });
    const broken = JSON.parse(JSON.stringify(introspection)) as typeof introspection;
    broken.__schema.mutationType.fields[0]!.args[0]!.type.ofType!.inputFields = [
      { name: 'channelId' },
      { name: 'text' }
    ];
    const { transport, spy } = transportReturning(broken);
    const error = await saveBufferDraft(config, { text: 'x', channelId: 'c' }, { transport }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toMatch(/does not match the assumed contract/);
    expect((error as ProviderError).hint).toContain('buffer-operations.ts');
    expect(spy).toHaveBeenCalledTimes(1); // introspection only — the write never went out
  });

  it('feature-detects aiAssisted: omitted when the live schema lacks it', async () => {
    const config = loadConfig({ ...env, DRY_RUN: 'false', BUFFER_API_KEY: 'k' });
    const noFlag = JSON.parse(JSON.stringify(introspection)) as typeof introspection;
    noFlag.__schema.mutationType.fields[0]!.args[0]!.type.ofType!.inputFields = introspection.__schema.mutationType.fields[0]!.args[0]!.type.ofType!.inputFields.filter(
      (f) => f.name !== 'aiAssisted'
    );
    const spy = vi
      .fn()
      .mockResolvedValueOnce({ data: noFlag })
      .mockResolvedValueOnce({ data: createPostSuccess({ id: 'p9', status: 'draft', dueAt: null }) });
    const receipt = await saveBufferDraft(
      config,
      { text: 'x', channelId: 'c' },
      { transport: spy as unknown as BufferTransport }
    );
    const [, variables] = spy.mock.calls[1] as [string, { input: Record<string, unknown> }];
    expect(variables.input).not.toHaveProperty('aiAssisted');
    expect(receipt.notes?.join(' ')).toMatch(/aiAssisted not confirmed/);
  });

  it('listBufferPosts validates channel input and maps results', async () => {
    const config = loadConfig(liveEnv);
    await expect(listBufferPosts(config, { channelIds: [] })).rejects.toThrow(/channelId/);
    const { transport } = transportReturning({
      posts: [{ id: 'a', status: 'draft', dueAt: null, text: 'one' }]
    });
    const posts = await listBufferPosts(config, { channelIds: ['ch1'], limit: 5 }, { transport });
    expect(posts).toEqual([{ id: 'a', status: 'draft', dueAt: null, text: 'one' }]);
  });
});

describe('immediate publishing is unreachable by construction', () => {
  it('no write mode maps to shareNow or shareNext', () => {
    const emitted = Object.values(SHARE_MODE_BY_WRITE_MODE);
    expect(emitted).not.toContain('shareNow');
    expect(emitted).not.toContain('shareNext');
    expect(new Set(emitted)).toEqual(new Set(['addToQueue', 'customScheduled']));
  });

  it('every write path emits only a non-publishing ShareMode', async () => {
    const config = loadConfig(liveEnv);
    const seen: string[] = [];
    const spy = vi.fn().mockImplementation((_query: string, variables: { input: { mode: string } }) => {
      seen.push(variables.input.mode);
      return Promise.resolve({ data: createPostSuccess({ id: 'x', status: 'draft', dueAt: null }) });
    });
    const transport = spy as unknown as BufferTransport;
    const base = { text: 'x', channelId: 'ch1' };
    await saveBufferDraft(config, base, { transport });
    await queueBufferPost(config, { ...base, approved: true }, { transport });
    await scheduleBufferPost(config, { ...base, approved: true, dueAt: '2026-09-01T09:00:00Z' }, { transport });
    expect(seen).toEqual(['addToQueue', 'addToQueue', 'customScheduled']);
  });
});

describe('PostActionPayload union parsing', () => {
  it('returns the post on success', () => {
    const parsed = parsePostActionPayload({
      __typename: 'PostActionSuccess',
      post: { id: 'p1', status: 'draft', shareMode: 'addToQueue' }
    });
    expect(parsed).toMatchObject({ id: 'p1', status: 'draft' });
  });

  it('throws a hinted ProviderError for each error branch', () => {
    for (const [typename, pattern] of [
      ['UnauthorizedError', /BUFFER_API_KEY/],
      ['NotFoundError', /BUFFER_LINKEDIN_CHANNEL_ID/],
      ['LimitReachedError', /limit/i],
      ['InvalidInputError', /buffer-operations\.ts/]
    ] as const) {
      const error = (() => {
        try {
          parsePostActionPayload({ __typename: typename, message: 'nope' });
          return null;
        } catch (e) {
          return e as ProviderError;
        }
      })();
      expect(error).toBeInstanceOf(ProviderError);
      expect(`${error!.message} ${error!.hint ?? ''}`).toMatch(pattern);
      expect(error!.message).toContain(typename);
    }
  });

  it('refuses a success payload with no post id rather than returning undefined', () => {
    expect(() => parsePostActionPayload({ __typename: 'PostActionSuccess', post: {} })).toThrow(/no post id/);
    expect(() => parsePostActionPayload(null)).toThrow(/empty createPost payload/);
  });

  it('surfaces a real error branch through saveBufferDraft', async () => {
    const config = loadConfig(liveEnv);
    const { transport } = transportReturning(createPostError('LimitReachedError', 'Daily limit reached'));
    await expect(saveBufferDraft(config, { text: 'x', channelId: 'ch1' }, { transport })).rejects.toThrow(
      /LimitReachedError.*Daily limit reached/
    );
  });
});
