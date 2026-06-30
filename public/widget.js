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
  var sessionUrl = apiUrl.replace(/\/chat\/?$/, "/session/");
  var cssUrl = cfg.cssUrl || base + "widget.css";
  var botName = cfg.botName || "THE GUARDIAN";
  var GREETING =
    "Hello, and welcome to The Guardians. I'd be glad to help you find the right home. May I know your name?";

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Fresh session per page load — refreshing the page wipes the conversation.
  // Within a page session the bot keeps full context (server-side memory).
  var SESSION_ID = uuid();
  function sessionId() { return SESSION_ID; }
  function newSession() { SESSION_ID = uuid(); }

  // ---- build DOM inside a shadow root ----
  var host = document.createElement("div");
  host.setAttribute("data-the-guardian-widget", "");
  document.body.appendChild(host);
  var shadow = host.attachShadow({ mode: "open" });

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = cssUrl;
  shadow.appendChild(link);

  var micSvg =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z"/></svg>';

  var root = document.createElement("div");
  root.className = "tg-root";
  root.innerHTML =
    '<div class="tg-panel" role="dialog" aria-label="' + botName + ' chat">' +
      '<div class="tg-header">' +
        '<div><div class="tg-title">' + botName + "</div>" +
        '<div class="tg-sub">Real estate concierge</div></div>' +
        '<div class="tg-actions">' +
          '<button class="tg-speak active" aria-label="Toggle voice replies" title="Voice replies">&#128266;</button>' +
          '<button class="tg-restart" aria-label="Start over" title="Start over">&#10227;</button>' +
          '<button class="tg-close" aria-label="Close">&times;</button>' +
        "</div>" +
      "</div>" +
      '<div class="tg-messages"></div>' +
      '<div class="tg-suggestions"></div>' +
      '<form class="tg-input">' +
        '<button type="button" class="tg-mic" aria-label="Speak" title="Speak">' + micSvg + "</button>" +
        '<input type="text" autocomplete="off" placeholder="Type your message…" aria-label="Message" />' +
        '<button type="submit">Send</button>' +
      "</form>" +
    "</div>" +
    '<button class="tg-launcher" aria-label="Open chat">' +
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.5 3 2 6.7 2 11.2c0 2.3 1.2 4.4 3.1 5.8L4.3 21l4.4-2.1c1 .25 2.1.4 3.3.4 5.5 0 10-3.7 10-8.1S17.5 3 12 3z"/></svg>' +
    "</button>";
  shadow.appendChild(root);

  var root_ = root;
  var launcher = root.querySelector(".tg-launcher");
  var closeBtn = root.querySelector(".tg-close");
  var messagesEl = root.querySelector(".tg-messages");
  var form = root.querySelector(".tg-input");
  var input = form.querySelector("input");
  var sendBtn = form.querySelector("button[type=submit]");
  var restartBtn = root.querySelector(".tg-restart");
  var suggestionsEl = root.querySelector(".tg-suggestions");
  var micBtn = root.querySelector(".tg-mic");
  var speakBtn = root.querySelector(".tg-speak");

  var STARTERS = ["2 BHK in Bandra", "Sea-facing 3 BHK in Worli", "Ready homes in Andheri"];

  var opened = false;
  var greeted = false;

  function scrollDown() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }

  function renderRich(text) {
    return esc(text)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/\n/g, "<br>");
  }

  function addMessage(text, who) {
    var el = document.createElement("div");
    el.className = "tg-msg " + (who === "user" ? "user" : "bot");
    if (who === "user") el.textContent = text;
    else el.innerHTML = renderRich(text);
    messagesEl.appendChild(el);
    scrollDown();
  }

  function cap(s) {
    s = String(s || "");
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function addCard(rec) {
    var card = document.createElement("div");
    card.className = "tg-card";
    var badge = rec.is_exact === false ? '<span class="tg-card-badge">Close option</span>' : "";
    var pills = "";
    if (rec.configuration) pills += '<span class="tg-pill">' + esc(rec.configuration) + "</span>";
    if (rec.possession_status) pills += '<span class="tg-pill ghost">' + esc(cap(rec.possession_status)) + "</span>";
    card.innerHTML =
      '<div class="tg-card-head"><span class="tg-card-name">' + esc(rec.project_name) + "</span>" + badge + "</div>" +
      '<div class="tg-card-area">' +
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z"/></svg> ' +
      esc(rec.area || rec.location || "") + "</div>" +
      '<div class="tg-card-pills">' + pills + "</div>" +
      '<div class="tg-card-price">' + esc(rec.price_text || "Price on request") + "</div>" +
      (rec.why_it_fits ? '<div class="tg-card-why">' + esc(rec.why_it_fits) + "</div>" : "") +
      '<button class="tg-card-btn" type="button">Book a site visit</button>';
    card.querySelector(".tg-card-btn").addEventListener("click", function () {
      send("I'd like to book a site visit for " + rec.project_name + ".");
    });
    messagesEl.appendChild(card);
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

  function greet() {
    addMessage(GREETING, "bot");
    renderSuggestions();
  }

  function openPanel() {
    opened = true;
    root_.classList.add("tg-open");
    input.focus();
    if (!greeted) {
      greeted = true;
      greet();
      // Auto-start the voice agent: speak the greeting, then listen hands-free.
      speak(GREETING, autoListen);
    }
  }
  function closePanel() {
    opened = false;
    root_.classList.remove("tg-open");
    stopListening();
    stopVoice();
  }

  function restartChat() {
    newSession();
    messagesEl.innerHTML = "";
    clearSuggestions();
    greeted = true;
    opened = true;
    root_.classList.add("tg-open");
    input.focus();
    greet();
    speak(GREETING, autoListen);
  }

  // ---- voice: OpenAI TTS (speak) + MediaRecorder -> Whisper (listen) ----
  // Browser SpeechRecognition is unreliable (only real Google Chrome reaches its
  // cloud service, so Brave/Arc/etc. fail with a "network" error). We record the
  // mic and transcribe server-side via Whisper, which works in every browser.
  var listening = false;
  var voiceOn = true; // voice replies on by default

  var ttsUrl = apiUrl.replace(/\/chat\/?$/, "/tts");
  var transcribeUrl = apiUrl.replace(/\/chat\/?$/, "/transcribe");
  var currentAudio = null;

  function stopVoice() {
    if (currentAudio) { try { currentAudio.pause(); } catch (e) {} currentAudio = null; }
    if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
  }
  function browserSpeak(text, onEnd) {
    if (!window.speechSynthesis) { if (onEnd) onEnd(); return; }
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "en-IN";
      u.rate = 1.03;
      u.onend = function () { if (onEnd) onEnd(); };
      window.speechSynthesis.speak(u);
    } catch (e) { if (onEnd) onEnd(); }
  }
  // Speak via the server's STREAMING TTS — the browser plays the audio as it
  // arrives, so the voice begins almost immediately. Falls back to the browser
  // voice on error. Calls onEnd when playback finishes.
  function speak(text, onEnd) {
    if (!voiceOn) { if (onEnd) onEnd(); return; }
    var clean = String(text).replace(/[*_#`]/g, "").replace(/\s+/g, " ").slice(0, 800);
    stopVoice();
    try {
      currentAudio = new Audio(ttsUrl + "?text=" + encodeURIComponent(clean));
      currentAudio.preload = "auto";
      currentAudio.onended = function () { if (onEnd) onEnd(); };
      currentAudio.onerror = function () { browserSpeak(clean, onEnd); };
      currentAudio.play().catch(function () { browserSpeak(clean, onEnd); });
    } catch (e) {
      browserSpeak(clean, onEnd);
    }
  }

  var micBlocked = false;
  var mediaRecorder = null;
  var audioStream = null;
  var audioChunks = [];
  var audioCtx = null;
  var heardSpeech = false;
  var maxTimer = null;
  var REC_OK = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  if (!REC_OK && micBtn) micBtn.style.display = "none";

  // Hands-free: once the bot finishes speaking, start listening for the reply.
  function autoListen() {
    if (voiceOn && opened && REC_OK && !listening && !micBlocked) {
      setTimeout(startListening, 300);
    }
  }

  function startListening() {
    if (listening || micBlocked || !REC_OK) return;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(function (stream) {
        audioStream = stream;
        audioChunks = [];
        heardSpeech = false;
        listening = true;
        micBtn.classList.add("active");
        input.placeholder = "Listening…";
        try { mediaRecorder = new MediaRecorder(stream); }
        catch (e) { mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" }); }
        mediaRecorder.ondataavailable = function (ev) { if (ev.data && ev.data.size) audioChunks.push(ev.data); };
        mediaRecorder.onstop = finishRecording;
        mediaRecorder.start();
        monitorSilence(stream);
        maxTimer = setTimeout(function () { stopListening(); }, 20000); // hard cap
      })
      .catch(function () {
        micBlocked = true;
        addMessage(
          "I couldn't access your microphone. Please allow mic access for this site (click the 🎤/lock icon in the address bar → Allow), then tap the mic to talk.",
          "bot"
        );
      });
  }

  // Auto-stop ~1.2s after the user stops talking (or ~7s if they never start).
  function monitorSilence(stream) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var source = audioCtx.createMediaStreamSource(stream);
      var analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      var data = new Uint8Array(analyser.frequencyBinCount);
      var startedAt = Date.now();
      var lastLoud = 0;
      function tick() {
        if (!listening) return;
        analyser.getByteFrequencyData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) sum += data[i];
        var avg = sum / data.length;
        var now = Date.now();
        if (avg > 14) { heardSpeech = true; lastLoud = now; }
        if (heardSpeech && now - lastLoud > 1200) { stopListening(); return; }
        if (!heardSpeech && now - startedAt > 7000) { stopListening(); return; }
        requestAnimationFrame(tick);
      }
      tick();
    } catch (e) {}
  }

  function stopListening() {
    if (!listening) return;
    listening = false;
    if (micBtn) micBtn.classList.remove("active");
    clearTimeout(maxTimer);
    try {
      if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
      else finishRecording();
    } catch (e) { finishRecording(); }
  }

  function finishRecording() {
    if (audioStream) { audioStream.getTracks().forEach(function (t) { t.stop(); }); audioStream = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
    input.placeholder = "Type your message…";
    if (!heardSpeech || !audioChunks.length) { audioChunks = []; return; }
    var blob = new Blob(audioChunks, { type: "audio/webm" });
    audioChunks = [];
    var fd = new FormData();
    fd.append("audio", blob, "speech.webm");
    input.placeholder = "Transcribing…";
    fetch(transcribeUrl, { method: "POST", body: fd })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        input.placeholder = "Type your message…";
        var t = (d && d.text ? d.text : "").trim();
        if (t) send(t);
      })
      .catch(function () { input.placeholder = "Type your message…"; });
  }

  if (micBtn) {
    micBtn.addEventListener("click", function () {
      listening ? stopListening() : startListening();
    });
  }
  speakBtn.addEventListener("click", function () {
    voiceOn = !voiceOn;
    speakBtn.classList.toggle("active", voiceOn);
    speakBtn.innerHTML = voiceOn ? "&#128266;" : "&#128263;"; // 🔊 / 🔇
    if (!voiceOn) stopVoice();
  });

  launcher.addEventListener("click", function () { opened ? closePanel() : openPanel(); });
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
      body: JSON.stringify({ sessionId: sessionId(), message: text, pageUrl: window.location.href }),
    })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (res) {
        typing.remove();
        var data = res.data || {};
        var reply = data.reply || data.error || "Sorry, something went wrong. Please try again.";
        addMessage(reply, "bot");
        if (data.recommendations && data.recommendations.length) data.recommendations.forEach(addCard);
        if (data.reply) speak(reply, autoListen); // speak, then listen hands-free
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
