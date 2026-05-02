(function () {
  "use strict";

  // Idempotency: a page might include the script twice by accident.
  if (window.__cwpMarketingChatLoaded) return;
  window.__cwpMarketingChatLoaded = true;

  // Resolve the script's own tag → data-brand + base URL.
  var scriptEl =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName("script");
      for (var i = scripts.length - 1; i >= 0; i--) {
        if (scripts[i].src && scripts[i].src.indexOf("/embed/chat.js") !== -1) {
          return scripts[i];
        }
      }
      return null;
    })();
  if (!scriptEl) return;

  // data-brand defaults to "cherryworks-pro" when omitted (spec). The
  // server still gates via /api/marketing/brand-info → stealth-404 if
  // that brand is disabled or missing on this host's org.
  var brandSlug = scriptEl.getAttribute("data-brand") || "cherryworks-pro";

  // data-api-base wins over the script origin so an external embed can
  // point at app.cherryworkspro.com even when the <script> is rehosted
  // on a CDN with a different origin.
  var apiBase = scriptEl.getAttribute("data-api-base");
  if (!apiBase) {
    try {
      apiBase = new URL(scriptEl.src).origin;
    } catch (_) {
      apiBase = "";
    }
  }
  // Strip trailing slash — we always concatenate `/api/...` directly.
  if (apiBase && apiBase.charAt(apiBase.length - 1) === "/") {
    apiBase = apiBase.slice(0, -1);
  }

  // ── Session token (per-brand, persisted in localStorage). ─────────
  var sessionKey = "cwpro_chat_session_" + brandSlug;
  var sessionToken = "";
  try {
    sessionToken = window.localStorage.getItem(sessionKey) || "";
  } catch (_) {
    /* private mode — keep in-memory only */
  }
  if (!sessionToken) {
    sessionToken = generateSessionToken();
    try {
      window.localStorage.setItem(sessionKey, sessionToken);
    } catch (_) {
      /* private mode — non-fatal */
    }
  }

  function generateSessionToken() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    // RFC 4122 v4 fallback (Math.random — non-cryptographic but fine
    // for an opaque session key).
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ── Bootstrap: fetch brand-info. Stealth-404 → silent no-op. ──────
  fetch(apiBase + "/api/marketing/brand-info?slug=" + encodeURIComponent(brandSlug), {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "omit",
  })
    .then(function (res) {
      if (!res.ok) return null;
      return res.json();
    })
    .then(function (info) {
      if (!info) return; // 404 / stealth gate failure → render nothing.
      mountWidget(info);
    })
    .catch(function () {
      // Network failure on bootstrap → silent. The marketing page
      // continues to function as if the widget weren't there.
    });

  function mountWidget(info) {
    var primary = info.primaryColor || "#cf3339";
    var persona = info.persona || "Assistant";
    var welcome = info.welcome || "Hi! How can I help?";

    // ── Shadow DOM host. We attach a closed shadow root so host-page ──
    // CSS (`* { box-sizing: content-box !important }` etc.) cannot bleed
    // in and deform the widget. The host element itself only carries a
    // fixed-position style; everything visible lives inside the shadow.
    var host = document.createElement("div");
    host.setAttribute("data-cwp-chat", brandSlug);
    host.style.cssText =
      "position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; width: 0; height: 0;";

    // Try closed shadow first; some very old browsers don't support
    // attachShadow. In that case fall back to inline-style isolation
    // (legacy IE-class behavior — production reach is negligible).
    var shadow;
    try {
      shadow = host.attachShadow({ mode: "closed" });
    } catch (_) {
      shadow = host;
    }

    // Inject a single namespaced stylesheet inside the shadow root.
    var style = document.createElement("style");
    style.textContent = [
      ":host, * { box-sizing: border-box; }",
      ".cwpchat-launcher {",
      "  position: fixed; right: 20px; bottom: 20px;",
      "  width: 56px; height: 56px; border-radius: 9999px;",
      "  background: " + primary + "; color: white;",
      "  border: none; cursor: pointer;",
      "  display: flex; align-items: center; justify-content: center;",
      "  box-shadow: 0 8px 24px rgba(0,0,0,0.18);",
      "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;",
      "}",
      ".cwpchat-panel {",
      "  position: fixed; right: 20px; bottom: 92px;",
      "  width: 360px; max-width: calc(100vw - 40px);",
      "  height: 520px; max-height: calc(100vh - 120px);",
      "  background: white; border-radius: 16px;",
      "  box-shadow: 0 20px 50px rgba(0,0,0,0.22);",
      "  overflow: hidden; display: none;",
      "  flex-direction: column;",
      "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;",
      "  color: #1a1a1a;",
      "}",
      ".cwpchat-panel.cwpchat-open { display: flex; }",
      ".cwpchat-header {",
      "  background: " + primary + "; color: white;",
      "  padding: 14px 16px; display: flex;",
      "  justify-content: space-between; align-items: center;",
      "}",
      ".cwpchat-title { font-weight: 600; font-size: 15px; }",
      ".cwpchat-close {",
      "  background: transparent; border: none; cursor: pointer;",
      "  color: white; padding: 4px; display: flex;",
      "}",
      ".cwpchat-log {",
      "  flex: 1; overflow-y: auto; padding: 14px;",
      "  background: #f7f7f8; display: flex; flex-direction: column;",
      "  gap: 10px; font-size: 14px; line-height: 1.45;",
      "}",
      ".cwpchat-msg {",
      "  max-width: 80%; padding: 10px 12px; border-radius: 14px;",
      "  white-space: pre-wrap; word-wrap: break-word;",
      "}",
      ".cwpchat-msg.cwpchat-user {",
      "  align-self: flex-end; background: " + primary + "; color: white;",
      "}",
      ".cwpchat-msg.cwpchat-asst {",
      "  align-self: flex-start; background: white; color: #1a1a1a;",
      "  border: 1px solid #e5e7eb;",
      "}",
      ".cwpchat-typing {",
      "  align-self: flex-start; background: white; color: #6b7280;",
      "  padding: 10px 12px; border-radius: 14px;",
      "  border: 1px solid #e5e7eb; font-style: italic;",
      "}",
      ".cwpchat-form {",
      "  display: flex; gap: 8px; padding: 12px;",
      "  border-top: 1px solid #e5e7eb; background: white;",
      "}",
      ".cwpchat-input {",
      "  flex: 1; padding: 10px 12px;",
      "  border: 1px solid #d1d5db; border-radius: 9999px;",
      "  font-family: inherit; font-size: 14px;",
      "  background: white; color: #1a1a1a; outline: none;",
      "}",
      ".cwpchat-input:focus { border-color: " + primary + "; }",
      ".cwpchat-send {",
      "  padding: 10px 16px; background: " + primary + ";",
      "  color: white; border: none; border-radius: 9999px;",
      "  font-family: inherit; font-size: 14px; font-weight: 500;",
      "  cursor: pointer;",
      "}",
      ".cwpchat-send[disabled] { opacity: 0.6; cursor: default; }",
    ].join("\n");
    shadow.appendChild(style);

    // ── Markup ─────────────────────────────────────────────────────
    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "cwpchat-launcher";
    launcher.setAttribute("aria-label", "Open chat with " + persona);
    launcher.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
      "</svg>";

    var panel = document.createElement("div");
    panel.className = "cwpchat-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", persona + " chat");

    var header = document.createElement("div");
    header.className = "cwpchat-header";
    var title = document.createElement("div");
    title.className = "cwpchat-title";
    title.textContent = persona;
    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "cwpchat-close";
    closeBtn.setAttribute("aria-label", "Close chat");
    closeBtn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
      "</svg>";
    header.appendChild(title);
    header.appendChild(closeBtn);

    var log = document.createElement("div");
    log.className = "cwpchat-log";

    var form = document.createElement("form");
    form.className = "cwpchat-form";
    var input = document.createElement("input");
    input.type = "text";
    input.className = "cwpchat-input";
    input.placeholder = "Type a message…";
    input.autocomplete = "off";
    input.maxLength = 2000;
    var sendBtn = document.createElement("button");
    sendBtn.type = "submit";
    sendBtn.className = "cwpchat-send";
    sendBtn.textContent = "Send";
    form.appendChild(input);
    form.appendChild(sendBtn);

    panel.appendChild(header);
    panel.appendChild(log);
    panel.appendChild(form);

    shadow.appendChild(launcher);
    shadow.appendChild(panel);
    document.body.appendChild(host);

    var welcomeShown = false;
    var inFlight = false;
    var disabled = false; // set true on stealth-404 mid-conversation

    function open() {
      if (disabled) return;
      panel.classList.add("cwpchat-open");
      if (!welcomeShown) {
        renderMessage("assistant", welcome);
        welcomeShown = true;
      }
      input.focus();
    }
    function close() {
      panel.classList.remove("cwpchat-open");
    }

    // Stealth-404 mid-conversation: tear the widget down silently.
    // The host page continues as if the bubble were never present.
    function silentlyDisable() {
      disabled = true;
      close();
      try {
        host.parentNode && host.parentNode.removeChild(host);
      } catch (_) {
        /* host may already be gone */
      }
    }

    launcher.addEventListener("click", open);
    closeBtn.addEventListener("click", close);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (inFlight || disabled) return;
      var text = (input.value || "").trim();
      if (!text) return;
      input.value = "";
      renderMessage("user", text);
      var typingEl = renderTyping();
      inFlight = true;
      sendBtn.setAttribute("disabled", "disabled");

      fetch(apiBase + "/api/marketing/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "omit",
        body: JSON.stringify({
          brandSlug: brandSlug,
          sessionToken: sessionToken,
          message: text,
        }),
      })
        .then(function (res) {
          // Silent-close on stealth-404. The gate flipped closed
          // mid-conversation (admin disabled, entitlement lapsed,
          // brand removed). Match the same UX as a fresh visitor
          // who would never see the bubble at all.
          if (res.status === 404) {
            typingEl.parentNode && typingEl.parentNode.removeChild(typingEl);
            silentlyDisable();
            return null;
          }
          return res.json().then(function (body) {
            return { ok: res.ok, status: res.status, body: body };
          });
        })
        .then(function (resp) {
          if (!resp) return; // 404 path already handled.
          typingEl.parentNode && typingEl.parentNode.removeChild(typingEl);
          if (resp.ok && resp.body && resp.body.reply) {
            renderMessage("assistant", resp.body.reply);
          } else if (resp.status === 429) {
            renderMessage(
              "assistant",
              "I'm getting a lot of messages right now — try again in a moment.",
            );
          } else {
            renderMessage(
              "assistant",
              "I'm temporarily unavailable. Please try again in a moment.",
            );
          }
        })
        .catch(function () {
          if (typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
          renderMessage(
            "assistant",
            "Network hiccup — please check your connection and try again.",
          );
        })
        .then(function () {
          inFlight = false;
          sendBtn.removeAttribute("disabled");
        });
    });

    function renderMessage(role, content) {
      var bubble = document.createElement("div");
      bubble.className =
        "cwpchat-msg " + (role === "user" ? "cwpchat-user" : "cwpchat-asst");
      bubble.textContent = content;
      log.appendChild(bubble);
      log.scrollTop = log.scrollHeight;
    }

    function renderTyping() {
      var el = document.createElement("div");
      el.className = "cwpchat-typing";
      el.textContent = "…";
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      return el;
    }
  }
})();
