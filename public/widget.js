/*
 * Wally website widget. One script tag on any site (HTML, WordPress, Webflow,
 * React...):
 *
 *   <script src="https://YOUR-WALLY-DOMAIN/widget.js" data-key="wk_..." async></script>
 *
 * Renders inside a shadow root so the host site's CSS can't break it (and it
 * can't break the host). Branding, agent name and welcome text come from the
 * business's settings in Wally.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var key = script.getAttribute("data-key");
  if (!key) return console.warn("Wally widget: missing data-key");
  var base = new URL(script.src).origin;
  var storageKey = "wally_conv_" + key;

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (text) n.textContent = text;
    return n;
  }

  fetch(base + "/api/widget/config?key=" + encodeURIComponent(key))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) { if (cfg && cfg.agent) mount(cfg); });

  // A small, safe subset of markdown for agent replies: **bold**, "- " and
  // "1. " lists, and | tables |. Built with DOM nodes only, never innerHTML,
  // so nothing in a reply can inject markup.
  function inline(parent, text) {
    var parts = text.split(/\*\*(.+?)\*\*/g);
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      parent.appendChild(i % 2 ? el("strong", {}, parts[i]) : document.createTextNode(parts[i]));
    }
    return parent;
  }
  function cells(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return c.trim(); });
  }
  function rich(text) {
    var frag = document.createDocumentFragment();
    var lines = String(text || "").split(/\r?\n/);
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (/^\s*\|/.test(line)) {
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        rows = rows.filter(function (r) { return !/^\s*\|?[\s:|-]+\|?\s*$/.test(r); });
        var headers = cells(rows[0] || "");
        if (headers.length > 2) {
          // Wide tables (price lists) become one small card per row, so a
          // visitor on a phone never has to scroll sideways.
          var cards = el("div", { class: "cards" });
          rows.slice(1).forEach(function (r) {
            var row = cells(r);
            var card = el("div", { class: "card" });
            card.appendChild(inline(el("div", { class: "ct" }), row[0] || ""));
            var dl = el("dl");
            for (var k = 1; k < row.length; k++) {
              if (!row[k]) continue;
              dl.appendChild(inline(el("dt"), headers[k] || ""));
              dl.appendChild(inline(el("dd"), row[k]));
            }
            card.appendChild(dl);
            cards.appendChild(card);
          });
          frag.appendChild(cards);
          continue;
        }
        var table = el("table");
        rows.forEach(function (r, n) {
          var tr = el("tr");
          cells(r).forEach(function (c) { tr.appendChild(inline(el(n === 0 ? "th" : "td"), c)); });
          table.appendChild(tr);
        });
        var wrap = el("div", { class: "tw" });
        wrap.appendChild(table);
        frag.appendChild(wrap);
        continue;
      }
      var bullet = /^\s*(?:[-*\u2022]|\d+[.)])\s+/;
      if (bullet.test(line)) {
        var ordered = /^\s*\d/.test(line);
        var list = el(ordered ? "ol" : "ul");
        while (i < lines.length && bullet.test(lines[i])) { list.appendChild(inline(el("li"), lines[i].replace(bullet, ""))); i++; }
        frag.appendChild(list);
        continue;
      }
      var para = [];
      while (i < lines.length && lines[i].trim() && !/^\s*\|/.test(lines[i]) && !bullet.test(lines[i])) { para.push(lines[i].replace(/^#+\s*/, "")); i++; }
      var p = el("p");
      para.forEach(function (t, n) { if (n) p.appendChild(el("br")); inline(p, t); });
      frag.appendChild(p);
    }
    return frag;
  }

  function mount(cfg) {
    var host = el("div", { id: "wally-widget" });
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: "open" });
    var side = cfg.position === "left" ? "left" : "right";
    var style = el("style");
    style.textContent =
      ":host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}" +
      ".launch{position:fixed;bottom:20px;" + side + ":20px;z-index:2147483000;border:0;border-radius:999px;background:" + cfg.color + ";color:#fff;padding:12px 18px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.2)}" +
      ".panel{position:fixed;bottom:80px;" + side + ":20px;z-index:2147483000;width:min(370px,calc(100vw - 32px));height:min(540px,calc(100vh - 110px));background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden}" +
      ".panel[hidden]{display:none}" +
      ".head{background:" + cfg.color + ";color:#fff;padding:14px 16px}.head b{display:block;font-size:15px}.head span{font-size:12px;opacity:.8}" +
      ".log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f6f7f9}" +
      ".m{max-width:92%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}" +
      ".a{background:#fff;color:#1d2433;border:1px solid #e3e7ee;align-self:flex-start}.u{background:" + cfg.color + ";color:#fff;align-self:flex-end}" +
      ".typing{font-size:12px;color:#6b7688;padding:0 14px 6px}" +
      ".who{font-size:10px;text-transform:uppercase;letter-spacing:.05em;opacity:.6;margin-bottom:2px}" +
      "form{display:flex;gap:8px;padding:10px;border-top:1px solid #e3e7ee}input{flex:1;border:1px solid #d5dbe4;border-radius:999px;padding:10px 14px;font-size:14px;outline:none}input:focus{border-color:" + cfg.color + "}" +
      "button.mic{border:1px solid #d5dbe4;border-radius:999px;background:#fff;color:#1d2433;width:40px;flex:none;cursor:pointer;font-size:16px}button.mic.rec{background:#e5484d;border-color:#e5484d;color:#fff}" +
      "button.send{border:0;border-radius:999px;background:" + cfg.color + ";color:#fff;padding:0 16px;font-weight:600;cursor:pointer}" +
      ".foot{font-size:10px;color:#9aa3b2;text-align:center;padding-bottom:6px}" +
      ".a{white-space:normal}.a p{margin:0 0 6px}.a p:last-child{margin-bottom:0}.a ul,.a ol{margin:0 0 6px;padding-left:18px}.a li{margin:2px 0}" +
      ".tw{overflow-x:auto;margin:4px 0 6px}.a table{border-collapse:collapse;font-size:12.5px;min-width:100%}.a th,.a td{border-bottom:1px solid #e3e7ee;padding:5px 6px;text-align:left;vertical-align:top}.a th{background:#f3f5f8;font-weight:600;white-space:nowrap}" +
      ".cards{display:grid;gap:6px;margin:4px 0 6px}.card{border:1px solid #e3e7ee;border-radius:10px;padding:7px 9px;background:#fbfcfd}.ct{font-weight:600;font-size:13.5px}" +
      ".card dl{display:grid;grid-template-columns:auto 1fr;gap:1px 10px;margin:3px 0 0;font-size:12.5px}.card dt{color:#6b7688}.card dd{margin:0;font-weight:500}";
    root.appendChild(style);

    var launch = el("button", { class: "launch", "aria-label": "Chat with " + cfg.agent.name }, "Chat with " + cfg.agent.name);
    var panel = el("div", { class: "panel", role: "dialog", "aria-label": cfg.business + " chat" });
    panel.hidden = true;
    var head = el("div", { class: "head" });
    head.appendChild(el("b", {}, cfg.agent.name));
    head.appendChild(el("span", {}, (cfg.agent.title ? cfg.agent.title + " · " : "") + cfg.business + " · AI assistant"));
    var log = el("div", { class: "log", "aria-live": "polite" });
    var typing = el("div", { class: "typing" });
    var form = el("form");
    var input = el("input", { type: "text", placeholder: "Type your message…", "aria-label": "Message", maxlength: "2000" });
    var send = el("button", { class: "send", type: "submit" }, "Send");
    form.appendChild(input);
    // Voice notes: shown only when the business has speech to text switched
    // on and the browser can record. Tap to start, tap again to send.
    var canRecord = cfg.voice && window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    var mic = canRecord ? el("button", { class: "mic", type: "button", "aria-label": "Record a voice note", title: "Record a voice note" }, "\uD83C\uDFA4") : null;
    if (mic) form.appendChild(mic);
    form.appendChild(send);
    panel.appendChild(head);
    panel.appendChild(log);
    panel.appendChild(typing);
    panel.appendChild(form);
    panel.appendChild(el("div", { class: "foot" }, cfg.poweredBy || "Powered by Wally"));
    root.appendChild(panel);
    root.appendChild(launch);

    function add(role, text) {
      var bubble = el("div", { class: "m " + (role === "user" ? "u" : "a") }, role === "user" ? text : "");
      if (role === "staff") bubble.appendChild(el("div", { class: "who" }, "Team"));
      if (role !== "user") bubble.appendChild(rich(text));
      log.appendChild(bubble);
      // A long answer opens at its first line, so it reads top to bottom.
      log.scrollTop = role !== "user" && bubble.offsetHeight > log.clientHeight * 0.8 ? bubble.offsetTop - log.offsetTop - 10 : log.scrollHeight;
    }
    add("assistant", cfg.welcome);

    launch.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) { input.focus(); check(); }
    });

    var busy = false;
    var recorder = null, chunks = [], stopTimer = null;
    if (mic) mic.addEventListener("click", function () {
      if (recorder) return recorder.stop();
      if (busy) return;
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        chunks = [];
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
        recorder.onstop = function () {
          clearTimeout(stopTimer);
          stream.getTracks().forEach(function (t) { t.stop(); });
          var blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          recorder = null;
          mic.className = "mic";
          mic.setAttribute("aria-label", "Record a voice note");
          if (!blob.size) return;
          busy = true;
          typing.textContent = "Listening to your voice note…";
          var fd = new FormData();
          fd.append("key", key);
          fd.append("audio", blob, "note");
          fetch(base + "/api/widget/transcribe", { method: "POST", body: fd })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              busy = false;
              typing.textContent = "";
              if (d.text) { input.value = d.text; form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true })); }
              else add("assistant", d.error || "Sorry, I couldn't hear that. Please type your message.");
            })
            .catch(function () { busy = false; typing.textContent = ""; add("assistant", "Sorry, the connection dropped. Please try again."); });
        };
        recorder.start();
        mic.className = "mic rec";
        mic.setAttribute("aria-label", "Stop and send voice note");
        typing.textContent = "Recording… tap the mic again to send.";
        stopTimer = setTimeout(function () { if (recorder) recorder.stop(); }, 110000);
      }).catch(function () { add("assistant", "I can't use your microphone. Please allow it in your browser, or type your message."); });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text || busy) return;
      busy = true;
      input.value = "";
      add("user", text);
      typing.textContent = cfg.agent.name + " is typing…";
      var conv = null;
      try { conv = localStorage.getItem(storageKey); } catch (err) {}
      fetch(base + "/api/widget/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key, text: text, conversationId: conv }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.conversationId) try { localStorage.setItem(storageKey, d.conversationId); } catch (err) {}
          lastSent = Date.now();
          // Once the team has the chat, say so once and then stay quiet.
          if (d.reply) add("assistant", d.reply);
          else if (d.waiting && !waiting) add("assistant", "Thanks, a member of the team will reply here shortly.");
          else if (d.error) add("assistant", d.error);
          waiting = Boolean(d.waiting);
          schedule();
        })
        .catch(function () { add("assistant", "Sorry, the connection dropped. Please try again."); })
        .finally(function () { busy = false; typing.textContent = ""; });
    });

    // Replies the team types in the console arrive here without the guest
    // sending anything. Checks often while the team has the chat, slowly
    // otherwise, only while the chat is open, and stops after a quiet spell.
    var seenKey = "wally_seen_" + key;
    var lastSent = Date.now();
    var waiting = false;
    var timer = null;
    function schedule() {
      clearTimeout(timer);
      if (Date.now() - lastSent > 30 * 60 * 1000) return;
      timer = setTimeout(check, waiting ? 5000 : 15000);
    }
    function check() {
      var conv = null, seen = 0;
      try { conv = localStorage.getItem(storageKey); seen = Number(localStorage.getItem(seenKey)) || 0; } catch (err) {}
      if (!conv || panel.hidden || document.hidden) return schedule();
      fetch(base + "/api/widget/messages?key=" + encodeURIComponent(key) + "&conversationId=" + encodeURIComponent(conv) + "&after=" + seen)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d) return;
          waiting = Boolean(d.waiting);
          (d.messages || []).forEach(function (m) {
            add("staff", m.text);
            seen = Math.max(seen, m.id);
          });
          try { localStorage.setItem(seenKey, String(seen)); } catch (err) {}
        })
        .catch(function () {})
        .finally(schedule);
    }
    schedule();
  }
})();
