#!/usr/bin/env -S tsx
/**
 * Model router proxy — PHASE 1: streaming pass-through (no routing yet).
 *
 * An OpenAI-compatible endpoint that pi points at instead of Ollama. For now it
 * forwards EVERY request to the coder and relays the response stream verbatim —
 * the point of Phase 1 is to prove the streaming bridge end-to-end before any
 * routing logic goes on top (Phase 2+).
 *
 * Runs on the HOST (trusted infra, like Ollama itself) — not inside nono.
 *   tsx router/server.ts        # then: curl localhost:11500/health
 *
 * Phase 2 adds the decider; Phase 3 hysteresis + thinker leash; Phase 4 the
 * pi-safe auto-spawn + nono profile. See docs/router-plan.md.
 */
import { createServer, type IncomingMessage } from "node:http";

const PORT = Number(process.env.ROUTER_PORT ?? 11500);
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const CODER = "qwen3-coder-64k"; // Phase 1: everything goes here

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", phase: 1, routesTo: CODER }));
      return;
    }

    if (req.method === "POST" && (req.url ?? "").startsWith("/v1/chat/completions")) {
      const raw = await readBody(req);
      let body: any = {};
      try { body = JSON.parse(raw); } catch { /* forward as-is below */ }
      const requested = body.model ?? "(none)";
      body.model = CODER; // Phase 1: no routing — always the coder

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
        `[router] ${requested} -> ${CODER} | stream=${!!body.stream} | ${upstream.status}\n`,
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
  process.stderr.write(`[router] listening on http://127.0.0.1:${PORT} (phase 1: pass-through -> ${CODER})\n`),
);
