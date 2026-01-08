// proxy-server.js (COMMONJS - STABLE)

const express = require("express");
const WebSocket = require("ws");

const app = express();
const PORT = 3000;
const RIPPLE_WSS = "wss://s1.ripple.com";

function rippledRequest(command) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RIPPLE_WSS);

    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, command }));
    });

    ws.on("message", msg => {
      try {
        const data = JSON.parse(msg.toString());
        ws.close();
        resolve(data.result || data);
      } catch (e) {
        reject(e);
      }
    });

    ws.on("error", err => {
      reject(err);
    });
  });
}

// Validators endpoint
app.get("/validators", async (_req, res) => {
  try {
    const data = await rippledRequest("validators");
    res.json({ validators: data.validators || [] });
  } catch (err) {
    console.error("Validator fetch error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/", (_req, res) => {
  res.send("🛡️ Validator proxy running");
});

app.listen(PORT, () => {
  console.log(`🛡️ Validator proxy running on http://localhost:${PORT}`);
});
