/* =========================================
   NaluXrp 🌊 – XRPL Connection Module (Deep)
   Always connected WebSocket client + events for dashboard + modules.

   FIXES ADDED:
   ✅ Rotate WS server list per reconnect attempt (avoid getting stuck on one endpoint)
   ✅ Make disconnect non-blocking with timeout (prevents "stuck connecting")
   ✅ Add window.requestXrpl(payload, opts) shared request wrapper:
        - auto-connect / auto-reconnect
        - retries transient NotConnected/closed/closing errors
        - WS-only (avoids browser CORS HTTP JSON-RPC issues)
========================================= */

(function () {
  "use strict";

  // ---------------------------
  // CONFIG
  // ---------------------------
  const XRPL_SERVER_PROFILES = {
    "xrpl-mainnet": [
      { name: "XRPL Cluster", url: "wss://xrplcluster.com/" },
      { name: "XRPL WS", url: "wss://xrpl.ws/" },
      { name: "Ripple S1", url: "wss://s1.ripple.com/" },
      { name: "Ripple S2", url: "wss://s2.ripple.com/" }
    ],
    "xrpl-testnet": [
      { name: "Ripple Testnet", url: "wss://s.altnet.rippletest.net:51233" },
      { name: "XRPL Testnet", url: "wss://testnet.xrpl-labs.com/" }
    ],
    "xrpl-devnet": [{ name: "Ripple Devnet", url: "wss://s.devnet.rippletest.net:51233" }]
  };

  const LEDGER_POLL_MS = 2500;
  const HEARTBEAT_MS = 15000;
  const MAX_RECONNECT_ATTEMPTS = 25;
  const BASE_RECONNECT_DELAY_MS = 3000;
  const CONNECT_TIMEOUT_MS = 15000;

  // ---------------------------
  // STATE
  // ---------------------------
  window.XRPL = window.XRPL || {};
  window.XRPL.client = window.XRPL.client || null;
  window.XRPL.connected = window.XRPL.connected || false;
  window.XRPL.connecting = window.XRPL.connecting || false;
  window.XRPL.network = window.XRPL.network || "xrpl-mainnet";
  window.XRPL.server = window.XRPL.server || null;
  window.XRPL.serverName = window.XRPL.serverName || null;
  window.XRPL.reconnectAttempts = window.XRPL.reconnectAttempts || 0;
  window.XRPL.lastLedgerIndex = window.XRPL.lastLedgerIndex || null;
  window.XRPL.lastLedgerCloseTime = window.XRPL.lastLedgerCloseTime || null;
  window.XRPL.lastError = window.XRPL.lastError || null;

  let ledgerPollTimer = null;
  let heartbeatTimer = null;

  // ---------------------------
  // HELPERS
  // ---------------------------
  function dispatchConnectionEvent(connected, serverName, serverUrl, error) {
    try {
      const detail = { connected, serverName, serverUrl, error: error || null };
      window.dispatchEvent(new CustomEvent("xrpl-connection", { detail }));
    } catch (_) {}
  }

  function dispatchLedgerEvent(ledgerIndex, closeTime) {
    try {
      const detail = { ledgerIndex, closeTime };
      window.dispatchEvent(new CustomEvent("xrpl-ledger", { detail }));
    } catch (_) {}
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function getCurrentServerList() {
    const list = XRPL_SERVER_PROFILES[window.XRPL.network];
    const base =
      Array.isArray(list) && list.length
        ? list
        : XRPL_SERVER_PROFILES["xrpl-mainnet"];

    // Rotate the starting server on each reconnect attempt so we don't get stuck
    // waiting on the same endpoint when it's having issues.
    const shift =
      base.length > 1 ? (window.XRPL.reconnectAttempts || 0) % base.length : 0;

    return shift ? base.slice(shift).concat(base.slice(0, shift)) : base;
  }

  function isClientConnected() {
    try {
      if (!window.XRPL.client) return false;
      if (typeof window.XRPL.client.isConnected === "function") return !!window.XRPL.client.isConnected();
      return !!window.XRPL.connected;
    } catch (_) {
      return false;
    }
  }

  // ---------------------------
  // CLEANUP
  // ---------------------------
  async function cleanupConnection() {
    try {
      if (ledgerPollTimer) {
        clearInterval(ledgerPollTimer);
        ledgerPollTimer = null;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      if (window.XRPL.client) {
        try {
          if (typeof window.XRPL.client.removeAllListeners === "function") {
            window.XRPL.client.removeAllListeners();
          }
        } catch (_) {}

        try {
          if (typeof window.XRPL.client.disconnect === "function") {
            // Avoid hanging forever on disconnect in some browser/socket edge cases
            await Promise.race([
              window.XRPL.client.disconnect(),
              new Promise(function (resolve) {
                setTimeout(resolve, 4000);
              })
            ]);
          }
        } catch (_) {}
      }
    } catch (_) {}

    window.XRPL.client = null;
    window.XRPL.connected = false;
    window.XRPL.connecting = false;
    window.XRPL.server = null;
    window.XRPL.serverName = null;
  }

  // ---------------------------
  // LEDGER POLL
  // ---------------------------
  async function pollLedgerOnce() {
    try {
      if (!window.XRPL.client || !isClientConnected()) return;

      const resp = await window.XRPL.client.request({
        command: "ledger",
        ledger_index: "validated"
      });

      const result = resp && resp.result ? resp.result : resp;
      const ledgerIndex = result?.ledger_index ?? result?.ledger?.ledger_index ?? null;
      const closeTime = result?.ledger?.close_time_human ?? null;

      if (ledgerIndex && ledgerIndex !== window.XRPL.lastLedgerIndex) {
        window.XRPL.lastLedgerIndex = ledgerIndex;
        window.XRPL.lastLedgerCloseTime = closeTime || null;
        dispatchLedgerEvent(ledgerIndex, closeTime || null);
      }
    } catch (e) {
      console.warn("Check ledger error:", e && e.message ? e.message : e);
      window.XRPL.lastError = e && e.message ? e.message : String(e);
    }
  }

  function startLedgerPolling() {
    if (ledgerPollTimer) clearInterval(ledgerPollTimer);
    ledgerPollTimer = setInterval(pollLedgerOnce, LEDGER_POLL_MS);
    pollLedgerOnce().catch(() => {});
  }

  // ---------------------------
  // HEARTBEAT
  // ---------------------------
  async function heartbeatOnce() {
    try {
      if (!window.XRPL.client || !isClientConnected()) return;
      await window.XRPL.client.request({ command: "server_info" });
    } catch (e) {
      // Heartbeat failure is a strong hint connection died
      console.warn("Heartbeat failed:", e && e.message ? e.message : e);
      handleDisconnection(e);
    }
  }

  function startHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(heartbeatOnce, HEARTBEAT_MS);
  }

  // ---------------------------
  // CONNECT
  // ---------------------------
  async function attemptConnection(server) {
    const xrpl = window.xrpl;
    if (!xrpl || !xrpl.Client) throw new Error("xrpl.js not loaded");

    await cleanupConnection();

    const client = new xrpl.Client(server.url);
    window.XRPL.client = client;
    window.XRPL.server = server.url;
    window.XRPL.serverName = server.name;

    client.on("disconnected", (code) => {
      console.warn(`🔌 Disconnected (code ${code})`);
      handleDisconnection(new Error("disconnected"));
    });

    client.on("error", (err) => {
      console.warn("🔌 Client error:", err && err.message ? err.message : err);
      window.XRPL.lastError = err && err.message ? err.message : String(err);
    });

    // Connect with timeout guard
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("connect timeout")), CONNECT_TIMEOUT_MS))
    ]);

    window.XRPL.connected = true;
    window.XRPL.connecting = false;
    window.XRPL.lastError = null;

    console.log(`✅ Connected to ${server.name} (${server.url})`);
    dispatchConnectionEvent(true, server.name, server.url, null);

    startLedgerPolling();
    startHeartbeat();
  }

  async function connectXRPL() {
    if (window.XRPL.connected || window.XRPL.connecting) return;

    window.XRPL.connecting = true;
    console.log("🌊 Connecting to", window.XRPL.network, "...");

    const servers = getCurrentServerList();

    for (const server of servers) {
      try {
        console.log("🔌 Trying", server.name, "...");
        await attemptConnection(server);
        return;
      } catch (e) {
        console.warn("❌ Failed", server.name, ":", e && e.message ? e.message : e);
        window.XRPL.lastError = e && e.message ? e.message : String(e);
        dispatchConnectionEvent(false, server.name, server.url, window.XRPL.lastError);
        await sleep(450);
      }
    }

    window.XRPL.connecting = false;
    handleConnectionFailure();
  }

  // ---------------------------
  // RECONNECT LOGIC
  // ---------------------------
  function handleConnectionFailure() {
    window.XRPL.reconnectAttempts += 1;
    if (window.XRPL.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error("🛑 Max reconnect attempts reached.");
      return;
    }

    const delay = BASE_RECONNECT_DELAY_MS * window.XRPL.reconnectAttempts;
    console.log("🔄 Reconnecting in", delay, "ms (attempt", window.XRPL.reconnectAttempts, ")");
    setTimeout(() => connectXRPL().catch(() => {}), delay);
  }

  async function handleDisconnection(err) {
    if (!window.XRPL.connected && !window.XRPL.connecting) return;

    console.warn("🔌 Handling disconnection...");
    window.XRPL.connected = false;
    window.XRPL.connecting = false;

    if (err) {
      window.XRPL.lastError = err && err.message ? err.message : String(err);
    }

    dispatchConnectionEvent(false, window.XRPL.serverName, window.XRPL.server, window.XRPL.lastError);

    await cleanupConnection();

    handleConnectionFailure();
  }

  async function reconnectXRPL() {
    try {
      await cleanupConnection();
    } catch (_) {}
    window.XRPL.connected = false;
    window.XRPL.connecting = false;
    handleConnectionFailure();
  }

  function isXRPLConnected() {
    return isClientConnected();
  }

  /* ---------- SHARED REQUEST WRAPPER ---------- */
  /*
    window.requestXrpl(payload, opts)

    Purpose:
      - Provide a single, resilient request path for ALL modules (Dashboard, Inspector, Trace, etc.).
      - Automatically (re)connects if needed.
      - Retries common transient WS errors like NotConnectedError / closed socket.
      - Uses ONLY the shared WS client (no HTTP fallback here, avoids browser CORS issues).

    opts:
      - timeoutMs (default 20000)
      - retries (default 1)
  */
  function waitForXRPLConnected(timeoutMs) {
    return new Promise(function (resolve) {
      try {
        const start = Date.now();

        function isUp() {
          try {
            if (!window.XRPL) return false;
            if (window.XRPL.connected && window.XRPL.client) {
              if (typeof window.XRPL.client.isConnected === "function") {
                return !!window.XRPL.client.isConnected();
              }
              return true;
            }
          } catch (_) {}
          return false;
        }

        if (isUp()) return resolve(true);

        const onConn = function (ev) {
          try {
            if (ev && ev.detail && ev.detail.connected) {
              cleanup();
              resolve(true);
            }
          } catch (_) {}
        };

        const t = setInterval(function () {
          if (isUp()) {
            cleanup();
            resolve(true);
            return;
          }
          if (Date.now() - start > timeoutMs) {
            cleanup();
            resolve(false);
          }
        }, 120);

        function cleanup() {
          clearInterval(t);
          window.removeEventListener("xrpl-connection", onConn);
        }

        window.addEventListener("xrpl-connection", onConn);
        setTimeout(function () {
          cleanup();
          resolve(isUp());
        }, timeoutMs);
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function requestXrpl(payload, opts) {
    const options = opts || {};
    const timeoutMs = Number(options.timeoutMs) || 20000;
    const retries = Number.isFinite(Number(options.retries)) ? Number(options.retries) : 1;

    let lastErr = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Ensure we have an active connection
        if (!window.XRPL || !window.XRPL.client || !window.XRPL.connected) {
          try {
            if (typeof window.connectXRPL === "function") window.connectXRPL();
          } catch (_) {}

          const ok = await waitForXRPLConnected(Math.min(timeoutMs, 15000));
          if (!ok) throw new Error("XRPL WS not connected");
        }

        // Guard against "CLOSING/CLOSED" edge cases
        try {
          if (window.XRPL.client && typeof window.XRPL.client.isConnected === "function") {
            if (!window.XRPL.client.isConnected()) {
              throw new Error("XRPL WS client not connected");
            }
          }
        } catch (_) {}

        // Execute request with timeout
        const res = await Promise.race([
          window.XRPL.client.request(payload),
          new Promise(function (_, reject) {
            setTimeout(function () {
              reject(new Error("XRPL request timeout"));
            }, timeoutMs);
          })
        ]);

        return res;
      } catch (e) {
        lastErr = e;

        const msg = e && e.message ? String(e.message) : String(e || "");
        const transient =
          msg.includes("NotConnectedError") ||
          msg.toLowerCase().includes("not connected") ||
          msg.toLowerCase().includes("websocket was closed") ||
          msg.toLowerCase().includes("closing") ||
          msg.toLowerCase().includes("closed") ||
          msg.toLowerCase().includes("timeout");

        // Try a quick reconnect then retry
        try {
          if (transient && typeof window.reconnectXRPL === "function") {
            window.reconnectXRPL();
          } else if (transient && typeof window.connectXRPL === "function") {
            window.connectXRPL();
          }
        } catch (_) {}

        if (attempt < retries) {
          await new Promise(function (r) {
            setTimeout(r, 250 * (attempt + 1));
          });
          continue;
        }

        throw lastErr;
      }
    }

    throw lastErr || new Error("XRPL request failed");
  }

  window.requestXrpl = requestXrpl;

  /* ---------- EXPORTS ---------- */
  window.connectXRPL = connectXRPL;
  window.reconnectXRPL = reconnectXRPL;
  window.isXRPLConnected = isXRPLConnected;

  // auto-connect on load
  try {
    connectXRPL().catch(() => {});
  } catch (_) {}
})();

