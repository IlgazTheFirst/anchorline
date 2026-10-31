# Integrations

Anchorline is one engine with several front doors. Each one uses the same code in `src/domain` and `src/planner`, and the same honesty rules: planning estimates are labelled, sources are cited, and nothing is booked, priced or timetabled unless the person records it.

| Surface | Guide | How it runs |
|---|---|---|
| Browser | [README](../README.md#quickstart) | Static web app, IndexedDB, works offline |
| Terminal | [README](../README.md#terminal) | `anchorline` CLI, one bundled file, Node 20+ |
| Claude Code plugin | [claude-code.md](claude-code.md) | Skill + local MCP server from this repo's marketplace |
| Claude skill (Claude Code, claude.ai, API) | [claude-code.md](claude-code.md#skill-only) | `skills/anchorline/`, self-contained |
| Claude Desktop | [claude-desktop.md](claude-desktop.md) | Local MCP server over stdio |
| ChatGPT | [chatgpt.md](chatgpt.md) | MCP server over streamable HTTP behind your own HTTPS URL |

See each guide's "Tested" note for what was actually run.
