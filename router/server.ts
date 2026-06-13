#!/usr/bin/env -S tsx
/**
 * Model router proxy — PHASE 3: decider + hysteresis + thinker leash.
 *
 * OpenAI-compatible endpoint pi points at instead of Ollama. Per request it
 *   1. classifies (decide: override → heuristic → llama3.1:8b),
 *   2. applies hysteresis (resist the ~20s coder↔thinker reload), then
 *   3. forwards, relaying the stream — with a wall-clock LEASH on the thinker:
 *      qwen3.6 streams thinking in a separate `reasoning` field (content stays
 *      ""), so thinker output is buffered until the first real `content` token.
 *      If the leash fires before any content (runaway thinking), we abort and
 *      fall back to the coder with a clean answer; otherwise flush + stream live.
 *
 * Runs on the HOST (trusted infra, like Ollama) — not inside nono.
 *   tsx router/server.ts        # then: curl localhost:11500/health
 *
 * Phase 4: pi-safe auto-spawn + nono profile. See docs/router-plan.md.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { decide, type Route } from "./decide.ts";
import { Hysteresis } from "./hysteresis.ts";

const PORT = Number(process.env.ROUTER_PORT ?? 11500);
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const THINKER_LEASH_MS = Number(process.env.THINKER_LEASH_MS ?? 180_000); // genuine thinker task
const HELD_LEASH_MS = Number(process.env.HELD_LEASH_MS ?? 30_000); // coder task held on thinker — should be quick
const MODEL: Record<Route, string> = { coder: "qwen3-coder-64k", thinker: "qwen3.6-64k" };

const hyst = new Hysteresis("coder");

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

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

// non-empty `"content":"…"` in a chunk = the answer has started (vs reasoning, which
// carries `"content":""`). Lets the thinker leash distinguish "thinking" from "answering".
const CONTENT_STARTED = /"content":"(?!")/;

/**
 * Forward to one model, relaying the stream. For the thinker, buffer until the
 * first real content so a runaway (leash trip before any answer) can fall back
 * to the coder cleanly. Returns true if it handled the response.
 */
async function forward(
  model: Route,
  body: any,
  res: ServerResponse,
  allowFallback: boolean,
  leashMs: number,
): Promise<Route> {
  const isThinker = model === "thinker";
  body.model = MODEL[model];
  body.think = isThinker;

  const ac = new AbortController();
  const timer = isThinker ? setTimeout(() => ac.abort(), leashMs) : null;

  let upstream: Response;
  try {
    upstream = await fetch(`${OLLAMA}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    if (isThinker && allowFallback && !res.headersSent) {
      process.stderr.write(`[router] thinker unavailable -> fallback to coder\n`);
      return forward("coder", body, res, false, 0); // coder has no leash
    }
    throw e;
  }

  const ct = upstream.headers.get("content-type") ?? "application/json";
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  const held: Uint8Array[] = []; // thinker bytes buffered before first content
  let textSoFar = "";
  let started = false; // have we begun writing to the client?

  const begin = () => {
    if (!started) { res.writeHead(upstream.status, { "content-type": ct }); started = true; }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!isThinker) { begin(); res.write(value); continue; }

      if (started) { res.write(value); continue; }
      // thinker, pre-content: hold bytes, watch for the answer to start
      held.push(value);
      textSoFar += decoder.decode(value, { stream: true });
      if (CONTENT_STARTED.test(textSoFar)) {
        begin();
        for (const b of held) res.write(b); // flush reasoning + first content, then go live
        held.length = 0;
      }
    }
  } catch {
    // aborted (leash) or upstream error
    if (timer) clearTimeout(timer);
    if (isThinker && allowFallback && !started) {
      process.stderr.write(`[router] thinker leashed before answer -> fallback to coder\n`);
      return forward("coder", body, res, false, 0); // clean fallback: nothing sent yet
    }
    if (started) { res.end(); return model; } // already streaming; just close
  }
  if (timer) clearTimeout(timer);

  // stream ended with no content at all (e.g. thinker spent its budget thinking)
  if (isThinker && !started && allowFallback) {
    process.stderr.write(`[router] thinker produced no answer -> fallback to coder\n`);
    return forward("coder", body, res, false, 0);
  }
  begin();
  res.end();
  return model;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", phase: 3, loaded: hyst.loaded, models: MODEL }));
      return;
    }

    if (req.method === "POST" && (req.url ?? "").startsWith("/v1/chat/completions")) {
      const raw = await readBody(req);
      let body: any = {};
      try { body = JSON.parse(raw); } catch { /* forward as-is */ }
      const requested = body.model ?? "(none)";

      const dec = await decide(lastUserMessage(body));
      const sw = hyst.next(dec.route, dec.reason === "override");
      // shorter leash when a coder-classified task is merely being HELD on the
      // thinker — it shouldn't be thinking long, so fall back fast if it runs away.
      const held = sw.model === "thinker" && dec.route === "coder";
      const leashMs = held ? HELD_LEASH_MS : THINKER_LEASH_MS;
      process.stderr.write(
        `[router] ${requested} -> ${sw.model}/${MODEL[sw.model]} | decide=${dec.route}(${dec.reason}) | ${sw.note}${sw.switched ? " | RELOAD" : ""}${held ? ` | held-leash ${leashMs / 1000}s` : ""} | stream=${!!body.stream}\n`,
      );

      const used = await forward(sw.model, body, res, true, leashMs);
      if (used !== sw.model) hyst.setLoaded(used); // reconcile after a leash fallback
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
    `[router] listening on http://127.0.0.1:${PORT} (phase 3: coder=${MODEL.coder} thinker=${MODEL.thinker}, leash ${THINKER_LEASH_MS / 1000}s)\n`,
  ),
);
