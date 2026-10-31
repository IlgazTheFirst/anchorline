# Claude Desktop (MCP)

Claude Desktop starts local MCP servers from its config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

1. Get the bundled server. It is a single file and needs Node.js 20+:

   ```bash
   git clone https://github.com/IlgazTheFirst/anchorline
   ```

2. Add it to the config. Use the absolute path to your clone:

   ```json
   {
     "mcpServers": {
       "anchorline": {
         "command": "node",
         "args": ["/absolute/path/to/anchorline/skills/anchorline/scripts/anchorline.mjs", "mcp"]
       }
     }
   }
   ```

   After the package is published to npm, this also works:

   ```json
   { "mcpServers": { "anchorline": { "command": "npx", "args": ["-y", "anchorline", "mcp"] } } }
   ```

3. Restart Claude Desktop. The tools `list_places`, `plan_trip`, `check_trip`, `preview_change` and `share_export` appear under the anchorline server.

All tools are read-only and run offline. `preview_change` treats every change as a suggestion: it refuses bookings, quotes, checked timetables, unlocking and removing hard commitments.

## Tested

The server is tested automatically over stdio with the official MCP SDK client (`tests/cli/mcp.test.ts`), and Claude Code connected to it (see [claude-code.md](claude-code.md#tested)). Claude Desktop itself was **not** run.
