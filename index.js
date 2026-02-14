/**
 * A2A Bridge Plugin for OpenClaw
 *
 * Bridges the standard A2A protocol (agent card + JSON-RPC) to OpenClaw's
 * internal chat completions endpoint. Enables bidirectional A2A communication
 * between OpenClaw and external agents (e.g., Vaelor).
 *
 * Components:
 *   A. Agent card at /.well-known/agent-card.json (public, no auth)
 *   B. A2A JSON-RPC handler at /a2a (Bearer token auth)
 *   C. a2a_call_remote tool for calling external A2A agents
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const json = (payload) => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

function getGatewayPort(api) {
  return api.config?.gateway?.port ?? 18789;
}

function getGatewayToken(api) {
  return api.config?.gateway?.auth?.token ?? "";
}

/** Read full request body as string */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Send JSON response */
function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------

function buildAgentCard(port) {
  return {
    name: "Krolik",
    description:
      "AI assistant with access to tools, memory, web search, code execution, and multi-agent coordination.",
    url: `http://127.0.0.1:${port}/a2a`,
    preferredTransport: "JSONRPC",
    protocolVersion: "0.3.0",
    capabilities: { streaming: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "general",
        name: "General Assistant",
        description: "Answer questions, execute tasks, search the web, manage memory",
      },
    ],
    securitySchemes: {
      bearer: { type: "http", scheme: "bearer" },
    },
    security: [{ bearer: [] }],
  };
}

// ---------------------------------------------------------------------------
// A2A JSON-RPC → Chat Completions bridge
// ---------------------------------------------------------------------------

