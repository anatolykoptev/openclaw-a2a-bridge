# openclaw-a2a-bridge — notes for coding agents

An OpenClaw plugin (one ES module, `index.js`, no dependencies) that bridges the A2A protocol to OpenClaw's chat completions endpoint and gives OpenClaw tools to call remote A2A agents. Usage and configuration: [README.md](README.md). All documents: [docs/INDEX.md](docs/INDEX.md).

## Layout

- `index.js` — the plugin: agent card route (`/.well-known/agent-card.json`, public), JSON-RPC route (`/a2a`, bearer auth), and the tools `a2a_call_remote`, `a2a_list_remote_agents`, `a2a_discover_remote`.
- `openclaw.plugin.json` — plugin manifest and config schema (`secret`, `agentName`, `agentDescription`, `remoteAgents`); `package.json` — metadata only.

## Gate

No CI and no test suite. Check a change with `node --check index.js` and, for behaviour, load the plugin in a local OpenClaw with the chat completions endpoint enabled, then call `/a2a` with a `message/send` request.

## Invariants

- Keep `openclaw.plugin.json` `configSchema` in step with the options `index.js` reads (`additionalProperties` is false, so an undeclared option is rejected).
- The agent card route is public by design; the `/a2a` route must stay behind the bearer check whenever `secret` is set. Keep the constant-time comparison.
- The `secret` and every `remoteAgents.<id>.token` are credentials: never log them or put real values in docs or examples.
- No operator-specific data (hosts, addresses, home paths, account names) in tracked files; this repository is public.
