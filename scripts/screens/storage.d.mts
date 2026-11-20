export interface ScreensStore {
  list(): Promise<string[]>;
  listDetailed(): Promise<{ path: string; at: string; size: number }[]>;
  put(path: string, body: Uint8Array | ArrayBuffer | string, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  sign(paths: string[], seconds?: number): Promise<{ path: string; url: string | null }[]>;
  open(path: string): Promise<number>;
}
export function screensStore(o: { url: string; key: string; fetchImpl?: typeof fetch }): ScreensStore;
