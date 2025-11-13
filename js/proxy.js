// proxy.js 🌊 NaluXrp Local API Bridge
const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = 3000;

// ===== Middleware =====
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// ===== Safe JSON Fetch =====
async function safeFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  // Try to parse JSON
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("❌ JSON parse error:", text.slice(0, 100));
    throw new Error("Invalid JSON response from remote API");
  }
}

// ===== Tokens Route =====
app.get("/api/tokens", async (req, res) => {
  const url = "https://api.xrpl.to/api/tokens/top";

  try {
    const headers = {
      "User-Agent": "NaluXrp-Proxy/1.0",
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    };

    const data = await safeFetch(url, { headers });

    if (!data || !data.data) {
      console.warn("⚠️ Unexpected structure from XRPL.to API:", data);
      return res.status(502).json({
        error: "Invalid token data structure",
        received: Object.keys(data || {}),
      });
    }

    res.json(data);
  } catch (err) {
    console.error("❌ Proxy error:", err.message);
    res.status(500).json({ error: "Proxy failed to fetch tokens", details: err.message });
  }
});

// ===== Root Health Check =====
app.get("/", (_, res) => {
  res.send("🌊 NaluXrp Proxy is running properly");
});

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`🌊 NaluXrp Proxy running at http://localhost:${PORT}/api/tokens`);
});
