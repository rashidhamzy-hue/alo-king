// The worker is typed for Cloudflare, not Node. The eval scripts run under Node and use only these two calls.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string): string[];
}
declare module "node:url" {
  export function fileURLToPath(url: URL | string): string;
}
