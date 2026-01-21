/* =========================================
   NaluXrp 🌊 – Profile Module (Hardened)
   v2.0.0-security-hardened

   SECURITY CHANGES:
   ✅ No plaintext seed stored anywhere by default (memory-only)
   ✅ Optional encrypted vault (AES-GCM + PBKDF2) stored locally ONLY if user opts in
   ✅ Passphrase is NEVER stored
   ✅ Seed is hidden by default; reveal requires explicit action + warning
   ✅ No inline onclick handlers (less global surface)
   ✅ Import/export supports encrypted vault JSON
   ✅ Clears sensitive UI on lock/unload

   Notes:
   - In a browser app, nothing can make keys "perfectly safe" if the device/origin is compromised.
     This makes leaks MUCH harder and avoids the biggest foot-guns (plaintext storage + DOM leaks).
   ========================================= */

(function () {
  const VERSION = "profile@2.0.0-security-hardened";

  // Local-only storage keys
  const LS_BIO = "nalu_profile_bio_v2";
  const LS_VAULT = "nalu_wallet_vault_v1";

  // Crypto settings
  const PBKDF2_ITERS = 210_000; // good baseline; adjust if needed for low-end devices
  const SALT_BYTES = 16;
  const IV_BYTES = 12;

  // In-memory wallet state (NOT persisted unless user opts in with vault)
  let currentWallet = null;
  let seedRevealed = false;

  // -------------------------------------------------------
  // Helpers
  // -------------------------------------------------------
  function el(id) { return document.getElementById(id); }

  function showNotification(message, type = "info") {
    // Use app notification if present, else fallback
    if (typeof window.showNotification === "function") {
      window.showNotification(message, type);
      return;
    }
    const out = el("profileStatus");
    if (out) {
      out.textContent = message;
      out.style.color = (type === "error") ? "#ff6e6e" : "var(--text-secondary)";
    }
    console.log(`[${type}] ${message}`);
  }

  function isXRPLReady() {
    return typeof window.xrpl !== "undefined" && window.xrpl?.Wallet;
  }

  function safeText(node, text) {
    if (!node) return;
    node.textContent = String(text ?? "");
  }

  function shortAddr(a) {
    const s = String(a || "");
    if (s.length < 12) return s;
    return `${s.slice(0, 6)}…${s.slice(-4)}`;
  }

  function downloadFile(filename, content, mime = "application/json") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function randomBytes(n) {
    const buf = new Uint8Array(n);
    crypto.getRandomValues(buf);
    return buf;
  }

  function b64encode(bytes) {
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  }

  function b64decode(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKey(passphrase, salt, iterations) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptSeedToVault(seed, passphrase) {
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const key = await deriveKey(passphrase, salt, PBKDF2_ITERS);

    const enc = new TextEncoder();
    const cipherBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode(seed)
    );

    const vault = {
      schema: "nalu_wallet_vault@1",
      createdAt: new Date().toISOString(),
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERS },
      cipher: { name: "AES-GCM" },
      salt_b64: b64encode(salt),
      iv_b64: b64encode(iv),
      ciphertext_b64: b64encode(new Uint8Array(cipherBuf))
    };

    return vault;
  }

  async function decryptVaultToSeed(vault, passphrase) {
    if (!vault || vault.schema !== "nalu_wallet_vault@1") {
      throw new Error("Invalid vault format.");
    }

    const salt = b64decode(vault.salt_b64);
    const iv = b64decode(vault.iv_b64);
    const ct = b64decode(vault.ciphertext_b64);
    const iters = vault?.kdf?.iterations ?? PBKDF2_ITERS;

    const key = await deriveKey(passphrase, salt, iters);

    let plainBuf;
    try {
      plainBuf = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ct
      );
    } catch {
      throw new Error("Wrong passphrase or corrupted vault.");
    }

    const dec = new TextDecoder();
    return dec.decode(plainBuf);
  }

  // -------------------------------------------------------
  // Minimal modal dialogs (no prompt())
  // -------------------------------------------------------
  function openModal({ title, bodyHTML, confirmText = "Confirm", cancelText = "Cancel" }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(0,0,0,0.72);
        display: flex; align-items: center; justify-content: center;
        padding: 14px;
      `;

      const card = document.createElement("div");
      card.style.cssText = `
        width: min(720px, 100%);
        border-radius: 18px;
        border: 1px solid rgba(255,255,255,0.14);
        background: linear-gradient(135deg, rgba(0,0,0,0.78), rgba(0,0,0,0.88));
        box-shadow: 0 18px 42px rgba(0,0,0,0.75);
        padding: 14px;
        color: var(--text-primary);
      `;

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <div style="font-weight:950; color: var(--accent-secondary); font-size: 1.05rem;">${title}</div>
          <button id="naluModalClose" class="nav-btn" type="button" style="padding: 6px 10px;">✕</button>
        </div>
        <div style="margin-top: 10px; color: var(--text-secondary); line-height: 1.55;">
          ${bodyHTML}
        </div>
        <div style="display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap; margin-top: 14px;">
          <button id="naluModalCancel" class="nav-btn" type="button">${cancelText}</button>
          <button id="naluModalOk" class="nav-btn" type="button" style="border-color: var(--accent-primary);">${confirmText}</button>
        </div>
      `;

      overlay.appendChild(card);
      document.body.appendChild(overlay);

      function close(val) {
        overlay.remove();
        resolve(val);
      }

      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(null);
      });

      card.querySelector("#naluModalClose")?.addEventListener("click", () => close(null));
      card.querySelector("#naluModalCancel")?.addEventListener("click", () => close(null));
      card.querySelector("#naluModalOk")?.addEventListener("click", () => close(true));
    });
  }

  async function askPassphrase(title, note = "") {
    const id = `pw_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const ok = await openModal({
      title,
      confirmText: "Continue",
      cancelText: "Cancel",
      bodyHTML: `
        <div>${note}</div>
        <div style="margin-top:12px;">
          <label style="display:block; font-weight:900; margin-bottom:6px; color: var(--text-primary);">Passphrase</label>
          <input id="${id}" type="password" autocomplete="new-password"
            style="width:100%; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none;" />
          <div style="margin-top:8px; font-size:0.92rem;">
            <span style="color:#ffb86c; font-weight:900;">Tip:</span> Use a long passphrase. It is never saved.
          </div>
        </div>
      `
    });

    if (!ok) return null;

    const input = document.getElementById(id);
    const pass = (input?.value || "").trim();
    return pass || null;
  }

  async function askSeedImport() {
    const seedId = `seed_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const checkId = `ck_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const ok = await openModal({
      title: "Import wallet seed (local only)",
      confirmText: "Import",
      cancelText: "Cancel",
      bodyHTML: `
        <div style="padding:10px; border-radius:14px; border:1px solid rgba(255,255,255,0.10); background: rgba(255,184,108,0.06);">
          <div style="font-weight:950; color: var(--text-primary);">⚠️ Security warning</div>
          <div style="margin-top:6px;">
            Never paste a seed on a device you don’t trust. NaluXrp does <strong>not</strong> send seeds to any server.
            This seed will be kept <strong>in memory only</strong> unless you export/save an encrypted vault.
          </div>
        </div>

        <div style="margin-top:12px;">
          <label style="display:block; font-weight:900; margin-bottom:6px; color: var(--text-primary);">Seed</label>
          <textarea id="${seedId}" rows="2" autocomplete="off" spellcheck="false"
            style="width:100%; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none; resize: vertical;"></textarea>
        </div>

        <label style="display:flex; gap:10px; align-items:flex-start; margin-top:12px; color: var(--text-secondary); font-weight:800;">
          <input id="${checkId}" type="checkbox" />
          <span>I understand: seeds grant full control of funds and should never be shared.</span>
        </label>
      `
    });

    if (!ok) return null;

    const seed = (document.getElementById(seedId)?.value || "").trim();
    const checked = !!document.getElementById(checkId)?.checked;
    if (!seed || !checked) return null;

    return seed;
  }

  // -------------------------------------------------------
  // UI Rendering
  // -------------------------------------------------------
  function initProfile() {
    const container = el("profile");
    if (!container) return;

    container.innerHTML = `
      <div class="chart-section">
        <div class="chart-title">👤 My Profile</div>

        <div id="profileStatus" style="margin-top:10px; color: var(--text-secondary);"></div>

        <div style="display:grid; gap: 22px; margin-top: 14px;">

          <!-- Wallet Section -->
          <div style="background: var(--card-bg); border-radius: 16px; padding: 22px; border: 2px solid var(--accent-primary);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
              <h3 style="color: var(--accent-secondary); margin: 0;">💼 Wallet (local)</h3>
              <div style="color: var(--text-secondary); font-size: 0.92rem; max-width: 72ch;">
                Keys stay in your browser. No server storage. For persistence, use an <strong>encrypted vault</strong>.
              </div>
            </div>

            <div style="display:flex; gap: 10px; flex-wrap:wrap; margin-top: 14px;">
              <button id="btnGenerateWallet" class="nav-btn" type="button">🌀 Generate</button>
              <button id="btnImportSeed" class="nav-btn" type="button">📥 Import seed</button>
              <button id="btnImportVault" class="nav-btn" type="button">📦 Import vault</button>
              <button id="btnExportVault" class="nav-btn" type="button" disabled>🔒 Export vault</button>
              <button id="btnLockWallet" class="nav-btn" type="button" disabled>🔐 Lock</button>
            </div>

            <div style="display:flex; gap: 12px; flex-wrap:wrap; align-items:center; margin-top: 12px; padding: 12px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.22);">
              <label style="display:flex; gap:10px; align-items:center; color: var(--text-secondary); font-weight:900;">
                <input id="toggleRememberVault" type="checkbox" />
                Remember wallet on this device (encrypted vault)
              </label>
              <button id="btnUnlockVault" class="nav-btn" type="button">Unlock saved vault</button>
              <button id="btnDeleteVault" class="nav-btn" type="button">Delete saved vault</button>
              <span id="vaultStatus" style="color: var(--text-secondary);"></span>
            </div>

            <div id="wallet-info" style="margin-top: 14px;">
              <div style="color: #888; text-align:center; padding: 18px;">
                No wallet loaded (memory-only)
              </div>
            </div>
          </div>

          <!-- Bio Section -->
          <div style="background: var(--card-bg); border-radius: 16px; padding: 22px; border: 2px solid var(--accent-tertiary);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
              <h3 style="color: var(--accent-secondary); margin: 0;">📝 Bio (local)</h3>
              <div style="color: var(--text-secondary); font-size: 0.92rem;">
                Stored locally in your browser only.
              </div>
            </div>

            <textarea
              id="profile-bio"
              placeholder="Write something about yourself..."
              style="width: 100%; min-height: 110px; padding: 12px; border-radius: 12px; border: 2px solid var(--accent-tertiary);
                     background: rgba(0,0,0,0.4); color: #fff; font-family: inherit; resize: vertical; margin-top: 14px;"
            ></textarea>

            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top: 10px;">
              <button id="btnSaveBio" class="nav-btn" type="button">💾 Save Bio</button>
              <button id="btnClearBio" class="nav-btn" type="button">🗑️ Clear Bio</button>
            </div>
          </div>
        </div>
      </div>
    `;

    bindProfileEvents();
    loadBio();
    refreshVaultStatus();
    renderWalletUI();
  }

  function bindProfileEvents() {
    el("btnGenerateWallet")?.addEventListener("click", generateNewWallet);
    el("btnImportSeed")?.addEventListener("click", importWalletSeed);
    el("btnImportVault")?.addEventListener("click", importVaultFromFile);
    el("btnExportVault")?.addEventListener("click", exportEncryptedVault);
    el("btnLockWallet")?.addEventListener("click", lockWallet);

    el("btnUnlockVault")?.addEventListener("click", unlockSavedVault);
    el("btnDeleteVault")?.addEventListener("click", deleteSavedVault);

    el("toggleRememberVault")?.addEventListener("change", async () => {
      const on = !!el("toggleRememberVault")?.checked;
      if (!on) {
        showNotification("Vault remember is OFF (wallet remains memory-only).", "info");
        return;
      }
      if (!currentWallet?.seed) {
        showNotification("Load a wallet first, then enable encrypted vault storage.", "info");
        el("toggleRememberVault").checked = false;
        return;
      }
      await saveVaultIfOptedIn();
    });

    el("btnSaveBio")?.addEventListener("click", saveBio);
    el("btnClearBio")?.addEventListener("click", clearBio);
  }

  // -------------------------------------------------------
  // Wallet actions (memory-only by default)
  // -------------------------------------------------------
  async function generateNewWallet() {
    if (!isXRPLReady()) {
      showNotification("XRPL library not loaded yet.", "error");
      return;
    }

    // Warn user that it won't be stored unless they opt in
    const ok = await openModal({
      title: "Generate a new wallet?",
      confirmText: "Generate",
      cancelText: "Cancel",
      bodyHTML: `
        <div style="padding:10px; border-radius:14px; border:1px solid rgba(255,255,255,0.10); background: rgba(139,233,253,0.06);">
          A new wallet will be created in your browser. The seed is <strong>not saved</strong> unless you export/save an encrypted vault.
        </div>
      `
    });
    if (!ok) return;

    const wallet = window.xrpl.Wallet.generate();
    setCurrentWallet(wallet);
    showNotification("New wallet generated (memory-only).", "success");

    // If user opted into vault storage, store encrypted vault
    await saveVaultIfOptedIn();
  }

  async function importWalletSeed() {
    if (!isXRPLReady()) {
      showNotification("XRPL library not loaded yet.", "error");
      return;
    }

    const seed = await askSeedImport();
    if (!seed) {
      showNotification("Import cancelled.", "info");
      return;
    }

    try {
      const wallet = window.xrpl.Wallet.fromSeed(seed.trim());
      setCurrentWallet(wallet);
      showNotification("Wallet imported (memory-only).", "success");
      await saveVaultIfOptedIn();
    } catch (err) {
      showNotification("Invalid seed.", "error");
    }
  }

  function setCurrentWallet(wallet) {
    currentWallet = wallet;
    seedRevealed = false;
    renderWalletUI();
    // Never console.log seeds
  }

  async function lockWallet() {
    const ok = await openModal({
      title: "Lock wallet?",
      confirmText: "Lock",
      cancelText: "Cancel",
      bodyHTML: `
        <div style="padding:10px; border-radius:14px; border:1px solid rgba(255,255,255,0.10); background: rgba(255,184,108,0.06);">
          This removes the wallet from memory and hides the seed immediately. If you didn’t export or save an encrypted vault, you may lose access.
        </div>
      `
    });
    if (!ok) return;

    currentWallet = null;
    seedRevealed = false;
    renderWalletUI();
    showNotification("Wallet locked (cleared from memory).", "success");
  }

  // -------------------------------------------------------
  // Wallet vault (encrypted local persistence - optional)
  // -------------------------------------------------------
  function getSavedVault() {
    try {
      const raw = localStorage.getItem(LS_VAULT);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function setSavedVault(vaultObj) {
    localStorage.setItem(LS_VAULT, JSON.stringify(vaultObj));
  }

  function removeSavedVault() {
    localStorage.removeItem(LS_VAULT);
  }

  function refreshVaultStatus() {
    const status = el("vaultStatus");
    const t = el("toggleRememberVault");
    const vault = getSavedVault();
    if (status) {
      status.textContent = vault
        ? `Vault saved • ${new Date(vault.createdAt || Date.now()).toLocaleString()}`
        : "No saved vault";
    }
    // Do not auto-enable; user choice
    if (t) t.checked = false;
  }

  async function saveVaultIfOptedIn() {
    const opted = !!el("toggleRememberVault")?.checked;
    if (!opted) return;
    if (!currentWallet?.seed) return;

    const pass = await askPassphrase(
      "Create encrypted vault",
      "This will store an encrypted wallet vault in your browser (localStorage). Passphrase is not saved."
    );
    if (!pass) {
      el("toggleRememberVault").checked = false;
      showNotification("Vault creation cancelled. Remember toggle disabled.", "info");
      return;
    }

    try {
      const vault = await encryptSeedToVault(currentWallet.seed, pass);
      setSavedVault(vault);
      refreshVaultStatus();
      showNotification("Encrypted vault saved locally.", "success");
    } catch (e) {
      el("toggleRememberVault").checked = false;
      showNotification(`Vault save failed: ${e.message || e}`, "error");
    }
  }

  async function unlockSavedVault() {
    const vault = getSavedVault();
    if (!vault) {
      showNotification("No saved vault found.", "info");
      return;
    }
    if (!isXRPLReady()) {
      showNotification("XRPL library not loaded yet.", "error");
      return;
    }

    const pass = await askPassphrase(
      "Unlock saved vault",
      "Enter the passphrase used to encrypt your vault."
    );
    if (!pass) {
      showNotification("Unlock cancelled.", "info");
      return;
    }

    try {
      const seed = await decryptVaultToSeed(vault, pass);
      const wallet = window.xrpl.Wallet.fromSeed(seed.trim());
      setCurrentWallet(wallet);
      showNotification("Vault unlocked (wallet loaded into memory).", "success");
    } catch (e) {
      showNotification(e.message || "Failed to unlock vault.", "error");
    }
  }

  async function deleteSavedVault() {
    const vault = getSavedVault();
    if (!vault) {
      showNotification("No saved vault to delete.", "info");
      return;
    }

    const ok = await openModal({
      title: "Delete saved vault?",
      confirmText: "Delete",
      cancelText: "Cancel",
      bodyHTML: `
        <div style="padding:10px; border-radius:14px; border:1px solid rgba(255,255,255,0.10); background: rgba(255,110,110,0.08);">
          This removes the encrypted vault from this browser. If you didn’t export it elsewhere, you may lose access.
        </div>
      `
    });
    if (!ok) return;

    removeSavedVault();
    refreshVaultStatus();
    showNotification("Saved vault deleted.", "success");
  }

  async function exportEncryptedVault() {
    if (!currentWallet?.seed) {
      showNotification("Load a wallet first.", "info");
      return;
    }
    const pass = await askPassphrase(
      "Export encrypted vault",
      "Creates a downloadable encrypted vault file. Passphrase is not saved."
    );
    if (!pass) {
      showNotification("Export cancelled.", "info");
      return;
    }

    try {
      const vault = await encryptSeedToVault(currentWallet.seed, pass);
      downloadFile(`nalu_wallet_vault_${shortAddr(currentWallet.address)}.json`, JSON.stringify(vault, null, 2));
      showNotification("Encrypted vault downloaded.", "success");
    } catch (e) {
      showNotification(`Export failed: ${e.message || e}`, "error");
    }
  }

  async function importVaultFromFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;

      const text = await file.text();
      let vault;
      try {
        vault = JSON.parse(text);
      } catch {
        showNotification("Invalid JSON file.", "error");
        return;
      }

      const pass = await askPassphrase(
        "Import encrypted vault",
        "Enter the passphrase used to encrypt this vault."
      );
      if (!pass) {
        showNotification("Import cancelled.", "info");
        return;
      }

      if (!isXRPLReady()) {
        showNotification("XRPL library not loaded yet.", "error");
        return;
      }

      try {
        const seed = await decryptVaultToSeed(vault, pass);
        const wallet = window.xrpl.Wallet.fromSeed(seed.trim());
        setCurrentWallet(wallet);
        showNotification("Vault imported (wallet loaded into memory).", "success");
      } catch (e) {
        showNotification(e.message || "Failed to import vault.", "error");
      }
    });

    input.click();
  }

  // -------------------------------------------------------
  // Wallet UI (seed hidden by default)
  // -------------------------------------------------------
  function renderWalletUI() {
    const container = el("wallet-info");
    if (!container) return;

    const exportBtn = el("btnExportVault");
    const lockBtn = el("btnLockWallet");

    if (!currentWallet) {
      container.innerHTML = `
        <div style="color:#888; text-align:center; padding: 18px;">
          No wallet loaded (memory-only)
        </div>
      `;
      if (exportBtn) exportBtn.disabled = true;
      if (lockBtn) lockBtn.disabled = true;
      return;
    }

    if (exportBtn) exportBtn.disabled = false;
    if (lockBtn) lockBtn.disabled = false;

    container.innerHTML = `
      <div style="background: rgba(0,0,0,0.28); padding: 18px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.10);">
        <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div>
            <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px; font-weight:900;">Address</div>
            <div id="walletAddress" style="font-family: monospace; font-size: 0.98em; color: var(--accent-primary); word-break: break-all;"></div>
          </div>
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <button id="btnCopyAddress" class="nav-btn" type="button">Copy address</button>
            <button id="btnRefreshBalance" class="nav-btn" type="button">Refresh balance</button>
          </div>
        </div>

        <div style="margin-top: 14px;">
          <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px; font-weight:900;">Seed</div>

          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <div id="seedBox" style="flex: 1 1 420px; font-family: monospace; font-size: 0.92em; color: #ffb86c; word-break: break-all; padding: 10px 12px;
                 border-radius: 12px; border: 1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.35);">
              Hidden (click reveal)
            </div>
            <button id="btnRevealSeed" class="nav-btn" type="button">Reveal</button>
            <button id="btnCopySeed" class="nav-btn" type="button" disabled>Copy seed</button>
          </div>

          <div style="margin-top: 10px; color: var(--text-secondary); font-size: 0.92rem;">
            Never share your seed. NaluXrp does not upload seeds, but your device must be trusted.
          </div>
        </div>

        <div id="balance-info" style="margin-top: 14px;">
          <div style="color: #888; font-size: 0.9em;">Balance not loaded.</div>
        </div>
      </div>
    `;

    // Fill address safely
    safeText(el("walletAddress"), currentWallet.address);

    // Bind wallet UI actions
    el("btnCopyAddress")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(currentWallet.address);
        showNotification("Address copied.", "success");
      } catch {
        showNotification("Clipboard blocked. Copy manually.", "error");
      }
    });

    el("btnRevealSeed")?.addEventListener("click", async () => {
      const ok = await openModal({
        title: "Reveal seed?",
        confirmText: "Reveal",
        cancelText: "Cancel",
        bodyHTML: `
          <div style="padding:10px; border-radius:14px; border:1px solid rgba(255,255,255,0.10); background: rgba(255,110,110,0.08);">
            Revealing the seed makes it visible on-screen. Do this only in a private place.
          </div>
        `
      });
      if (!ok) return;

      seedRevealed = true;
      const seedBox = el("seedBox");
      if (seedBox) seedBox.textContent = currentWallet.seed;
      const copyBtn = el("btnCopySeed");
      if (copyBtn) copyBtn.disabled = false;
      showNotification("Seed revealed (be careful).", "info");
    });

    el("btnCopySeed")?.addEventListener("click", async () => {
      if (!seedRevealed) return;
      try {
        await navigator.clipboard.writeText(currentWallet.seed);
        showNotification("Seed copied. Clear clipboard if needed.", "success");
      } catch {
        showNotification("Clipboard blocked. Copy manually.", "error");
      }
    });

    el("btnRefreshBalance")?.addEventListener("click", async () => {
      await fetchAndRenderBalance();
    });

    // Load balance once when wallet UI opens
    fetchAndRenderBalance();
  }

  async function fetchAndRenderBalance() {
    const box = el("balance-info");
    if (!box || !currentWallet?.address) return;

    box.innerHTML = `<div class="loading" style="padding: 10px;">Loading balance…</div>`;

    try {
      // Prefer the existing app connection if present
      const client =
        window.XRPL?.client ||
        window.xrplConnection ||
        window.xrplClient ||
        window.__xrplClient ||
        null;

      const connected = !!(window.XRPL?.connected || window.xrplConnection?.isConnected || window.xrplClient?.isConnected);

      if (!client || typeof client.request !== "function" || !connected) {
        box.innerHTML = `<div style="color:#888; font-size:0.9em;">Not connected to XRPL (connect from dashboard).</div>`;
        return;
      }

      const res = await client.request({
        command: "account_info",
        account: currentWallet.address,
        ledger_index: "validated"
      });

      const drops = res?.result?.account_data?.Balance;
      const balance = (parseInt(drops, 10) / 1_000_000);
      const shown = Number.isFinite(balance) ? balance.toFixed(6).replace(/\.?0+$/, "") : "0";

      box.innerHTML = `
        <div style="background: rgba(0,0,0,0.28); padding: 12px; border-radius: 12px; border:1px solid rgba(255,255,255,0.10);">
          <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px; font-weight:900;">Balance</div>
          <div style="font-size: 1.5em; font-weight: 900; color: var(--accent-secondary);">${shown} XRP</div>
        </div>
      `;
    } catch (err) {
      box.innerHTML = `<div style="color:#888; font-size:0.9em;">Account not found or not funded on this network.</div>`;
    }
  }

  // -------------------------------------------------------
  // Bio (local-only)
  // -------------------------------------------------------
  function saveBio() {
    const bio = el("profile-bio")?.value ?? "";
    try {
      localStorage.setItem(LS_BIO, String(bio));
      showNotification("Bio saved locally.", "success");
    } catch {
      showNotification("Could not save bio (storage blocked).", "error");
    }
  }

  function loadBio() {
    try {
      const bio = localStorage.getItem(LS_BIO);
      if (bio != null) {
        const inp = el("profile-bio");
        if (inp) inp.value = bio;
      }
    } catch {
      // ignore
    }
  }

  async function clearBio() {
    const ok = await openModal({
      title: "Clear bio?",
      confirmText: "Clear",
      cancelText: "Cancel",
      bodyHTML: `This removes your bio from local storage on this browser.`
    });
    if (!ok) return;

    try {
      localStorage.removeItem(LS_BIO);
    } catch {}
    const inp = el("profile-bio");
    if (inp) inp.value = "";
    showNotification("Bio cleared.", "success");
  }

  // -------------------------------------------------------
  // Safety: clear sensitive UI on hide/unload
  // -------------------------------------------------------
  function hardenLifecycle() {
    // When page is hidden, hide the seed again (UI)
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        seedRevealed = false;
        const seedBox = el("seedBox");
        if (seedBox) seedBox.textContent = "Hidden (click reveal)";
        const copyBtn = el("btnCopySeed");
        if (copyBtn) copyBtn.disabled = true;
      }
    });

    // Optional: lock wallet on unload (memory-only)
    window.addEventListener("beforeunload", () => {
      currentWallet = null;
      seedRevealed = false;
    });
  }

  // -------------------------------------------------------
  // Public hook (your app expects initProfile)
  // -------------------------------------------------------
  window.initProfile = initProfile;

  document.addEventListener("DOMContentLoaded", () => {
    hardenLifecycle();
    const profileEl = el("profile");
    if (profileEl && profileEl.classList.contains("active")) {
      initProfile();
    }
    console.log(`👤 Profile module loaded (${VERSION})`);
  });
})();
