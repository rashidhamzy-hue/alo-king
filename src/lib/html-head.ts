/**
 * Public pages are server-rendered, and everything above the fold works without JavaScript (links, the WhatsApp button, the
 * FAQ, the menu). So the framework's script is fetched after the page has loaded, not beside the stylesheet and fonts: on a
 * simulated 4G phone the early script downloads (15 or more files) delayed the first paint by about 0.7 s (DECISIONS §37.5:
 * LCP under 2.5 s). Hydration then runs as soon as the load event fires.
 *
 * Applied to /ar, /en and /fr HTML only (src/server.ts). If the page does not have the expected tags it is returned unchanged.
 */
export function deferHydration(html: string): string {
  const withoutPreloads = html.replace(/<link rel="modulepreload"[^>]*>/g, "");
  return withoutPreloads.replace(
    /<script type="module" async="" src="([^"]+)"><\/script>/,
    (_m, src: string) =>
      `<script>addEventListener("load",function(){setTimeout(function(){import(${JSON.stringify(src)})},0)})</script>`,
  );
}
