export const BUCKET: string;
export const WIDTHS: string[];
export const SESSION_ORDER: string[];
export const isImage: (path: string) => boolean;
export const contentType: (path: string) => string;
export const safeScreenPath: (path: string) => boolean;
export interface Shot { path: string; session: string; file: string; key: string; width: string | null; lang: "ar" | "en" | null; theme: "light" | "dark" | null; ref: boolean }
export function parseShot(path: string): Shot | null;
export function planPrune(existing: string[], incoming: string[]): string[];
export function referenceFor(key: string, width: string | null, paths: string[]): { key: string; paths: string[] } | null;
export interface PageGroup { key: string; shots: Shot[]; widths: string[] }
export function groupScreens(paths: string[]): { session: string; pages: PageGroup[] }[];
export const referencePaths: (paths: string[]) => string[];
