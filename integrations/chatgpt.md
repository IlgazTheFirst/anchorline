# ChatGPT

ChatGPT can use Anchorline as a custom connector through **developer mode**. ChatGPT connects to remote MCP servers only, so it needs a public **HTTPS** URL. Anchorline runs as a local streamable-HTTP server; making it reachable is a hosting decision for you.

## 1. Run the server

```bash
git clone https://github.com/IlgazTheFirst/anchorline
node anchorline/skills/anchorline/scripts/anchorline.mjs mcp --http 8787
# Anchorline MCP server on http://127.0.0.1:8787/mcp (streamable HTTP, stateless)
```

- Endpoint: `POST /mcp` (stateless; no sessions). Health check: `GET /health`.
- It binds to `127.0.0.1` by default. Use `--host 0.0.0.0` only behind a proxy you control.

## 2. Give it an HTTPS URL

Any of these works. Choose one; nothing here is set up for you:

- a tunnel from your machine to a public HTTPS address (Cloudflare Tunnel, ngrok, Tailscale Funnel or similar), pointed at `http://127.0.0.1:8787`;
- a small server or container you host, with TLS from a reverse proxy.

The server has **no authentication**. All its tools are read-only and stateless, and it stores nothing. Still, anyone with the URL can call it, so don't leave a public URL running unattended. Put authentication in your proxy if you host it long-term.

## 3. Connect ChatGPT

In ChatGPT, turn on developer mode (in the connector / apps settings, under advanced options), create a custom connector, and enter your HTTPS URL ending in `/mcp`, for example `https://your-host.example/mcp`, with no authentication. Menu names change; follow OpenAI's current help pages for developer mode.

Then ask: *"Use Anchorline to plan 12 nights from London leaving 1 Feb 2031, 4 beach nights in a row, home by 14 Feb 23:00."*

## Custom GPT

Custom GPTs call REST "Actions", not MCP servers, so they can't use this server directly. [chatgpt-custom-gpt-instructions.md](chatgpt-custom-gpt-instructions.md) is an instruction set for a GPT that applies Anchorline's rules. When the Anchorline connector is available it uses it; otherwise it writes trip specs and change commands for you to run with the CLI or import into the web app.

## Tested

The streamable-HTTP transport is tested automatically on `127.0.0.1` with the official MCP SDK client (`tests/cli/mcp.test.ts`): tool listing and calls over `/mcp`. **ChatGPT itself was not tested.** No public URL was created, and neither developer mode nor a Custom GPT was set up.