async function handleMessageSend(params, port, gatewayToken, logger) {
  // Extract user text from A2A message
  const message = params?.message;
  if (!message || !message.parts) {
    return { error: { code: -32602, message: "Invalid params: missing message.parts" } };
  }

  const textParts = message.parts
    .filter((p) => p.kind === "text" && typeof p.text === "string")
    .map((p) => p.text);

  const userText = textParts.join("\n");
  if (!userText.trim()) {
    return { error: { code: -32602, message: "Invalid params: empty message text" } };
  }

  // Call OpenClaw's chat completions endpoint
  const url = `http://127.0.0.1:${port}/v1/chat/completions`;
  const body = {
    model: "openclaw",
    stream: false,
    messages: [{ role: "user", content: userText }],
  };

  logger.info(`A2A bridge: forwarding message to chat completions (${userText.length} chars)`);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${gatewayToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    logger.error(`A2A bridge: chat completions returned ${resp.status}: ${errText}`);
    return {
      error: { code: -32603, message: `Internal error: upstream returned ${resp.status}` },
    };
  }

  const completion = await resp.json();
  const content = completion?.choices?.[0]?.message?.content ?? "No response.";

  // Build A2A Task response
  const taskId = randomUUID();
  const contextId = randomUUID();

  return {
    result: {
      id: taskId,
      contextId,
      status: { state: "completed" },
      artifacts: [
        {
          parts: [{ kind: "text", text: content }],
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Remote A2A client (for calling external agents)
// ---------------------------------------------------------------------------

async function fetchAgentCard(baseUrl) {
  const cardUrl = baseUrl.replace(/\/+$/, "") + "/.well-known/agent-card.json";
  const resp = await fetch(cardUrl, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) {
    throw new Error(`Failed to fetch agent card from ${cardUrl}: ${resp.status}`);
  }
  return resp.json();
}

async function callRemoteAgent(agentUrl, token, message) {
  const rpcBody = {
    jsonrpc: "2.0",
    method: "message/send",
    id: 1,
    params: {
      message: {
        messageId: randomUUID(),
        role: "user",
        parts: [{ kind: "text", text: message }],
      },
    },
  };

  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const resp = await fetch(agentUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(rpcBody),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`A2A call failed (${resp.status}): ${errText}`);
  }

  const rpcResp = await resp.json();

  if (rpcResp.error) {
    throw new Error(`A2A JSON-RPC error: ${rpcResp.error.message} (${rpcResp.error.code})`);
  }

  // Extract text from result (Task or Message)
  const result = rpcResp.result;
  if (!result) return "No result returned.";

  // Task with artifacts
  if (result.artifacts) {
    const texts = [];
    for (const art of result.artifacts) {
      for (const part of art.parts ?? []) {
        if (part.kind === "text" && part.text) texts.push(part.text);
      }
    }
    if (texts.length > 0) return texts.join("\n\n");
  }

  // Message with parts
  if (result.parts) {
    const texts = [];
    for (const part of result.parts) {
      if (part.kind === "text" && part.text) texts.push(part.text);
    }
    if (texts.length > 0) return texts.join("\n");
  }

  // History fallback
  if (result.history?.length > 0) {
    const last = result.history[result.history.length - 1];
    if (last.role === "agent" && last.parts) {
      return last.parts
        .filter((p) => p.kind === "text")
        .map((p) => p.text)
        .join("\n");
    }
  }

  return `Task ${result.id ?? "?"} completed (status: ${result.status?.state ?? "unknown"})`;
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

const a2aBridgePlugin = {
  id: "a2a-bridge",
  name: "A2A Bridge",
  description:
    "Standard A2A protocol bridge for OpenClaw — agent card, JSON-RPC endpoint, and remote agent calling",

  register(api) {
    const logger = api.logger;
    const pluginConfig = api.pluginConfig ?? {};
    const secret = pluginConfig.secret ?? "";
    const remoteAgents = pluginConfig.remoteAgents ?? {};
    const port = getGatewayPort(api);
    const gatewayToken = getGatewayToken(api);

    // -----------------------------------------------------------------------
    // A. Agent card route (public, no auth)
    // -----------------------------------------------------------------------
    const agentCard = buildAgentCard(port);

    api.registerHttpRoute({
      path: "/.well-known/agent-card.json",
      handler: (_req, res) => {
        sendJson(res, 200, agentCard);
      },
    });

    // -----------------------------------------------------------------------
    // B. A2A JSON-RPC handler
    // -----------------------------------------------------------------------
    api.registerHttpRoute({
      path: "/a2a",
      handler: async (req, res) => {
        // Auth check
        if (secret) {
          const authHeader = req.headers["authorization"] ?? "";
          const token = authHeader.startsWith("Bearer ")
            ? authHeader.slice(7).trim()
            : "";

          // Also check X-Webhook-Secret for compat
          const webhookSecret = req.headers["x-webhook-secret"] ?? "";

          let authorized = false;
          if (token && token.length === secret.length) {
            let diff = 0;
            for (let i = 0; i < token.length; i++) {
              diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
            }
            authorized = diff === 0;
          }
          if (!authorized && webhookSecret && webhookSecret.length === secret.length) {
            let diff = 0;
            for (let i = 0; i < webhookSecret.length; i++) {
              diff |= webhookSecret.charCodeAt(i) ^ secret.charCodeAt(i);
            }
            authorized = diff === 0;
          }

          if (!authorized) {
            sendJson(res, 401, {
              jsonrpc: "2.0",
              error: { code: -32000, message: "Unauthorized" },
              id: null,
            });
            return;
          }
        }

        // Only accept POST
        if (req.method !== "POST") {
          sendJson(res, 405, {
            jsonrpc: "2.0",
            error: { code: -32600, message: "Method not allowed, use POST" },
            id: null,
          });
          return;
        }

        // Parse JSON-RPC request
        let rpcReq;
        try {
          const bodyStr = await readBody(req);
          rpcReq = JSON.parse(bodyStr);
        } catch {
          sendJson(res, 400, {
            jsonrpc: "2.0",
            error: { code: -32700, message: "Parse error" },
            id: null,
          });
          return;
        }

        const { method, params, id } = rpcReq;

        if (method === "message/send") {
          const result = await handleMessageSend(params, port, gatewayToken, logger);
          if (result.error) {
            sendJson(res, 200, { jsonrpc: "2.0", error: result.error, id });
          } else {
            sendJson(res, 200, { jsonrpc: "2.0", result: result.result, id });
          }
          return;
        }

        // Unsupported method
        sendJson(res, 200, {
          jsonrpc: "2.0",
          error: { code: -32601, message: `Method not found: ${method}` },
          id,
        });
      },
    });

    // -----------------------------------------------------------------------
    // C. a2a_call_remote tool
    // -----------------------------------------------------------------------
    api.registerTool({
      name: "a2a_call_remote",
      description:
        "Send a message to a remote A2A agent and get a response. Use a2a_list_remote_agents to see available agents.",
      parameters: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: `Remote agent ID. Available: ${Object.keys(remoteAgents).join(", ") || "none"}`,
          },
          message: {
            type: "string",
            description: "Message to send to the remote agent",
          },
        },
        required: ["agent", "message"],
      },
      async execute(_id, params) {
        const agentId = params?.agent;
        const message = params?.message;

        if (!agentId || !message) {
          return json({ error: "Both 'agent' and 'message' are required" });
        }

        const agentConfig = remoteAgents[agentId];
        if (!agentConfig) {
          return json({
            error: `Unknown agent: ${agentId}. Available: ${Object.keys(remoteAgents).join(", ") || "none"}`,
          });
        }

        const baseUrl = agentConfig.url;
        if (!baseUrl) {
          return json({ error: `Agent ${agentId} has no URL configured` });
        }

        try {
          // Discover agent card to get the A2A endpoint URL
          const card = await fetchAgentCard(baseUrl);
          const a2aUrl = card.url || baseUrl.replace(/\/+$/, "") + "/a2a";
          const token = agentConfig.token ?? "";

          logger.info(`A2A calling remote agent "${agentId}" at ${a2aUrl}`);
          const response = await callRemoteAgent(a2aUrl, token, message);

          return json({
            agent: agentId,
            agentName: card.name ?? agentId,
            response,
          });
        } catch (err) {
          logger.error(`A2A call to ${agentId} failed: ${err.message}`);
          return json({ error: `A2A call to ${agentId} failed: ${err.message}` });
        }
      },
    });

    // a2a_list_remote_agents tool
    api.registerTool({
      name: "a2a_list_remote_agents",
      description: "List all configured remote A2A agents available for calling",
      parameters: { type: "object", properties: {} },
      async execute() {
        const agents = Object.entries(remoteAgents).map(([id, cfg]) => ({
          id,
          url: cfg.url,
          alias: cfg.alias ?? undefined,
        }));
        return json({ agents, count: agents.length });
      },
    });

    // a2a_discover_remote tool
    api.registerTool({
      name: "a2a_discover_remote",
      description: "Fetch the agent card (capabilities, skills) of a remote A2A agent",
      parameters: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: `Remote agent ID. Available: ${Object.keys(remoteAgents).join(", ") || "none"}`,
          },
        },
        required: ["agent"],
      },
      async execute(_id, params) {
        const agentId = params?.agent;
        const agentConfig = remoteAgents[agentId];
        if (!agentConfig) {
          return json({
            error: `Unknown agent: ${agentId}. Available: ${Object.keys(remoteAgents).join(", ") || "none"}`,
          });
        }

        try {
          const card = await fetchAgentCard(agentConfig.url);
          return json({ agent: agentId, card });
        } catch (err) {
          return json({ error: `Discovery failed for ${agentId}: ${err.message}` });
        }
      },
    });

    logger.info(
      `A2A Bridge: registered (agent card + /a2a endpoint + ${Object.keys(remoteAgents).length} remote agent(s): ${Object.keys(remoteAgents).join(", ") || "none"})`,
    );
  },
};

export default a2aBridgePlugin;
