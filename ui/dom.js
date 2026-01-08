// Safe DOM helpers and a small reusable Card renderer
import { escapeHtml } from "../utils/index.js";

/**
 * safeText - set element text safely
 */
export function safeText(el, text) {
  el.textContent = text == null ? "" : String(text);
}

/**
 * safeHTML - insert sanitized HTML using escapeHtml for interpolated values
 * Use sparingly; prefer safeText for arbitrary data.
 */
export function safeHTML(el, htmlString) {
  // This is a conservative helper: it escapes everything, then sets innerHTML.
  el.innerHTML = escapeHtml(String(htmlString));
}

/**
 * createCard
 * options: { title, subtitle, tiles: [{label, value}], actions: [{label, onClick}] }
 */
export function createCard({ title, subtitle, tiles = [], actions = [] } = {}) {
  const card = document.createElement("div");
  card.className = "card";

  const header = document.createElement("div");
  header.className = "card-header";
  const hTitle = document.createElement("h3");
  safeText(hTitle, title || "");
  header.appendChild(hTitle);

  if (subtitle) {
    const sub = document.createElement("div");
    sub.className = "card-subtitle";
    safeText(sub, subtitle);
    header.appendChild(sub);
  }
  card.appendChild(header);

  if (tiles && tiles.length) {
    const tileRow = document.createElement("div");
    tileRow.className = "card-tiles";
    tiles.forEach((t) => {
      const tile = document.createElement("div");
      tile.className = "card-tile";
      const l = document.createElement("div");
      l.className = "card-tile-label";
      safeText(l, t.label);
      const v = document.createElement("div");
      v.className = "card-tile-value";
      safeText(v, t.value);
      tile.appendChild(l);
      tile.appendChild(v);
      tileRow.appendChild(tile);
    });
    card.appendChild(tileRow);
  }

  if (actions && actions.length) {
    const actionRow = document.createElement("div");
    actionRow.className = "card-actions";
    actions.forEach((a) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card-action";
      safeText(btn, a.label);
      if (typeof a.onClick === "function") btn.addEventListener("click", a.onClick);
      actionRow.appendChild(btn);
    });
    card.appendChild(actionRow);
  }

  return card;
}

/**
 * attach - append node(s) to a container (accepts Node or array)
 */
export function attach(container, nodeOrNodes) {
  if (Array.isArray(nodeOrNodes)) nodeOrNodes.forEach(n => container.appendChild(n));
  else container.appendChild(nodeOrNodes);
}