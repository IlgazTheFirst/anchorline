import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  checksText,
  checkTrip,
  HONESTY_NOTE,
  InputError,
  listPlaces,
  placesText,
  planText,
  planTrip,
  previewChange,
  previewText,
  shareExport,
} from '../application/api';
import { exportBackup } from '../application/transfer';
import { PACKS } from '../catalogue';
import { PRESETS } from '../domain/presets';

declare const __ANCHORLINE_VERSION__: string;
const VERSION = typeof __ANCHORLINE_VERSION__ === 'string' ? __ANCHORLINE_VERSION__ : '0.0.0-dev';
const PACK = PACKS[0]!;

const HELP = `anchorline ${VERSION}: plan around what can't move.

Usage
  anchorline places [--country <name>] [--json]
  anchorline plan [spec.json | -] [flags] [--json] [--out trip.json]
  anchorline check <trip.json | -> [--json] [--strict]
  anchorline preview <trip.json> <change.json | -> [--json] [--as-user]
  anchorline apply <trip.json> <change.json> --out <next.json> [--as-user]
  anchorline export <trip.json> --share [--omit-dates] [--omit-accommodation | --keep-accommodation] [--omit-costs]
  anchorline mcp [--http <port>] [--host <address>]

Plan flags (build or override a trip spec)
  --title <text>            --from <city>        --tz <IANA zone>
  --depart <YYYY-MM-DD>     --first-night <date> --nights <n> | --leave <date>
  --home-by <YYYY-MM-DDTHH:MM, home time>
  --must <place[:nights]>   (repeatable)         --avoid <place> (repeatable)
  --beach-nights <n>        --beach-days <n>
  --preset <${PRESETS.map((p) => p.id).join('|')}>
  --pace <slow|balanced|fast>  --travellers <n>  --rooms <n>  --quiet-evenings  --family

Change files hold one command, an array of commands, or {"label", "commands"}.
Changes are untrusted suggestions by default: they cannot record bookings,
quotes or checked timetables, unlock fields or drop hard commitments.
--as-user marks them as coming from you.

Exit codes: 0 ok, 1 bad input, 2 plan infeasible / check --strict found a broken commitment.
${HONESTY_NOTE}`;

class UsageError extends Error {}

function readInput(path: string | undefined): unknown {
  if (!path) throw new UsageError('Missing file argument.');
  const text = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new InputError(`${path === '-' ? 'stdin' : path} is not valid JSON.`);
  }
}

function print(json: boolean, data: unknown, text: string) {
  process.stdout.write(json ? `${JSON.stringify(data, null, 2)}\n` : `${text}\n`);
}

