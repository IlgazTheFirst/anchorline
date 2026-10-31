import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BIN = 'skills/anchorline/scripts/anchorline.mjs';
const SPEC = { title: 'MCP test (fictional)', home: { name: 'Example Town', timeZone: 'Europe/London' }, departureDate: '2031-02-01', nights: 12, homeBy: '2031-02-14T23:00', beachNights: 4 };

type Structured = Record<string, unknown> & { trip?: Record<string, unknown> };

describe('anchorline MCP server over stdio', () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ name: 'anchorline-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN, 'mcp'] }));
  });
  afterAll(async () => {
    await client.close();
  });

  it('lists the five tools with honest descriptions and read-only annotations', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['check_trip', 'list_places', 'plan_trip', 'preview_change', 'share_export']);
    const plan = tools.find((t) => t.name === 'plan_trip')!;
    expect(plan.description).toMatch(/planning estimates/);
    expect(plan.description).toMatch(/nothing is booked/);
    expect(plan.inputSchema.required).toEqual(expect.arrayContaining(['home', 'departureDate']));
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('plan_trip returns structured JSON and a text summary', async () => {
    const r = await client.callTool({ name: 'plan_trip', arguments: SPEC });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as Structured;
    expect(s.status).toBe('ok');
    expect((s.trip as { stays: unknown[] }).stays.length).toBeGreaterThan(0);
    expect((r.content as Array<{ text: string }>)[0]!.text).toContain('Nothing here is booked');

    const check = await client.callTool({ name: 'check_trip', arguments: { trip: s.trip! } });
    expect((check.structuredContent as { counts: { violated: number } }).counts.violated).toBe(0);
  });

  it('preview_change rejects privileged mutations and blocks broken commitments', async () => {
    const plan = (await client.callTool({ name: 'plan_trip', arguments: SPEC })).structuredContent as Structured;
    const trip = plan.trip as { stays: Array<{ id: string }>; revision: number };
    const stayId = trip.stays[0]!.id;
    const booking = await client.callTool({
      name: 'preview_change',
      arguments: { trip, commands: [{ type: 'RecordBooking', mark: { id: 'b', subjectId: stayId, status: 'booked', recordedAt: '2030-01-01T00:00:00Z', recordedBy: 'user' } }] },
    });
    expect((booking.structuredContent as { status: string }).status).toBe('rejected');
    const live = await client.callTool({
      name: 'preview_change',
      arguments: { trip, commands: [{ type: 'AddClaim', claim: { id: 'q', subjectId: stayId, kind: 'price', evidenceStatus: 'live_quote', sourceUrl: null, checkedAt: null, dataKind: 'user' } }] },
    });
    expect((live.structuredContent as { status: string }).status).toBe('rejected');
    const tooLong = await client.callTool({ name: 'preview_change', arguments: { trip, commands: [{ type: 'ResizeStay', stayId: trip.stays[trip.stays.length - 1]!.id, nights: 9 }] } });
    expect((tooLong.structuredContent as { status: string }).status).toBe('blocked');
    const fine = await client.callTool({ name: 'preview_change', arguments: { trip, label: 'Lock dates', commands: [{ type: 'LockField', subjectId: stayId, field: 'dates' }] } });
    const ready = fine.structuredContent as { status: string; next: { revision: number } };
    expect(ready.status).toBe('ready');
    expect(ready.next.revision).toBe(trip.revision + 1);
  });

  it('share_export leaves out private details', async () => {
    const plan = (await client.callTool({ name: 'plan_trip', arguments: SPEC })).structuredContent as Structured;
    const trip = { ...(plan.trip as object), travellerDetails: { names: ['CANARY-NAME'], contacts: [] }, privateNotes: [{ id: 'n', subjectId: null, text: 'CANARY-NOTE' }] };
    const r = await client.callTool({ name: 'share_export', arguments: { trip } });
    const text = JSON.stringify(r.structuredContent);
    expect(text).not.toContain('CANARY');
  });

  it('reports bad input as a tool error, not a crash', async () => {
    const r = await client.callTool({ name: 'check_trip', arguments: { trip: { hello: 'world' } } });
    expect(r.isError).toBe(true);
  });
});

describe('anchorline MCP server over streamable HTTP', () => {
  const port = 38000 + Math.floor(Math.random() * 1000);
  let proc: ReturnType<typeof spawn>;
  beforeAll(async () => {
    proc = spawn(process.execPath, [BIN, 'mcp', '--http', String(port)], { stdio: ['ignore', 'ignore', 'pipe'] });
    await new Promise<void>((resolve, reject) => {
      proc.stderr!.on('data', (d: Buffer) => d.toString().includes('/mcp') && resolve());
      proc.on('exit', (c) => reject(new Error(`exited ${c}`)));
    });
  });
  afterAll(() => {
    proc.kill();
  });

  it('serves the same tools at /mcp', async () => {
    const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
    expect(health.name).toBe('anchorline');
    const client = new Client({ name: 'anchorline-http-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
    const r = await client.callTool({ name: 'list_places', arguments: { country: 'Malaysia' } });
    expect((r.structuredContent as { places: unknown[] }).places.length).toBe(3);
    await client.close();
  });
});
