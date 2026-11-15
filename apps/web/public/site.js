// The website's one small script (DS1). Every page works without it; it only makes two things quicker:
//   1. "Do we deliver to you?": the answer appears as soon as a village is picked (the form still works with no script).
//   2. Search: results follow the typing. After a pause it asks this site's own /search page and swaps the results in.
// It talks to this site only, keeps nothing, and sets no cookie.
(function () {
  "use strict";
  var form = document.querySelector("[data-check]"), out = document.querySelector("[data-answer]");
  if (form && out) {
    var sel = form.querySelector("select");
    var fill = function (tpl, key, value) { return (tpl || "").replace("{" + key + "}", value); };
    var show = function () {
      var o = sel.options[sel.selectedIndex];
      if (!o || !o.value) { out.hidden = true; return; }
      out.querySelector("[data-line]").textContent = fill(out.getAttribute("data-yes"), "village", o.getAttribute("data-name"));
      out.querySelector("[data-fee-out]").textContent = fill(out.getAttribute("data-fee"), "fee", o.getAttribute("data-fee"));
      out.querySelector("[data-time-out]").textContent = fill(out.getAttribute("data-time"), "n", o.getAttribute("data-min"));
      out.hidden = false;
    };
    sel.addEventListener("change", show);
    form.addEventListener("submit", function (e) { e.preventDefault(); show(); });
  }

  var box = document.querySelector("[data-live-search]"), live = document.querySelector("[data-live]");
  if (box && live && window.fetch && window.DOMParser) {
    var timer = null, last = box.value.trim(), turn = 0;
    box.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var q = box.value.trim();
        if (q === last || q.length < 3) return;      // a pause on three letters or more: one request, and never for each key
        last = q;
        var mine = ++turn, url = "/search?q=" + encodeURIComponent(q);
        live.setAttribute("aria-busy", "true");
        fetch(url, { credentials: "same-origin", headers: { Accept: "text/html" } }).then(function (r) { return r.ok ? r.text() : null; }).then(function (html) {
          if (mine !== turn) return;
          live.removeAttribute("aria-busy");
          if (!html) return;
          var next = new DOMParser().parseFromString(html, "text/html").querySelector("[data-live]");
          if (!next) return;
          live.replaceChildren.apply(live, Array.prototype.slice.call(document.importNode(next, true).childNodes));
          if (window.history && history.replaceState) history.replaceState(null, "", url);
        }).catch(function () { live.removeAttribute("aria-busy"); });
      }, 600);
    });
  }
})();
