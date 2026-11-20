import { describe, expect, it } from 'vitest';
import { admin, clerk, setupAdmin } from './admin-helper';

const PDF = new TextEncoder().encode('%PDF-1.4 test bytes');
const MB10 = 10 * 1024 * 1024;

async function withCase() {
  const s = await setupAdmin();
  const p = await s.activePartner();
  const c = await s.repo.createCase({ partnerId: p.id, clientName: '李先生', licenceType: '营业执照', price: 1800 } as never, 't');
  const q = (name: string, kind = 'IC') => `/api/admin/cases/${c.id}/documents?filename=${encodeURIComponent(name)}&kind=${encodeURIComponent(kind)}`;
  const upload = (name: string, over: { type?: string; length?: string | null; body?: Uint8Array; kind?: string; who?: typeof admin | null } = {}) => {
    const headers: Record<string, string> = { 'Content-Type': over.type ?? 'application/pdf' };
    const body = over.body ?? PDF;
    if (over.length !== null) headers['Content-Length'] = over.length ?? String(body.byteLength);
    return s.rawReq(over.who === undefined ? admin : over.who, 'PUT', q(name, over.kind), body, headers);
  };
  const audits = () => (s.repo as any).auditLog as Array<{ by: string; action: string; entity: string; id: string }>;
  return { ...s, c, upload, q, audits };
}

describe('document upload', () => {
  it('needs a staff sign-in', async () => {
    const { upload, c, req } = await withCase();
    expect((await upload('a.pdf', { who: null })).status).toBe(401);
    expect((await req(null, 'GET', `/api/admin/cases/${c.id}/documents`)).status).toBe(401);
    expect((await req(null, 'GET', '/api/admin/documents/00000000-0000-4000-8000-000000000001/download')).status).toBe(401);
  });

  it('stores the file, saves the row, audits, and returns it without storagePath', async () => {
    const { upload, storage, repo, c, json, audits } = await withCase();
    const res = await upload('SSM 证书.pdf', { kind: 'SSM' });
    expect(res.status).toBe(201);
    const doc = await json(res);
    expect(doc).toMatchObject({ caseId: c.id, filename: 'SSM 证书.pdf', kind: 'SSM', uploadedBy: admin.email });
    expect(doc).not.toHaveProperty('storagePath');
    const rows = await repo.listDocuments(c.id);
    expect(rows).toHaveLength(1);
    const path = rows[0].storagePath;
    expect(path).toMatch(new RegExp(`^${c.id}/[0-9a-f-]{36}-SSM___\\.pdf$`));
    expect([...storage.files.get(path)!.bytes]).toEqual([...PDF]);
    expect(storage.files.get(path)!.contentType).toBe('application/pdf');
    expect(audits().at(-1)).toMatchObject({ by: admin.email, action: 'document.upload', entity: 'case', id: c.id });
  });

  it('streams the body: storage receives a ReadableStream with the declared length', async () => {
    const { upload, storage } = await withCase();
    await upload('a.pdf');
    expect(storage.lastPut!.body).toBeInstanceOf(ReadableStream);
    expect(storage.lastPut!.length).toBe(PDF.byteLength);
    expect(storage.lastPut!.contentType).toBe('application/pdf');
  });

  it('404 for an unknown case', async () => {
    const { rawReq, json } = await withCase();
    const res = await rawReq(admin, 'PUT', '/api/admin/cases/TS-0000-999/documents?filename=a.pdf&kind=IC', PDF, { 'Content-Type': 'application/pdf', 'Content-Length': '5' });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: '找不到案件' });
  });

  it('rejects a bad kind', async () => {
    const { upload, json } = await withCase();
    const res = await upload('a.pdf', { kind: '合同' });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: '文件类型不正确' });
  });

  it('rejects a file type that is not an image or PDF', async () => {
    const { upload, json, storage } = await withCase();
    const res = await upload('virus.exe', { type: 'application/x-msdownload' });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: '只接受图片或 PDF' });
    expect(storage.files.size).toBe(0);
  });

  it('accepts the allowed image types, with or without a parameter', async () => {
    const { upload } = await withCase();
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'IMAGE/PNG; foo=bar']) {
      expect((await upload('p.img', { type })).status).toBe(201);
    }
  });

  it('rejects a file over 10 MB without storing it', async () => {
    const { upload, json, storage } = await withCase();
    const res = await upload('big.pdf', { length: String(MB10 + 1) });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: '文件不能超过 10 MB' });
    expect(storage.files.size).toBe(0);
    expect((await upload('edge.pdf', { length: String(MB10) })).status).toBe(201);
  });

  it('411 when the length is not declared', async () => {
    const { upload, json } = await withCase();
    const res = await upload('a.pdf', { length: null });
    expect(res.status).toBe(411);
    expect(await json(res)).toEqual({ error: '无法确定文件大小' });
  });

  it('rejects an empty file and a missing filename', async () => {
    const { upload, json } = await withCase();
    expect((await upload('a.pdf', { body: new Uint8Array(0), length: '0' })).status).toBe(400);
    const res = await upload('  ');
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: '请填写文件名' });
    expect((await upload('../..')).status).toBe(400);
  });

  it('a path-traversal filename gives a safe storage path and a plain display name', async () => {
    const { upload, repo, c, json } = await withCase();
    const doc = await json(await upload('../../etc/passwd'));
    expect(doc.filename).toBe('passwd');
    const [row] = await repo.listDocuments(c.id);
    expect(row.storagePath).not.toContain('..');
    expect(row.storagePath.split('/')).toHaveLength(2);
    expect(row.storagePath.startsWith(`${c.id}/`)).toBe(true);
    const win = await json(await upload('C:\\Users\\x\\..\\secret...pdf'));
    expect(win.filename).toBe('secretpdf');
    for (const d of await repo.listDocuments(c.id)) expect(d.storagePath).not.toMatch(/\.\.|\\/);
  });

  it('keeps a Chinese display name, strips control characters, and caps lengths', async () => {
    const { upload, repo, c, json } = await withCase();
    const doc = await json(await upload('店面\u0000照片\n.jpg', { type: 'image/jpeg' }));
    expect(doc.filename).toBe('店面照片.jpg');
    const long = await json(await upload(`${'长'.repeat(150)}.pdf`));
    expect([...long.filename].length).toBe(100);
    const rows = await repo.listDocuments(c.id);
    const name = rows[1].storagePath.split('/')[1];
    expect(name.length).toBeLessThanOrEqual(36 + 1 + 60);
    expect(name.slice(37)).toMatch(/^[A-Za-z0-9._-]*$/);
  });

  it('503 when storage is down, and nothing is saved or audited', async () => {
    const { upload, storage, repo, c, json, audits } = await withCase();
    storage.down = true;
    const res = await upload('a.pdf');
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: '文件服务暂时无法连接，请稍后再试' });
    expect(await repo.listDocuments(c.id)).toEqual([]);
    expect(audits().some((a) => a.action === 'document.upload')).toBe(false);
  });
});

