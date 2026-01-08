// Lightweight API fetch wrapper with timeout, retry, and simple allowlist support

const DEFAULT_TIMEOUT = 10_000; // ms
const DEFAULT_RETRIES = 1;

/**
 * createApiClient
 * @param {Object} opts
 * @param {string[]} opts.allowlist - optional allowed base origins (e.g. ["https://api.example.com"])
 */
export function createApiClient({ allowlist = [] } = {}) {
  function isAllowed(url) {
    if (!allowlist || allowlist.length === 0) return true;
    try {
      const u = new URL(url);
      return allowlist.includes(u.origin);
    } catch {
      return false;
    }
  }

  async function request(url, { method = "GET", headers = {}, body = null, timeout = DEFAULT_TIMEOUT, retries = DEFAULT_RETRIES } = {}) {
    if (!isAllowed(url)) {
      throw new Error(`Blocked request to disallowed origin: ${url}`);
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);

      try {
        const res = await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
          credentials: "same-origin",
        });
        clearTimeout(id);

        const contentType = res.headers.get("content-type") || "";
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        if (contentType.includes("application/json")) {
          return await res.json();
        }
        return await res.text();
      } catch (err) {
        clearTimeout(id);
        // Only retry on network or abort errors
        const canRetry = err.name === "AbortError" || err.name === "TypeError";
        if (attempt < retries && canRetry) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  }

  return {
    get: (url, opts) => request(url, { method: "GET", ...opts }),
    post: (url, { body, headers = {}, ...opts } = {}) =>
      request(url, {
        method: "POST",
        body: typeof body === "object" && !(body instanceof FormData) ? JSON.stringify(body) : body,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        ...opts,
      }),
    request,
  };
}