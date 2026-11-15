// Registers the service worker. Pages work without it (and without any JavaScript).
if ("serviceWorker" in navigator) { addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); }); }
