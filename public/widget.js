/* THE GUARDIAN embeddable widget.
 * Embed with:
 *   <script>window.TheGuardianBotConfig = { apiUrl: "https://bot.example.com/api/chat" };</script>
 *   <script src="https://bot.example.com/widget.js"></script>
 * Renders entirely inside a Shadow DOM so host-site CSS cannot bleed in or out.
 */
(function () {
  "use strict";

  var cfg = window.TheGuardianBotConfig || {};
  var scriptEl = document.currentScript;
  var scriptSrc = scriptEl ? scriptEl.src : "";
  var base = scriptSrc ? scriptSrc.replace(/\/[^/]*$/, "/") : "/";
  var apiUrl = cfg.apiUrl || base + "api/chat";
  var cssUrl = cfg.cssUrl || base + "widget.css";
  var botName = cfg.botName || "THE GUARDIAN";

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // A fresh session per page load, so refreshing the browser restarts the chat.
  var SESSION_ID = uuid();
  function sessionId() {
    return SESSION_ID;
  }

  // ---- build DOM inside a shadow root ----
  var host = document.createElement("div");
  host.setAttribute("data-the-guardian-widget", "");
  document.body.appendChild(host);
  var shadow = host.attachShadow({ mode: "open" });

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = cssUrl;
  shadow.appendChild(link);

  var root = document.createElement("div");
  root.className = "tg-root";
  root.innerHTML =
    '<div class="tg-panel" role="dialog" aria-label="' + botName + ' chat">' +
      '<div class="tg-header">' +
        '<div><div class="tg-title">' + botName + "</div>" +
        '<div class="tg-sub">Real estate concierge</div></div>' +
        '<div class="tg-actions">' +
          '<button class="tg-restart" aria-label="Start over" title="Start over">&#10227;</button>' +
          '<button class="tg-close" aria-label="Close">&times;</button>' +
        "</div>" +
      "</div>" +
      '<div class="tg-messages"></div>' +
      '<div class="tg-suggestions"></div>' +
      '<form class="tg-input">' +
        '<input type="text" autocomplete="off" placeholder="Type your message…" aria-label="Message" />' +
        "<button type=\"submit\">Send</button>" +
      "</form>" +
    "</div>" +
    '<button class="tg-launcher" aria-label="Open chat">' +
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.5 3 2 6.7 2 11.2c0 2.3 1.2 4.4 3.1 5.8L4.3 21l4.4-2.1c1 .25 2.1.4 3.3.4 5.5 0 10-3.7 10-8.1S17.5 3 12 3z"/></svg>' +
    "</button>";
  shadow.appendChild(root);

  var panel = root.querySelector(".tg-panel");
  var launcher = root.querySelector(".tg-launcher");
  var closeBtn = root.querySelector(".tg-close");
  var messagesEl = root.querySelector(".tg-messages");
  var form = root.querySelector(".tg-input");
  var input = form.querySelector("input");
  var sendBtn = form.querySelector("button");
  var restartBtn = root.querySelector(".tg-restart");
  var suggestionsEl = root.querySelector(".tg-suggestions");

  var STARTERS = ["2 BHK in Bandra", "Sea-facing 3 BHK in Worli", "Ready homes in Andheri"];

  var opened = false;
  var greeted = false;

  function scrollDown() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function addMessage(text, who) {
    var el = document.createElement("div");
    el.className = "tg-msg " + (who === "user" ? "user" : "bot");
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollDown();
  }

  function showTyping() {
    var t = document.createElement("div");
    t.className = "tg-typing";
    t.innerHTML = "<span></span><span></span><span></span>";
    messagesEl.appendChild(t);
    scrollDown();
    return t;
  }

  function clearSuggestions() { suggestionsEl.innerHTML = ""; }

  function renderSuggestions() {
    clearSuggestions();
    STARTERS.forEach(function (text) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tg-chip";
      b.textContent = text;
      b.addEventListener("click", function () { send(text); });
      suggestionsEl.appendChild(b);
    });
  }

  function openPanel() {
    opened = true;
    root.classList.add("tg-open");
    input.focus();
    if (!greeted) {
      greeted = true;
      addMessage(
        "Hello, and welcome to The Guardians. I'd be glad to help you find the right home. May I know your name?",
        "bot"
      );
      renderSuggestions();
    }
  }
  function closePanel() {
    opened = false;
    root.classList.remove("tg-open");
  }

  // Start a brand-new conversation (new session, cleared transcript).
  function restartChat() {
    SESSION_ID = uuid();
    messagesEl.innerHTML = "";
    clearSuggestions();
    greeted = false;
    openPanel();
  }

  launcher.addEventListener("click", function () {
    opened ? closePanel() : openPanel();
  });
  closeBtn.addEventListener("click", closePanel);
  restartBtn.addEventListener("click", restartChat);

  function send(text) {
    clearSuggestions();
    addMessage(text, "user");
    input.value = "";
    sendBtn.disabled = true;
    var typing = showTyping();

    fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId(),
        message: text,
        pageUrl: window.location.href,
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        typing.remove();
        addMessage(data && data.reply ? data.reply : "Sorry, something went wrong. Please try again.", "bot");
      })
      .catch(function () {
        typing.remove();
        addMessage("I'm having trouble connecting right now. Please try again in a moment.", "bot");
      })
      .finally(function () {
        sendBtn.disabled = false;
        input.focus();
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (text) send(text);
  });

  // Let host-page buttons drive the widget (e.g. "Talk to our concierge").
  window.TheGuardianBot = { open: openPanel, close: closePanel, restart: restartChat };
})();
