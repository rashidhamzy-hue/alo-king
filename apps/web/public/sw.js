// The service worker caches the shell (the stylesheet, the icons, an offline page) and the catalog pages the visitor opened, so they can be
// read with no signal. It never caches search, the language switch, or anything that is not a page of the catalog; ordering always needs
// the network, and a page is always fetched from the network first, so price and stock are never older than the visitor's last visit
// to that page while online.
// The cache names carry a version. Raise it whenever the look, the icons or the manifest change (v2: the redesign of 15 November):
// a new name changes this file, so browsers install the new worker, and its activate step below deletes every older ak- cache.
// Without that, a phone that visited before kept the old manifest, icons and pages for ever.
var SHELL = "ak-shell-v2", PAGES = "ak-pages-v2", MAX_PAGES = 60;
var PAGE_PATH = /^\/(?:$|c\/[^/]+$|p\/[^/]+$|privacy$|terms$)/;
var LANG_KEY = "/__lang";

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(["/offline", "/manifest.webmanifest", "/icons/icon-192.png"]); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("ak-") === 0 && k !== SHELL && k !== PAGES; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function pageKey(url, lang) { return url.pathname + "#" + (lang || ""); }

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === "navigate" && PAGE_PATH.test(url.pathname) && !url.search) { e.respondWith(page(e, req, url)); return; }
  if (req.mode === "navigate") { e.respondWith(fetch(req).catch(function () { return caches.match("/offline"); })); return; }
  if (/^\/_astro\//.test(url.pathname)) { e.respondWith(shell(req)); return; }
  // Icons and the manifest keep their names when their content changes: the network first, the kept copy only with no signal.
  if (/^\/icons\//.test(url.pathname) || url.pathname === "/manifest.webmanifest") { e.respondWith(fresh(req)); }
});

// Network first. A page that came back is kept under its path and its language (the same address differs by language).
function page(e, req, url) {
  return fetch(req).then(function (res) {
    var lang = res.headers.get("Content-Language") || "";
    var type = res.headers.get("Content-Type") || "";
    if (res.ok && type.indexOf("text/html") === 0) {
      var copy = res.clone();
      e.waitUntil(caches.open(PAGES).then(function (c) {
        return c.put(new Request(pageKey(url, lang)), copy)
          .then(function () { return c.put(LANG_KEY, new Response(lang)); })
          .then(function () { return c.keys(); })
          .then(function (keys) { var pages = keys.filter(function (k) { return k.url.indexOf("#") > -1; }); return Promise.all(pages.slice(0, Math.max(0, pages.length - MAX_PAGES)).map(function (k) { return c.delete(k); })); });
      }).catch(function () {}));
    }
    return res;
  }).catch(function () {
    return caches.open(PAGES).then(function (c) {
      return c.match(LANG_KEY).then(function (l) { return l ? l.text() : ""; }).then(function (lang) {
        return c.match(new Request(pageKey(url, lang))).then(function (hit) {
          if (hit) return hit;
          // Another language's copy of the same page is better than none; then the offline page.
          return c.keys().then(function (keys) {
            var any = keys.find(function (k) { return k.url.indexOf(url.pathname + "#") > -1; });
            return any ? c.match(any) : caches.match("/offline");
          });
        });
      });
    });
  });
}

// Network first, keeping a copy for when there is no signal.
function fresh(req) {
  return fetch(req).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(SHELL).then(function (c) { return c.put(req, copy); }).catch(function () {}); }
    return res;
  }).catch(function () { return caches.match(req); });
}

// Cache first for the shell's own files (the stylesheet's name changes with its content).
function shell(req) {
  return caches.open(SHELL).then(function (c) {
    return c.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; });
    });
  });
}
