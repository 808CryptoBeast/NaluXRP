// js/proxy-server.js (COMMONJS - STABLE)
// NaluXrp Local API Bridge (Unified)
// - CORS enabled for browser fetches
// - WebSocket request to rippled with timeout + id matching
// - Normalized /validators and /api/validators endpoints
// - Tokens proxy: /api/tokens
// - JSON-RPC bridge for Inspector deep-scan: POST / (and POST /rpc)
//   Accepts: { method: "account_tx", params: [ { ... } ] }
//
// Usage:
//   node js/proxy-server.js
//
// Front-end:
//   window.NALU_DEPLOYED_PROXY = "http://localhost:3000"

const express = require("express");
const cors = require("cors");
const WebSocket = require("ws");

const app = express();
const PORT = Number(process.env.PORT || process.env.NALU_PROXY_PORT || 3000);
const RIPPLE_WSS = String(process.env.RIPPLE_WSS || "wss://s1.ripple.com");

// Node 18+ has global fetch. If not present, fallback to node-fetch.
let _fetch = global.fetch;
async function getFetch() {
  if (_fetch) return _fetch;
  const mod = await import("node-fetch");
  _fetch = mod.default;
  return _fetch;
}

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// -------------------- WS REQUEST HELPER --------------------
function rippledRequest(commandObj, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RIPPLE_WSS);
    let settled = false;

    // Add a request id so we can match the response safely
    const id = Math.floor(Math.random() * 1e9);

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.terminate();
        } catch (_) {}
        reject(new Error("rippled request timed out"));
      }
    }, timeoutMs);

    function done(err, data) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch (_) {}
      if (err) reject(err);
      else resolve(data);
    }

    ws.on("open", () => {
      try {
        const payload =
          typeof commandObj === "string" ? { command: commandObj } : { ...(commandObj || {}) };

        // Ensure command exists
        if (!payload.command || typeof payload.command !== "string") {
          return done(new Error("Missing command for rippledRequest"));
        }

        payload.id = id;
        ws.send(JSON.stringify(payload));
      } catch (err) {
        done(err);
      }
    });

    ws.on("message", (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());

        // If response has an id, match it. If no id, accept (single request WS).
        if (parsed && parsed.id != null && parsed.id !== id) return;

        const result = parsed.result || parsed;
        done(null, result);
      } catch (err) {
        done(err);
      }
    });

    ws.on("error", (err) => {
      done(err);
    });

    ws.on("close", () => {
      if (!settled) done(new Error("rippled connection closed before response"));
    });
  });
}

// -------------------- SAFE JSON FETCH --------------------
async function safeFetchJson(url, options = {}) {
  const fetchFn = await getFetch();
  const resp = await fetchFn(url, options);
  const text = await resp.text();

  if (!resp.ok) {
    const preview = text ? text.slice(0, 200) : "";
    throw new Error(`HTTP ${resp.status} ${resp.statusText} :: ${preview}`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("Invalid JSON response from remote API");
  }
}

// -------------------- VALIDATORS (WS -> rippled) --------------------
async function handleValidators(_req, res) {
  try {
    const data = await rippledRequest({ command: "validators" }, 10000);

    // Normalize possible shapes to an array of validators
    let validators = [];
    if (data && Array.isArray(data.validators)) validators = data.validators;
    else if (data && Array.isArray(data.validator_list)) validators = data.validator_list;
    else {
      const arr = Object.values(data || {}).find((v) => Array.isArray(v));
      if (arr) validators = arr;
    }

    if (!Array.isArray(validators)) {
      console.warn("Proxy: unexpected validators response shape", {
        preview: JSON.stringify(data).slice(0, 500)
      });
      return res.status(502).json({ error: "Invalid validators format from rippled", validators: [] });
    }

    res.json({ validators });
  } catch (err) {
    console.error("Validator fetch error:", err && err.message ? err.message : err);
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
}

app.get("/validators", handleValidators);
app.get("/api/validators", handleValidators);

// -------------------- TOKENS (HTTP -> XRPL.to) --------------------
app.get("/api/tokens", async (_req, res) => {
  const url = "https://api.xrpl.to/api/tokens/top";
  try {
    const json = await safeFetchJson(url, {
      headers: {
        "User-Agent": "NaluXrp-Proxy/1.0",
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    res.json(json);
  } catch (err) {
    console.error("Proxy error (tokens):", err && err.message ? err.message : err);
    res.status(500).json({ error: "Proxy failed to fetch tokens", details: err.message || String(err) });
  }
});

// -------------------- JSON-RPC BRIDGE (HTTP -> WS rippled) --------------------
// This makes the browser able to do account_tx/account_info/etc without CORS.
// Accepts JSON-RPC-ish:
//   { method: "account_tx", params: [ { account:"r...", limit:200, ... } ] }
//
// Responds like xrplcluster/xrpl.ws style:
//   { result: { status:"success", result: <rippledResult> } }
async function handleJsonRpc(req, res) {
  try {
    const body = req.body || {};

    const method = body.method || body.command;
    const params0 = Array.isArray(body.params) ? body.params[0] : null;

    if (!method || typeof method !== "string") {
      return res.status(400).json({ error: "Missing JSON-RPC method" });
    }

    const payload = { ...(params0 && typeof params0 === "object" ? params0 : {}), command: method };

    // Optional timeout override (server-side)
    const timeoutMs = Number(body.timeoutMs || 12000);

    const out = await rippledRequest(payload, timeoutMs);

    // Wrap in a shape your front-end unwrapRpcResult() already understands.
    return res.json({
      result: {
        status: "success",
        result: out
      }
    });
  } catch (err) {
    console.error("JSON-RPC bridge error:", err && err.message ? err.message : err);
    return res.status(500).json({
      result: {
        status: "error",
        error: err && err.message ? err.message : String(err)
      }
    });
  }
}

// IMPORTANT: Keep GET / as a human-friendly page,
// but allow POST / for JSON-RPC (so your inspector can set base URL to the proxy).
app.post("/", handleJsonRpc);
app.post("/rpc", handleJsonRpc);

// -------------------- HEALTH + ROOT --------------------
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now(), rippled: RIPPLE_WSS });
});

app.get("/", (_req, res) => {
  res.send(
    "🌊 NaluXrp Proxy running\n\n" +
      "Endpoints:\n" +
      "  GET  /validators        -> { validators: [...] }\n" +
      "  GET  /api/validators    -> { validators: [...] }\n" +
      "  GET  /api/tokens        -> XRPL.to token list\n" +
      "  POST /                  -> JSON-RPC bridge {method, params:[{...}]}\n" +
      "  POST /rpc               -> same JSON-RPC bridge\n" +
      "  GET  /health            -> health check\n"
  );
});

app.listen(PORT, () => {
  console.log(`🌊 NaluXrp Proxy running at http://localhost:${PORT}`);
  console.log(`Using rippled WS: ${RIPPLE_WSS}`);
});
