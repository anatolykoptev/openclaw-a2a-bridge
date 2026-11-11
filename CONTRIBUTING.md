# Contributing

Issues and pull requests are welcome.

## Build and test

There is no build step and no dependencies; the plugin is a single ES module for Node.js. There is no test suite or CI, so check your change by hand:

```sh
node --check index.js
```

To try it end to end, clone the repository into an OpenClaw extensions directory, register it as described in the [README](README.md), enable the chat completions endpoint, and send a `message/send` JSON-RPC request to `/a2a`.

## Commits and pull requests

- Use Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`).
- Keep one concern per pull request and say how you checked it.
- When you add a configuration option, add it to `openclaw.plugin.json` and to the README table.
- Do not commit tokens, host names, addresses or local paths.
