// Private file storage for case documents. Files pass through the Worker as streams, so the browser
// never sees the Supabase URL or a signed link, and the Worker never holds a whole file in memory.

/** Any storage or network failure. The HTTP layer maps it to 503. A missing file is never a StorageError. */
export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
  }
}

export interface DocStorage {
  /** `length` is the exact byte count of `body`. Never overwrites an existing path. */
  put(path: string, body: ReadableStream, contentType: string, length: number): Promise<void>;
  /** Null when there is no such file. The body is returned as a stream, untouched. */
  get(path: string): Promise<{ body: ReadableStream; contentType: string; size: number | null } | null>;
}

const BUCKET = 'case-documents';

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export class SupabaseStorage implements DocStorage {
  private readonly base: string;

  constructor(url: string, private readonly serviceKey: string, private readonly fetchImpl: typeof fetch = fetch) {
    this.base = `${url.replace(/\/+$/, '')}/storage/v1/object`;
  }

  private auth(): Record<string, string> {
    return { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey };
  }

  async put(path: string, body: ReadableStream, contentType: string, length: number): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/${BUCKET}/${encodePath(path)}`, {
        method: 'POST',
        headers: { ...this.auth(), 'Content-Type': contentType, 'Content-Length': String(length), 'x-upsert': 'false' },
        body,
      });
    } catch (err) {
      throw new StorageError('upload failed', { cause: err });
    }
    await res.body?.cancel().catch(() => {});
    if (!res.ok) throw new StorageError(`upload failed: ${res.status}`);
  }

  async get(path: string) {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/authenticated/${BUCKET}/${encodePath(path)}`, {
        method: 'GET',
        headers: this.auth(),
      });
    } catch (err) {
      throw new StorageError('download failed', { cause: err });
    }
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    if (res.status === 400) {
      // Supabase reports a missing object as HTTP 400 with statusCode "404" in the JSON body.
      const text = await res.text().catch(() => '');
      if (/"statusCode"\s*:\s*"?404"?/.test(text)) return null;
      throw new StorageError('download failed: 400');
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      throw new StorageError(`download failed: ${res.status}`);
    }
    const len = Number(res.headers.get('Content-Length'));
    return {
      body: res.body,
      contentType: res.headers.get('Content-Type') ?? 'application/octet-stream',
      size: res.headers.has('Content-Length') && Number.isFinite(len) ? len : null,
    };
  }
}

/** A DocStorage that builds the real one on first use, so a missing secret fails the call, not startup. */
export function lazyStorage(make: () => DocStorage): DocStorage {
  let real: DocStorage | undefined;
  return {
    async put(...args) {
      real ??= make();
      return real.put(...args);
    },
    async get(path) {
      real ??= make();
      return real.get(path);
    },
  };
}
