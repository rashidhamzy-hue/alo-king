/**
 * Public pages are server-rendered, and everything above the fold works without JavaScript (links, the WhatsApp button, the
 * FAQ, the menu). So the framework's script is fetched after the page has loaded, not beside the stylesheet and fonts: on a
 * simulated 4G phone the early script downloads (15 or more files) delayed the first paint by about 0.7 s (DECISIONS §37.5:
 * LCP under 2.5 s). Once the page has loaded, hydration starts 150 ms after the browser records the page's largest content, or
 * 1.5 s after the load event if it has not, or at once where the browser cannot report it. The scripts are then never part of
 * what the first paint waited for. Until it starts, only the controls that need JavaScript are idle (menu quantity buttons,
 * calculator, clock zone, chat replay).
 *
 * Applied to /ar, /en and /fr HTML only (src/server.ts). If the page does not have the expected tags it is returned unchanged.
 */
export function deferHydration(html: string): string {
  const withoutPreloads = html.replace(/<link rel="modulepreload"[^>]*>/g, "");
  return withoutPreloads.replace(
    /<script type="module" async="" src="([^"]+)"><\/script>/,
    (_m, src: string) =>
      `<script>addEventListener("load",function(){var d=0;function go(){if(!d){d=1;import(${JSON.stringify(src)})}}` +
      `var t=window.PerformanceObserver&&PerformanceObserver.supportedEntryTypes;` +
      `if(!t||t.indexOf("largest-contentful-paint")<0){go()}else{` +
      `try{new PerformanceObserver(function(l,o){o.disconnect();setTimeout(go,150)}).observe({type:"largest-contentful-paint",buffered:true})}catch(e){go()}}` +
      `setTimeout(go,1500)})</script>`,
  );
}
