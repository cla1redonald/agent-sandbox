#!/usr/bin/env -S tsx
/**
 * Model router proxy — PHASE 2: decider wired in (immediate switch, no hysteresis).
 *
 * An OpenAI-compatible endpoint that pi points at instead of Ollama. It classifies
 * each request (override → heuristic → llama3.1:8b) and forwards to the coder or
 * the thinker, relaying the response stream verbatim.
 *
 * Runs on the HOST (trusted infra, like Ollama itself) — not inside nono.
 *   tsx router/server.ts        # then: curl localhost:11500/health
 *
 * Phase 3 adds hysteresis + the thinker wall-clock leash; Phase 4 the pi-safe
 * auto-spawn + nono profile. See docs/router-plan.md.
 */
import { createServer, type IncomingMessage } from "node:http";
import { decide, type Route } from "./decide.ts";

const PORT = Number(process.env.ROUTER_PORT ?? 11500);
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL: Record<Route, string> = {
  coder: "qwen3-coder-64k",
  thinker: "qwen3.6-64k",
};

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// last user turn — what the decider classifies on
function lastUserMessage(body: any): string {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role === "user") {
      const c = msgs[i].content;
      return typeof c === "string" ? c : JSON.stringify(c);
    }
  }
  return "";
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", phase: 2, models: MODEL }));
      return;
    }

    if (req.method === "POST" && (req.url ?? "").startsWith("/v1/chat/completions")) {
      const raw = await readBody(req);
      let body: any = {};
      try { body = JSON.parse(raw); } catch { /* forward as-is below */ }
      const requested = body.model ?? "(none)";

      const { route, reason } = await decide(lastUserMessage(body));
      body.model = MODEL[route];
      body.think = route === "thinker"; // thinker reasons; coder stays direct

      const upstream = await fetch(`${OLLAMA}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      res.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      });
      if (upstream.body) {
        const reader = upstream.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value); // relay bytes verbatim (works for SSE and plain JSON)
        }
      }
      res.end();
      process.stderr.write(
        `[router] ${requested} -> ${route}/${body.model} (${reason}) | stream=${!!body.stream} | ${upstream.status}\n`,
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (e: any) {
    process.stderr.write(`[router] ERROR ${e?.message}\n`);
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "router upstream error", detail: e?.message }));
  }
});

server.listen(PORT, "127.0.0.1", () =>
  process.stderr.write(
    `[router] listening on http://127.0.0.1:${PORT} (phase 2: coder=${MODEL.coder} thinker=${MODEL.thinker})\n`,
  ),
);