describe('document list and download', () => {
  it('lists a case documents without storagePath', async () => {
    const { upload, req, c, json } = await withCase();
    await upload('a.pdf');
    await upload('b.pdf', { kind: 'SSM' });
    const res = await req(clerk, 'GET', `/api/admin/cases/${c.id}/documents`);
    expect(res.status).toBe(200);
    const list = await json(res);
    expect(list.map((d: any) => d.filename)).toEqual(['a.pdf', 'b.pdf']);
    for (const d of list) expect(d).not.toHaveProperty('storagePath');
    expect(list[0]).toMatchObject({ caseId: c.id, kind: 'IC', uploadedBy: admin.email });
  });

  it('404 listing an unknown case', async () => {
    const { req, json } = await withCase();
    const res = await req(admin, 'GET', '/api/admin/cases/TS-0000-999/documents');
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: '找不到案件' });
  });

  it('streams the file with private headers and the exact bytes', async () => {
    const { upload, req, json, audits } = await withCase();
    const doc = await json(await upload('店面 照片.pdf'));
    const res = await req(clerk, 'GET', `/api/admin/documents/${doc.id}/download`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('店面 照片.pdf')}`);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...PDF]);
    expect(audits().at(-1)).toMatchObject({ by: clerk.email, action: 'document.download', entity: 'document', id: doc.id });
  });

  it('404 for an unknown or malformed document id, or a missing stored file', async () => {
    const { req, upload, storage, json } = await withCase();
    for (const id of ['11111111-1111-4111-8111-111111111111', 'nope']) {
      const res = await req(admin, 'GET', `/api/admin/documents/${id}/download`);
      expect(res.status).toBe(404);
      expect(await json(res)).toEqual({ error: '找不到文件' });
    }
    const doc = await json(await upload('a.pdf'));
    storage.files.clear();
    expect((await req(admin, 'GET', `/api/admin/documents/${doc.id}/download`)).status).toBe(404);
  });

  it('503 when storage is down during download', async () => {
    const { req, upload, storage, json } = await withCase();
    const doc = await json(await upload('a.pdf'));
    storage.down = true;
    const res = await req(admin, 'GET', `/api/admin/documents/${doc.id}/download`);
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: '文件服务暂时无法连接，请稍后再试' });
  });
});