function specFromFlags(values: Record<string, unknown>, base: Record<string, unknown>): Record<string, unknown> {
  const spec: Record<string, unknown> = { ...base };
  const str = (k: string) => (typeof values[k] === 'string' ? (values[k] as string) : undefined);
  const int = (k: string) => {
    const v = str(k);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n)) throw new UsageError(`--${k} must be a whole number.`);
    return n;
  };
  if (str('title')) spec.title = str('title');
  if (str('from') || str('tz')) {
    const home = (spec.home as Record<string, unknown> | undefined) ?? {};
    spec.home = { name: str('from') ?? home.name ?? 'Home', timeZone: str('tz') ?? home.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone };
  }
  if (str('depart')) spec.departureDate = str('depart');
  if (str('first-night')) spec.firstNight = str('first-night');
  if (int('nights') !== undefined) spec.nights = int('nights');
  if (str('leave')) spec.leaveDate = str('leave');
  if (str('home-by')) spec.homeBy = str('home-by');
  if (str('preset')) spec.preset = str('preset');
  if (str('pace')) spec.pace = str('pace');
  if (int('travellers') !== undefined) spec.travellers = int('travellers');
  if (int('rooms') !== undefined) spec.rooms = int('rooms');
  if (int('beach-nights') !== undefined) spec.beachNights = int('beach-nights');
  if (int('beach-days') !== undefined) spec.beachDays = int('beach-days');
  if (values['quiet-evenings']) spec.quietEvenings = true;
  if (values.family) spec.family = true;
  const must = (values.must as string[] | undefined) ?? [];
  if (must.length) {
    spec.mustVisit = [
      ...((spec.mustVisit as unknown[]) ?? []),
      ...must.map((m) => {
        const [place, nights] = m.split(':');
        return nights ? { place, minNights: Number(nights) } : { place };
      }),
    ];
  }
  const avoid = (values.avoid as string[] | undefined) ?? [];
  if (avoid.length) spec.avoid = [...((spec.avoid as unknown[]) ?? []), ...avoid];
  if (!spec.home) spec.home = { name: 'Home', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  return spec;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: 'boolean' },
      out: { type: 'string' },
      strict: { type: 'boolean' },
      'as-user': { type: 'boolean' },
      share: { type: 'boolean' },
      'omit-dates': { type: 'boolean' },
      'omit-accommodation': { type: 'boolean' },
      'keep-accommodation': { type: 'boolean' },
      'omit-costs': { type: 'boolean' },
      country: { type: 'string' },
      http: { type: 'string' },
      host: { type: 'string' },
      title: { type: 'string' },
      from: { type: 'string' },
      tz: { type: 'string' },
      depart: { type: 'string' },
      'first-night': { type: 'string' },
      nights: { type: 'string' },
      leave: { type: 'string' },
      'home-by': { type: 'string' },
      must: { type: 'string', multiple: true },
      avoid: { type: 'string', multiple: true },
      'beach-nights': { type: 'string' },
      'beach-days': { type: 'string' },
      preset: { type: 'string' },
      pace: { type: 'string' },
      travellers: { type: 'string' },
      rooms: { type: 'string' },
      'quiet-evenings': { type: 'boolean' },
      family: { type: 'boolean' },
    },
  });
  const json = Boolean(values.json);
  switch (command) {
    case 'places': {
      const out = listPlaces(PACK, values.country);
      print(json, out, placesText(out));
      return 0;
    }
    case 'plan': {
      const fromFile = positionals[0] ? (readInput(positionals[0]) as Record<string, unknown>) : !process.stdin.isTTY && !values.depart ? (readInput('-') as Record<string, unknown>) : {};
      const isTrip = 'schemaVersion' in fromFile || 'trip' in fromFile || 'document' in fromFile;
      const input = isTrip ? fromFile : specFromFlags(values, fromFile);
      const out = planTrip(input, PACK);
      if (values.out && out.trip && out.status === 'ok') writeFileSync(values.out, exportBackup(out.trip, null));
      print(json, out, planText(out) + (values.out && out.status === 'ok' ? `\n\nSaved the trip to ${values.out} (a private backup the browser app can import).` : ''));
      return out.status === 'ok' ? 0 : out.status === 'infeasible' ? 2 : 1;
    }
    case 'check': {
      const out = checkTrip(readInput(positionals[0]));
      print(json, out, `${out.title} (revision ${out.revision}, ${out.nights} nights)\n${checksText(out)}`);
      return values.strict && out.counts.violated > 0 ? 2 : 0;
    }
    case 'preview':
    case 'apply': {
      if (positionals.length < 2) throw new UsageError(`${command} needs a trip file and a change file.`);
      if (command === 'apply' && !values.out) throw new UsageError('apply needs --out <file>; it never overwrites your trip.');
      const out = previewChange(readInput(positionals[0]), readInput(positionals[1]), { actor: values['as-user'] ? 'user' : 'untrusted_proposal' });
      if (command === 'apply') {
        if (!out.canApply || !out.next) {
          print(json, out, `${previewText(out)}\n\nNot applied.`);
          return 1;
        }
        writeFileSync(values.out!, exportBackup(out.next, null));
        print(json, out, `${previewText(out)}\n\nApplied. Wrote revision ${out.next.revision} to ${values.out}.`);
        return 0;
      }
      print(json, { ...out, next: undefined }, previewText(out));
      return out.status === 'invalid' ? 1 : 0;
    }
    case 'export': {
      if (!values.share) throw new UsageError('export needs --share (a private backup is the trip file itself).');
      const share = shareExport(readInput(positionals[0]), {
        omitExactDates: values['omit-dates'],
        omitAccommodation: values['keep-accommodation'] ? false : true,
        omitCosts: values['omit-costs'],
      });
      process.stdout.write(`${JSON.stringify(share, null, 2)}\n`);
      return 0;
    }
    case 'mcp': {
      const { runHttp, runStdio } = await import('../mcp/server');
      if (values.http) {
        const port = Number(values.http);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError('--http needs a port number.');
        await runHttp(port, values.host ?? '127.0.0.1');
      } else await runStdio();
      return -1;
    }
    default:
      throw new UsageError(`Unknown command "${command}". Run anchorline --help.`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const usage = err instanceof UsageError || (err as { code?: string })?.code?.startsWith?.('ERR_PARSE_ARGS');
    process.stderr.write(`anchorline: ${message}${usage ? '\nRun anchorline --help for usage.' : ''}\n`);
    process.exitCode = 1;
  },
);

