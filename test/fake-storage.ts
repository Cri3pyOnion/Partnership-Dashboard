import { StorageError, type DocStorage } from '../src/worker/storage';

export interface StoredFile {
  bytes: Uint8Array;
  contentType: string;
}

/** In-memory DocStorage. Reads the whole stream, which is fine for tests. */
export class FakeStorage implements DocStorage {
  files = new Map<string, StoredFile>();
  /** What `put` was handed, so tests can check it was a stream and which length was declared. */
  lastPut: { path: string; body: unknown; contentType: string; length: number } | null = null;
  down = false;

  async put(path: string, body: ReadableStream, contentType: string, length: number): Promise<void> {
    if (this.down) throw new StorageError('storage down');
    this.lastPut = { path, body, contentType, length };
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    this.files.set(path, { bytes, contentType });
  }

  async get(path: string): Promise<{ body: ReadableStream; contentType: string; size: number | null } | null> {
    if (this.down) throw new StorageError('storage down');
    const f = this.files.get(path);
    if (!f) return null;
    return { body: new Response(f.bytes).body!, contentType: f.contentType, size: f.bytes.byteLength };
  }
}
