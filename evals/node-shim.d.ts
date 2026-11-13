// The worker is typed for Cloudflare, not Node. The eval scripts run under Node and use only these calls.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string): string[];
  export function writeFileSync(path: string, data: string): void;
  export function appendFileSync(path: string, data: string): void;
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  export function existsSync(path: string): boolean;
}
declare module "node:url" {
  export function fileURLToPath(url: URL | string): string;
}
