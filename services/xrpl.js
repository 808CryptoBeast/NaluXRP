// XRPL service wrapper that centralizes connection logic and exposes events.
// Requires global `xrpl` or an injected client factory.

import EventEmitter from "../vendor/simple-event-emitter.js"; // optional; if you don't have one, swap for a tiny implementation

// Minimal fallback EventEmitter (in case you don't have one)
class Emitter {
  constructor() { this._k = {}; }
  on(k, fn) { (this._k[k] = this._k[k] || []).push(fn); return () => this.off(k, fn); }
  off(k, fn) { if (!this._k[k]) return; this._k[k] = this._k[k].filter(f => f !== fn); }
  emit(k, ...a) { (this._k[k] || []).forEach(f => f(...a)); }
}

/**
 * XRPLService
 * - Simple connect/disconnect wrapper
 * - Queues requests until connected
 */
export class XRPLService {
  /**
   * @param {Object} opts
   * @param {string} opts.url - websocket URL or endpoint for xrpl.Client
   * @param {Function} [opts.createClient] - optional factory to create xrpl.Client
   */
  constructor({ url = "wss://s1.ripple.com", createClient } = {}) {
    this.url = url;
    this.createClient = createClient;
    this.client = null;
    this.emitter = typeof EventEmitter !== "undefined" ? new EventEmitter() : new Emitter();
    this._connected = false;
    this._pending = [];
  }

  on(event, cb) { return this.emitter.on(event, cb); }
  off(event, cb) { return this.emitter.off(event, cb); }

  async connect() {
    if (this._connected) return this.client;
    if (this.createClient) {
      this.client = this.createClient(this.url);
    } else if (typeof xrpl !== "undefined" && xrpl.Client) {
      this.client = new xrpl.Client(this.url);
    } else {
      throw new Error("No XRPL client available. Provide createClient or include xrpl lib.");
    }

    await this.client.connect();
    this._connected = true;
    this.emitter.emit("connected");
    // flush pending
    while (this._pending.length) {
      const { resolve, fn } = this._pending.shift();
      try { resolve(await fn()); } catch (e) { resolve(Promise.reject(e)); }
    }
    return this.client;
  }

  async disconnect() {
    if (!this.client) return;
    try {
      await this.client.disconnect();
    } finally {
      this._connected = false;
      this.client = null;
      this.emitter.emit("disconnected");
    }
  }

  async _ensure(fn) {
    if (this._connected && this.client) return fn();
    return new Promise((resolve, reject) => {
      this._pending.push({ resolve, fn: async () => fn() });
      // optionally try to connect automatically
      this.connect().catch(reject);
    });
  }

  // Example wrapper for making requests via the xrpl client
  async request(payload) {
    return this._ensure(async () => {
      if (!this.client) throw new Error("XRPL client not connected");
      return this.client.request(payload);
    });
  }
}