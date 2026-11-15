// Installable console (session D5): the manifest, the icons, the service worker, the page script and the offline page. All of it is
// static and public: nothing here carries a person's data, which is why it can be served before sign-in and kept on the phone.
//
// The service worker caches the SHELL only: this list, and nothing else. Pages (orders, names, money, chats), forms, the
// push calls and every other request go to the network untouched; when the network is down a page navigation shows /offline.
// test/shell.test.ts holds this: the list below is the whole of what the worker may store, and the worker's source is checked
// for any other address.
import { CSS } from "./style";
import { ICONS } from "./icons";

export const SHELL_ASSETS = ["/console.css", "/shell.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/offline"] as const;

const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };

export const MANIFEST = {
  name: "Alo King console", short_name: "Alo King", description: "Alo King staff console",
  start_url: "/?source=pwa", scope: "/", display: "standalone", orientation: "portrait", lang: "en", dir: "auto",
  background_color: "#f4f6f8", theme_color: "#0f3d5e",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

// ---------- the page script (same origin, no inline script: the CSP allows only 'self') ----------
export const SHELL_JS = `(function(){
"use strict";
if("serviceWorker" in navigator){navigator.serviceWorker.register("/sw.js",{scope:"/"}).catch(function(){});}

// Alerts: a tap asks the browser's permission (iPhone requires the tap), subscribes, and tells the server.
var box=document.querySelector("[data-push]");
function say(k){var el=box&&box.querySelector("[data-push-status]");if(el){el.textContent=box.getAttribute("data-msg-"+k)||"";}}
function key(s){var p="=".repeat((4-s.length%4)%4),b=(s+p).replace(/-/g,"+").replace(/_/g,"/"),r=atob(b),o=new Uint8Array(r.length);for(var i=0;i<r.length;i++)o[i]=r.charCodeAt(i);return o;}
function csrf(){var i=document.querySelector("input[name=_csrf]");return i?i.value:"";}
if(box){
  var supported=("serviceWorker" in navigator)&&("PushManager" in window)&&("Notification" in window);
  var on=box.querySelector("[data-push-enable]"),off=box.querySelector("[data-push-disable]");
  if(!supported){say("unsupported");if(on)on.hidden=true;if(off)off.hidden=true;}
  else{
    navigator.serviceWorker.ready.then(function(reg){return reg.pushManager.getSubscription();}).then(function(sub){
      if(sub){if(on)on.hidden=true;if(off)off.hidden=false;say("on");}else if(off){off.hidden=true;}
    }).catch(function(){});
    if(on)on.addEventListener("click",function(){
      Notification.requestPermission().then(function(p){
        if(p!=="granted"){say("denied");return null;}
        return navigator.serviceWorker.ready.then(function(reg){
          return reg.pushManager.getSubscription().then(function(s){return s||reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key(box.getAttribute("data-vapid")||"")});});
        }).then(function(sub){
          var j=sub.toJSON();
          return fetch("/push/subscribe",{method:"POST",credentials:"same-origin",body:new URLSearchParams({_csrf:csrf(),endpoint:j.endpoint,p256dh:j.keys.p256dh,auth:j.keys.auth})});
        }).then(function(r){if(!r)return;if(r.ok){say("saved");on.hidden=true;if(off)off.hidden=false;}else{say("failed");}});
      }).catch(function(){say("failed");});
    });
    if(off)off.addEventListener("click",function(){
      navigator.serviceWorker.ready.then(function(reg){return reg.pushManager.getSubscription();}).then(function(sub){
        if(!sub)return null;var ep=sub.endpoint;
        return fetch("/push/unsubscribe",{method:"POST",credentials:"same-origin",body:new URLSearchParams({_csrf:csrf(),endpoint:ep})}).then(function(){return sub.unsubscribe();});
      }).then(function(){say("removed");off.hidden=true;if(on)on.hidden=false;}).catch(function(){say("failed");});
    });
  }
}

// Names review: a, c, r and the arrow keys act on the highlighted item. Typing in a field is never taken for a shortcut.
var names=document.querySelector("[data-names]");
if(names){
  var blocks=Array.prototype.slice.call(names.querySelectorAll(".pair[data-sku]")),cur=0;
  var mark=function(scroll){blocks.forEach(function(b,k){b.classList.toggle("names-current",k===cur);});if(scroll&&blocks[cur]){blocks[cur].scrollIntoView({block:"center"});}};
  var press=function(v){var b=blocks[cur];if(!b)return;var btn=b.querySelector("button[name=decision][value="+v+"]");if(btn)btn.click();};
  document.addEventListener("keydown",function(e){
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    var el=e.target,tag=el&&el.tagName;
    if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"){
      if(e.key==="Enter"&&el.form&&el.closest(".pair[data-sku]")){var c=el.form.querySelector("button[name=decision][value=correct]");if(c){e.preventDefault();c.click();}}
      return;
    }
    if(tag==="BUTTON"&&(e.key==="Enter"||e.key===" "))return;
    var k=e.key;
    if(k==="ArrowDown"||k==="j"){cur=Math.min(blocks.length-1,cur+1);mark(true);e.preventDefault();}
    else if(k==="ArrowUp"||k==="k"){cur=Math.max(0,cur-1);mark(true);e.preventDefault();}
    else if(k==="a"){press("approve");e.preventDefault();}
    else if(k==="r"){press("reject");e.preventDefault();}
    else if(k==="c"){var b=blocks[cur],f=b&&b.querySelector("input[name=name_en]");if(f){f.focus();f.select();}e.preventDefault();}
  });
  blocks.forEach(function(b,k){b.addEventListener("focusin",function(){cur=k;mark(false);});b.addEventListener("click",function(){cur=k;mark(false);});});
  mark(false);
}
})();`;

// ---------- the service worker ----------
export function swSource(): string {
  const version = fnv(CSS + SHELL_JS + JSON.stringify(SHELL_ASSETS));
  return `// Alo King console service worker. Caches the shell only (the fixed list below); pages and data always come from the network.
// One cache with a fixed name: each install re-fetches the whole list over the old entries, so nothing older survives and the worker
// never needs to delete a cache. (version ${version} changes this file's bytes, which is what makes browsers install a new worker.)
const CACHE = "ak-shell";
const SHELL = ${JSON.stringify(SHELL_ASSETS)};
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((p) => new Request(p, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (SHELL.includes(url.pathname) && !url.search) {
    // The shell: answer from the phone, refresh it in the background.
    e.respondWith(caches.open(CACHE).then((c) => c.match(req).then((hit) => {
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; });
      return hit || net;
    })));
    return;
  }
  if (req.mode === "navigate") {
    // A page is never stored. Offline, the person sees the offline page instead of the browser's error.
    e.respondWith(fetch(req).catch(() => caches.match("/offline")));
  }
});
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {}; }
  e.waitUntil(self.registration.showNotification(d.title || "Alo King", { body: d.body || "", tag: d.tag || "alo-king", renotify: !!d.urgent, requireInteraction: !!d.urgent, data: { url: typeof d.url === "string" && d.url.startsWith("/") && !d.url.startsWith("//") ? d.url : "/" }, icon: "/icons/icon-192.png" }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const to = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((all) => {
    for (const c of all) { if ("focus" in c) { c.navigate(to); return c.focus(); } }
    return self.clients.openWindow(to);
  }));
});
`;
}

export const offlinePage = () => `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0f3d5e"><title>Offline · Alo King console</title><link rel="stylesheet" href="/console.css"></head>
<body><header class="top"><strong>Alo King console</strong></header><main><h1>No connection</h1>
<p>The console needs the internet: nothing is kept on this phone, so nothing here can be out of date. Check the connection and open the page again.</p>
<p lang="ar" dir="rtl">اللوحة تحتاج إلى الإنترنت. لا يُحفظ شيء على هذا الهاتف. تحقق من الاتصال ثم افتح الصفحة مرة أخرى.</p>
<p><a class="btn primary" href="/">Try again · حاول مرة أخرى</a></p></main></body></html>`;

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const SAFE = { "x-content-type-options": "nosniff" };

/** The unauthenticated static routes, or null when the path is not one of them. */
export function staticRoute(path: string): Response | null {
  if (path === "/manifest.webmanifest") return new Response(JSON.stringify(MANIFEST), { headers: { "content-type": "application/manifest+json", "cache-control": "max-age=300", ...SAFE } });
  if (path === "/shell.js") return new Response(SHELL_JS, { headers: { "content-type": "text/javascript", "cache-control": "max-age=300", ...SAFE } });
  // The worker file is never cached by the browser's HTTP cache, so a new shell reaches phones on their next visit.
  if (path === "/sw.js") return new Response(swSource(), { headers: { "content-type": "text/javascript", "cache-control": "no-cache", "service-worker-allowed": "/", ...SAFE } });
  if (path === "/offline") return new Response(offlinePage(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "max-age=300", ...SAFE } });
  const icon = /^\/icons\/([a-z0-9-]+\.png)$/.exec(path)?.[1];
  if (icon && ICONS[icon]) return new Response(b64(ICONS[icon]!), { headers: { "content-type": "image/png", "cache-control": "max-age=86400", ...SAFE } });
  return null;
}
