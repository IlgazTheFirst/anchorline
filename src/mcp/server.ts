import { createServer, type IncomingMessage } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { checksText, checkTrip, HONESTY_NOTE, InputError, listPlaces, placesText, planText, planTrip, previewChange, previewText, shareExport } from '../application/api';
import { tripSpec } from '../application/tripSpec';
import { PACKS } from '../catalogue';

declare const __ANCHORLINE_VERSION__: string;
const VERSION = typeof __ANCHORLINE_VERSION__ === 'string' ? __ANCHORLINE_VERSION__ : '0.0.0-dev';
const PACK = PACKS[0]!;
const MAX_BODY_BYTES = 4_000_000;

const tripArg = z
  .record(z.string(), z.unknown())
  .describe('A trip document exactly as returned in the `trip` field of plan_trip (or an Anchorline private backup). Pass it back unchanged.');

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

type ToolResult = { content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

function ok(text: string, data: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent: data };
}

function fail(err: unknown): ToolResult {
  const message = err instanceof InputError || err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: message }], structuredContent: { error: message }, isError: true };
}

/**
 * Anchorline as MCP tools. Everything is computed locally from the bundled
 * catalogue. Tools never book, never fetch fares or timetables, and treat
 * every change as an untrusted suggestion.
 */
export function createAnchorlineServer(): McpServer {
  const server = new McpServer(
    { name: 'anchorline', title: 'Anchorline', version: VERSION },
    {
      instructions: `Anchorline plans holidays around fixed commitments (dates, minimum stays, fixed events, home-by deadlines) inside the ${PACK.title} catalogue. ${HONESTY_NOTE} Present planning estimates as estimates, sourced facts with their source, and never describe anything as booked or confirmed.`,
    },
  );

  server.registerTool(
    'list_places',
    {
      title: 'List catalogue places',
      description: `Lists the real places the planner can plan automatically (${PACK.title}), with tags, recommended nights, airports, a summary, approximate season notes and source links checked on ${PACK.checkedAt}. Places outside this list can still be added by hand (ownPlaces), but get no routes or activities.`,
      inputSchema: { country: z.string().max(80).optional().describe('Filter by country, e.g. "Thailand"') },
      annotations: ANNOTATIONS,
    },
    async ({ country }) => {
      try {
        const out = listPlaces(PACK, country);
        return ok(placesText(out), out);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'plan_trip',
    {
      title: 'Plan a trip',
      description:
        'Builds one recommended itinerary from dates, travellers, interests and hard commitments (must-visit places with minimum nights, consecutive beach nights, fixed events, a home-by deadline, places of your own). Returns stays, journeys, day plans, reasons, open questions, alternative routes, constraint checks and a `trip` document to pass to check_trip, preview_change or share_export. ' +
        'Journey durations are planning estimates from documented routes, never timetables or fares; journeys have no times. Place and activity facts carry source links. No prices are invented and nothing is booked. If commitments conflict, it returns status "infeasible" with suggested relaxations and changes nothing.',
      inputSchema: tripSpec.shape,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      try {
        const out = planTrip(args, PACK);
        return { ...ok(planText(out), out as unknown as Record<string, unknown>), isError: out.status === 'invalid' };
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'check_trip',
    {
      title: 'Check a trip',
      description:
        'Evaluates every commitment and structural rule on a trip: each result is "satisfied", "violated" or "unresolved" (unknown times or prices are unresolved, never assumed fine), with an explanation and possible relaxations. Read-only.',
      inputSchema: { trip: tripArg },
      annotations: ANNOTATIONS,
    },
    async ({ trip }) => {
      try {
        const out = checkTrip(trip);
        return ok(`${out.title} (revision ${out.revision}, ${out.nights} nights)\n${checksText(out)}`, out);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'preview_change',
    {
      title: 'Preview a change',
      description:
        'Shows what a change would do to a trip (stays, nights, journeys, activities, evidence that stops applying, commitments it would break) without saving anything. Commands use the Anchorline command format, e.g. {"type":"ResizeStay","stayId":"stay_1_bangkok","nights":5,"shiftFollowing":true}. ' +
        'Every change is treated as an untrusted suggestion: it is rejected if it tries to record a booking, mark a price as quoted or a timetable as checked, unlock a field or remove a hard commitment. A change that breaks a commitment comes back "blocked". When it is "ready", `next` holds the updated trip.',
      inputSchema: {
        trip: tripArg,
        commands: z.array(z.record(z.string(), z.unknown())).min(1).max(50).describe('One or more Anchorline commands, applied in order'),
        label: z.string().max(200).optional().describe('Short description of the change'),
      },
      annotations: ANNOTATIONS,
    },
    async ({ trip, commands, label }) => {
      try {
        const out = previewChange(trip, { commands, label }, { actor: 'untrusted_proposal' });
        return ok(previewText(out), out as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'share_export',
    {
      title: 'Make a shareable copy',
      description:
        'Builds an allowlisted, shareable copy of a trip. Traveller names and contacts, booking references, private notes and edit history are always left out; exact dates, accommodation names and costs can also be left out. Returns JSON only; nothing is uploaded or published.',
      inputSchema: {
        trip: tripArg,
        omitExactDates: z.boolean().optional().describe('Replace dates with day numbers'),
        omitAccommodation: z.boolean().optional().describe('Leave out accommodation names (default true)'),
        omitCosts: z.boolean().optional().describe('Leave out budget lines'),
      },
      annotations: ANNOTATIONS,
    },
    async ({ trip, omitExactDates, omitAccommodation, omitCosts }) => {
      try {
        const share = shareExport(trip, { omitExactDates, omitAccommodation, omitCosts });
        return ok(`Shareable copy of "${share.title}": ${share.stays.length} stays, ${share.travel.length} journeys. Traveller details, booking references, private notes and history are not included.`, share as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}

export async function runStdio(): Promise<void> {
  const server = createAnchorlineServer();
  await server.connect(new StdioServerTransport());
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large.');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

/**
 * Stateless streamable HTTP on /mcp: a fresh server and transport per
 * request. Binds to 127.0.0.1 unless told otherwise; put an HTTPS proxy or
 * tunnel in front of it for remote clients such as ChatGPT connectors.
 */
export async function runHttp(port: number, host = '127.0.0.1'): Promise<void> {
  const http = createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, name: 'anchorline', version: VERSION }));
      return;
    }
    if (path !== '/mcp') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found. The MCP endpoint is /mcp.');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. This server is stateless; use POST.' }, id: null }));
      return;
    }
    try {
      const body = await readBody(req);
      const server = createAnchorlineServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: (err as Error).message }, id: null }));
    }
  });
  await new Promise<void>((resolve) => http.listen(port, host, resolve));
  process.stderr.write(`Anchorline MCP server on http://${host}:${port}/mcp (streamable HTTP, stateless)\n`);
}
