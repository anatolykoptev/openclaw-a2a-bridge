# A2A Bridge for OpenClaw

Bridges the standard [A2A protocol](https://google.github.io/A2A/) (Agent-to-Agent) to OpenClaw's internal chat completions endpoint. Enables bidirectional A2A communication between OpenClaw and external agents.

## What it does

- **Serves an agent card** at `/.well-known/agent-card.json` so external A2A agents can discover your OpenClaw instance
- **Handles inbound A2A requests** at `/a2a` — external agents call OpenClaw via standard JSON-RPC `message/send`
- **Provides tools for outbound calls** — OpenClaw can call remote A2A agents using `a2a_call_remote`

```
External Agent                        OpenClaw (:18789)
├── a2a_call("krolik")   ──────→      ├── a2a-bridge plugin
│                                     │   ├── /.well-known/agent-card.json
│                                     │   ├── /a2a (JSON-RPC)
│                                     │   └── → /v1/chat/completions
│                        ←──────      │
├── A2A Server           ←──────      ├── a2a_call_remote tool
```

## Prerequisites

- OpenClaw with the chat completions HTTP endpoint enabled:
  ```json
  {
    "gateway": {
      "http": {
        "endpoints": {
          "chatCompletions": { "enabled": true }
        }
      }
    }
  }
  ```

## Installation

Clone the plugin into your OpenClaw extensions directory:

```bash
cd ~/.openclaw/extensions
git clone https://github.com/anatolykoptev/openclaw-a2a-bridge a2a-bridge
```

Then register it in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["a2a-bridge"],
    "entries": {
      "a2a-bridge": {
        "enabled": true,
        "config": {
          "secret": "your-bearer-token-here",
          "remoteAgents": {
            "example-agent": {
              "url": "http://127.0.0.1:9000",
              "token": "remote-agent-token",
              "alias": "Example Agent"
            }
          }
        }
      }
    }
  }
}
```

Restart OpenClaw to load the plugin.

## Configuration

| Field | Type | Description |
|-------|------|-------------|
| `secret` | `string` | Bearer token for authenticating inbound A2A requests. Leave empty to disable auth. |
| `remoteAgents` | `object` | Map of remote A2A agents keyed by ID. |
| `remoteAgents.<id>.url` | `string` | Base URL of the remote agent (required). |
| `remoteAgents.<id>.token` | `string` | Bearer token for calling the remote agent. |
| `remoteAgents.<id>.alias` | `string` | Human-readable name for the agent. |

### Agent card customization

The agent card served at `/.well-known/agent-card.json` uses the agent name from OpenClaw config. The card advertises:

- Protocol version: `0.3.0`
- Transport: JSON-RPC (non-streaming)
- Security: Bearer token (when `secret` is set)

## Tools

The plugin registers three tools:

### `a2a_call_remote`

Send a message to a remote A2A agent and get a response.

| Parameter | Type | Description |
|-----------|------|-------------|
| `agent` | `string` | Remote agent ID (from `remoteAgents` config) |
| `message` | `string` | Message to send |

### `a2a_list_remote_agents`

List all configured remote A2A agents. No parameters.

### `a2a_discover_remote`

Fetch the agent card (capabilities, skills) of a remote A2A agent.

| Parameter | Type | Description |
|-----------|------|-------------|
| `agent` | `string` | Remote agent ID |

## A2A Protocol Details

### Inbound (external agent calls OpenClaw)

The plugin handles `message/send` JSON-RPC method:

```json
{
  "jsonrpc": "2.0",
  "method": "message/send",
  "id": 1,
  "params": {
    "message": {
      "messageId": "uuid",
      "role": "user",
      "parts": [{ "kind": "text", "text": "Hello" }]
    }
  }
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "id": "task-uuid",
    "contextId": "context-uuid",
    "status": { "state": "completed" },
    "artifacts": [
      { "parts": [{ "kind": "text", "text": "Response from OpenClaw" }] }
    ]
  }
}
```

### Authentication

Inbound requests are authenticated via `Authorization: Bearer <token>` header (or `X-Webhook-Secret` for compatibility). The token is compared against the configured `secret` using constant-time comparison.

## License

MIT
