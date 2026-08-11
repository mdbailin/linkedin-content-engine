import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/mcp/server.js';
import { loadConfig } from '../src/config.js';
import type { BufferTransport } from '../src/adapters/buffer.js';

const env = { PATH: '/usr/bin' } as NodeJS.ProcessEnv;

async function connect(config = loadConfig({ ...env, DRY_RUN: 'true' }), deps = {}) {
  const server = createServer(config, deps);
  const client = new Client({ name: 'lce-test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function firstText(result: unknown): string {
  const content = (result as { content?: unknown }).content as Array<{ type: string; text?: string }>;
  const text = content.find((c) => c.type === 'text')?.text;
  expect(text).toBeDefined();
  return text!;
}

describe('MCP server (in-memory transport)', () => {
  it('exposes the full tool set from CLAUDE.md plus verification helpers', async () => {
    const { client } = await connect();
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(
      [
        'build_carousel_pdf',
        'generate_creative',
        'list_buffer_posts',
        'new_workflow_id',
        'queue_buffer_post',
        'read_brand_profile',
        'save_buffer_draft',
        'schedule_buffer_post',
        'upload_asset',
        'verify_buffer_schema'
      ].sort()
    );
  });

  it('save_buffer_draft works in dry-run and returns a compact draft receipt', async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: 'save_buffer_draft',
      arguments: { text: 'Hello LinkedIn', channelId: 'ch-1' }
    });
    expect(result.isError).toBeFalsy();
    const receipt = JSON.parse(firstText(result)) as { status: string; dryRun: boolean };
    expect(receipt.status).toBe('draft');
    expect(receipt.dryRun).toBe(true);
  });

  it('queue_buffer_post with approved=false is refused before any Buffer call', async () => {
    const bufferSpy = vi.fn();
    const { client } = await connect(loadConfig({ ...env, DRY_RUN: 'true' }), {
      buffer: { transport: bufferSpy as unknown as BufferTransport }
    });
    const result = await client.callTool({
      name: 'queue_buffer_post',
      arguments: { text: 'Ship it', channelId: 'ch-1', approved: false }
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/approved=true/);
    expect(firstText(result)).toMatch(/save_buffer_draft/);
    expect(bufferSpy).not.toHaveBeenCalled();
  });

  it('queue_buffer_post without the approved field fails schema validation', async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: 'queue_buffer_post',
      arguments: { text: 'Ship it', channelId: 'ch-1' }
    });
    expect(result.isError).toBe(true);
  });

  it('schedule_buffer_post rejects malformed dueAt at the schema layer', async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: 'schedule_buffer_post',
      arguments: { text: 'x', channelId: 'ch-1', approved: true, dueAt: 'next tuesday' }
    });
    expect(result.isError).toBe(true);
  });

  it('generate_creative (dry-run) writes files under OUTPUT_DIR and returns paths, not bytes', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'lce-mcp-out-'));
    const config = loadConfig({ ...env, DRY_RUN: 'true', OUTPUT_DIR: outDir });
    const { client } = await connect(config);
    const result = await client.callTool({
      name: 'generate_creative',
      arguments: {
        prompt: 'Cover slide: embedded calculator demos',
        workflowId: '20260811-demo-abcd',
        category: 'slides',
        baseName: '01-cover',
        size: '1200x1504'
      }
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(firstText(result)) as { files: string[]; dryRun: boolean };
    expect(payload.dryRun).toBe(true);
    expect(payload.files[0]).toContain(path.join(outDir, '20260811-demo-abcd', 'slides'));
    expect(firstText(result).length).toBeLessThan(2000); // compact result, no image payloads
  });

  it('errors never leak configured secrets', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('boom token buf-secret-token leaked'));
    const config = loadConfig({ ...env, DRY_RUN: 'false', BUFFER_API_KEY: 'buf-secret-token', BUFFER_SKIP_SCHEMA_CHECK: 'true' });
    const { client } = await connect(config, { buffer: { transport: failing as unknown as BufferTransport } });
    const result = await client.callTool({
      name: 'save_buffer_draft',
      arguments: { text: 'x', channelId: 'ch-1' }
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).not.toContain('buf-secret-token');
  });
});
