# Claude Code

## Plugin (skill + MCP server)

In Claude Code:

```text
/plugin marketplace add IlgazTheFirst/anchorline
/plugin install anchorline@anchorline
```

Or from your shell:

```bash
claude plugin marketplace add IlgazTheFirst/anchorline
claude plugin install anchorline@anchorline
```

This adds:

- the **anchorline** skill, which Claude loads when you ask for a constrained trip plan; you can also run it as `/anchorline:anchorline`;
- the **anchorline** MCP server, with the tools `list_places`, `plan_trip`, `check_trip`, `preview_change` and `share_export`. The server runs locally with `node`, offline.

Requires Node.js 20 or newer on your PATH.

Try: *"Plan 14 nights from London leaving 1 Feb 2031, at least 3 nights in Chiang Mai, 5 beach nights in a row, home by 16 Feb 23:00."*

## Skill only

Copy the self-contained skill folder into your personal skills directory:

```bash
git clone https://github.com/IlgazTheFirst/anchorline
mkdir -p ~/.claude/skills && cp -r anchorline/skills/anchorline ~/.claude/skills/
```

The folder holds `SKILL.md`, a command reference and `scripts/anchorline.mjs`, the bundled CLI. For claude.ai or the Claude API, zip `skills/anchorline` and upload it as a custom skill. It needs code execution with Node.js 20+.

## MCP server only

```bash
claude mcp add --transport stdio anchorline -- node /path/to/anchorline/skills/anchorline/scripts/anchorline.mjs mcp
```

Once the package is on npm, `npx -y anchorline mcp` will work in place of the path.

## Tested

On 31 October 2026, with Claude Code 2.1.314 and a throwaway config directory (`CLAUDE_CONFIG_DIR`):

- `claude plugin validate .` passed;
- `claude plugin marketplace add` (local path) and `claude plugin install anchorline@anchorline` succeeded;
- `claude plugin details anchorline` listed 1 skill and 1 MCP server;
- `claude mcp list` reported the plugin's server **Connected**.

The MCP tools themselves are covered by automated tests (`tests/cli/mcp.test.ts`) using the official SDK client over stdio and HTTP. Adding the marketplace from GitHub, and claude.ai/API skill uploads, were not run.
