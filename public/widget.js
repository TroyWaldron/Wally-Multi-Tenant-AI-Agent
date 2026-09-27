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
      ".m{max-width:85%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}" +
      ".a{background:#fff;color:#1d2433;border:1px solid #e3e7ee;align-self:flex-start}.u{background:" + cfg.color + ";color:#fff;align-self:flex-end}" +
      ".typing{font-size:12px;color:#6b7688;padding:0 14px 6px}" +
      "form{display:flex;gap:8px;padding:10px;border-top:1px solid #e3e7ee}input{flex:1;border:1px solid #d5dbe4;border-radius:999px;padding:10px 14px;font-size:14px;outline:none}input:focus{border-color:" + cfg.color + "}" +
      "button.send{border:0;border-radius:999px;background:" + cfg.color + ";color:#fff;padding:0 16px;font-weight:600;cursor:pointer}" +
      ".foot{font-size:10px;color:#9aa3b2;text-align:center;padding-bottom:6px}";
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
    form.appendChild(send);
    panel.appendChild(head);
    panel.appendChild(log);
    panel.appendChild(typing);
    panel.appendChild(form);
    panel.appendChild(el("div", { class: "foot" }, "Powered by Wally"));
    root.appendChild(panel);
    root.appendChild(launch);

    function add(role, text) {
      log.appendChild(el("div", { class: "m " + (role === "user" ? "u" : "a") }, text));
      log.scrollTop = log.scrollHeight;
    }
    add("assistant", cfg.welcome);

    launch.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) input.focus();
    });

    var busy = false;
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
          if (d.reply) add("assistant", d.reply);
          else if (d.waiting) add("assistant", "Thanks, a member of the team will reply here shortly.");
          else if (d.error) add("assistant", d.error);
        })
        .catch(function () { add("assistant", "Sorry, the connection dropped. Please try again."); })
        .finally(function () { busy = false; typing.textContent = ""; });
    });
  }
})();
