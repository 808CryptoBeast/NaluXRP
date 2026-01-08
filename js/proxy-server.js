// proxy-server.js (COMMONJS - STABLE)
// Improved validator proxy for NaluXrp
// - CORS enabled for browser fetches
// - WebSocket request to rippled with timeout
// - Normalized /validators and /api/validators endpoints
// Usage: node js/proxy-server.js

const express = require("express");
const cors = require("cors");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;
const RIPPLE_WSS = "wss://s1.ripple.com";

// Enable CORS for all origins (adjust to restrict in production)
app.use(cors());
app.use(express.json());

// Helper to perform a rippled WebSocket request and return parsed result
function rippledRequest(commandObj, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RIPPLE_WSS);
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.terminate(); } catch (e) {}
        reject(new Error("rippled request timed out"));
      }
    }, timeoutMs);

    ws.on("open", () => {
      // Accept either a string command or an object (e.g. { command: "validators" })
      const payload = (typeof commandObj === "string") ? { command: commandObj } : commandObj;
      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        settled = true;
        try { ws.terminate(); } catch (e) {}
        reject(err);
      }
    });

    ws.on("message", (msg) => {
      if (settled) return;
      try {
        const parsed = JSON.parse(msg.toString());
        const result = parsed.result || parsed;
        settled = true;
        clearTimeout(timer);
        try { ws.close(); } catch (e) {}
        resolve(result);
      } catch (err) {
        settled = true;
        clearTimeout(timer);
        try { ws.close(); } catch (e) {}
        reject(err);
      }
    });

    ws.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    ws.on("close", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("rippled connection closed before response"));
      }
    });
  });
}

// Validators endpoint (WebSocket-based)
app.get("/validators", async (_req, res) => {
  try {
    // Request validators from rippled
    const data = await rippledRequest({ command: "validators" }, 10000);

    // Normalize possible shapes to an array of validators
    let validators = [];
    if (data && Array.isArray(data.validators)) validators = data.validators;
    else if (data && Array.isArray(data.validator_list)) validators = data.validator_list;
    else {
      const arr = Object.values(data || {}).find(v => Array.isArray(v));
      if (arr) validators = arr;
    }

    if (!Array.isArray(validators)) {
      console.warn("Proxy: unexpected validators response shape", { preview: JSON.stringify(data).slice(0, 500) });
      return res.status(502).json({ error: "Invalid validators format from rippled", validators: [] });
    }

    res.json({ validators });
  } catch (err) {
    console.error("Validator fetch error:", err && err.message ? err.message : err);
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Alias route under /api/validators (some clients expect /api/...)
app.get("/api/validators", async (req, res) => {
  // Reuse the same handler logic
  return app._router.handle(req, res, null);
});

// Keep existing tokens endpoint (if you need it elsewhere)
app.get("/api/tokens", async (req, res) => {
  const url = "https://api.xrpl.to/api/tokens/top";
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "NaluXrp-Proxy/1.0", Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    res.json(json);
  } catch (err) {
    console.error("Proxy error (tokens):", err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.get("/", (_req, res) => {
  res.send("🛡️ Validator proxy running");
});

app.listen(PORT, () => {
  console.log(`🛡️ Validator proxy running on http://localhost:${PORT}`);
  console.log("Endpoints:");
  console.log("  GET /validators        -> proxied rippled validators (returns { validators: [...] })");
  console.log("  GET /api/validators    -> same as /validators");
  console.log("  GET /api/tokens        -> proxied token list (if needed)");
  console.log("  GET /health            -> health check");
});
