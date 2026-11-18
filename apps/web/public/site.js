// The website's one small script (DS1). Every page works without it; it only makes these things quicker:
//   1. WEB4a: the village picker (the header's chip, the home page, /village): the search box filters the villages as you type, and
//      "Use my location" asks the phone for its position ONLY when the visitor taps it (never on page load), sends it once to /village/locate,
//      which keeps the village only. Escape or a tap outside closes an open picker.
//   2. Search: results follow the typing. After a pause it asks this site's own /search page and swaps the results in.
//   3. WEB4a: an aisle's filters apply when one changes.
//   4. WEB2: the checkout's "Use my location": the phone's own position fills the form, once, when the visitor taps it.
// It talks to this site only, keeps nothing, and sets no cookie.
(function () {
  "use strict";
  var fold = function (x) { return (x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f\u064b-\u0652]/g, "").replace(/[-'\s]+/g, " ").trim(); };
  Array.prototype.forEach.call(document.querySelectorAll("[data-picker]"), function (p) {
    var row = p.querySelector("[data-picker-search-row]"), box = p.querySelector("[data-picker-search]"), none = p.querySelector("[data-picker-none]");
    if (row && box) {
      row.hidden = false;
      box.addEventListener("input", function () {
        var q = fold(box.value), any = false;
        Array.prototype.forEach.call(p.querySelectorAll("[data-picker-group]"), function (g) {
          var shown = 0;
          Array.prototype.forEach.call(g.querySelectorAll("[data-picker-item]"), function (li) {
            var ok = !q || fold(li.getAttribute("data-name")).indexOf(q) !== -1 || fold(li.textContent).indexOf(q) !== -1;
            li.hidden = !ok; if (ok) shown++;
          });
          g.hidden = shown === 0; if (shown) any = true;
        });
        if (none) none.hidden = any;
      });
    }
    var form = p.querySelector("[data-locate-form]");
    if (form && navigator.geolocation) {
      form.hidden = false;
      var label = form.querySelector("[data-locate-label]"), err = form.querySelector("[data-locate-error]"), btn = form.querySelector("[data-locate]");
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (btn.disabled) return;
        btn.disabled = true; if (err) err.hidden = true;
        var was = label ? label.textContent : ""; if (label) label.textContent = label.getAttribute("data-busy");
        navigator.geolocation.getCurrentPosition(function (pos) {
          form.elements.lat.value = String(pos.coords.latitude); form.elements.lng.value = String(pos.coords.longitude);
          HTMLFormElement.prototype.submit.call(form);
        }, function () {
          btn.disabled = false; if (label) label.textContent = was; if (err) err.hidden = false;
        }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
      });
    }
  });
  // WEB4a stage 2: an aisle's filters apply as soon as one changes (the Show button stays for no script).
  Array.prototype.forEach.call(document.querySelectorAll("form[data-autosubmit]"), function (f) {
    var b = f.querySelector("[data-autosubmit-button]"); if (b) b.hidden = true;
    f.addEventListener("change", function () { HTMLFormElement.prototype.submit.call(f); });
  });
  var roots = document.querySelectorAll("details[data-picker-root], header details");
  Array.prototype.forEach.call(roots, function (d) {
    var close = d.querySelector("[data-picker-close]");
    if (close) { close.hidden = false; close.addEventListener("click", function () { d.open = false; }); }
    d.addEventListener("toggle", function () { if (d.open) { var b = d.querySelector("[data-picker-search]"); if (b && window.matchMedia("(min-width: 640px)").matches) b.focus(); } });
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") Array.prototype.forEach.call(roots, function (d) { d.open = false; }); });
  document.addEventListener("click", function (e) { Array.prototype.forEach.call(roots, function (d) { if (d.open && !d.contains(e.target)) d.open = false; }); });

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

  var geo = document.querySelector("[data-geo]");
  if (geo && navigator.geolocation) {
    geo.addEventListener("click", function (e) {
      var f = geo.form; if (!f) return;
      e.preventDefault();
      navigator.geolocation.getCurrentPosition(function (p) {
        f.elements.lat.value = String(p.coords.latitude); f.elements.lng.value = String(p.coords.longitude);
        var h = document.createElement("input"); h.type = "hidden"; h.name = "do"; h.value = "pin"; f.appendChild(h); f.submit();
      }, function () { geo.disabled = true; }, { enableHighAccuracy: true, timeout: 15000 });
    });
  }
})();
