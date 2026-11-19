// Staff API for case documents (private files). Bytes stream through the Worker in both directions.
import { Hono } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import type { CaseDocument } from '../../shared/types';
import { HttpError, adminErrorHandler } from '../admin-errors';
import { auditQuietly } from '../admin-support';
import { requireStaff } from '../access';
import type { AppEnv } from '../env';

export const DOC_KINDS = ['SSM', 'IC', '租约', '店面照片', '其他'];
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DISPLAY = 100;
const MAX_SAFE = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The name shown to staff: no directories, no `..`, no control characters, at most 100 characters. */
function displayName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\.{2,}/g, '').trim();
  return [...clean].slice(0, MAX_DISPLAY).join('');
}

/** The storage-safe part of a name: ASCII letters, digits, dot, dash, underscore only. */
const asciiSafe = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, MAX_SAFE);

/** Everything the browser may see about a document. The storage path stays on the server. */
const publicDoc = ({ storagePath: _omit, ...rest }: CaseDocument) => rest;

export function adminDocuments(jwks?: JWTVerifyGetKey): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.onError(adminErrorHandler);
  const staff = requireStaff({ jwks });

  r.get('/cases/:id/documents', staff, async (c) => {
    const id = c.req.param('id');
    if (!(await c.var.repo.getCase(id))) throw new HttpError(404, '找不到案件');
    return c.json((await c.var.repo.listDocuments(id)).map(publicDoc));
  });

  r.put('/cases/:id/documents', staff, async (c) => {
    const { repo, storage } = c.var;
    const caseId = c.req.param('id');
    if (!(await repo.getCase(caseId))) throw new HttpError(404, '找不到案件');

    const kind = c.req.query('kind') ?? '';
    if (!DOC_KINDS.includes(kind)) throw new HttpError(400, '文件类型不正确');

    const type = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (!TYPES.includes(type)) throw new HttpError(400, '只接受图片或 PDF');

    const lenHeader = c.req.header('Content-Length');
    if (lenHeader === undefined || !/^\d+$/.test(lenHeader)) throw new HttpError(411, '无法确定文件大小');
    const length = Number(lenHeader);
    if (length > MAX_BYTES) throw new HttpError(400, '文件不能超过 10 MB');
    const body = c.req.raw.body;
    if (length === 0 || !body) throw new HttpError(400, '文件不能为空');

    const filename = displayName(c.req.query('filename') ?? '');
    if (filename === '') throw new HttpError(400, '请填写文件名');

    const storagePath = `${caseId}/${crypto.randomUUID()}-${asciiSafe(filename)}`;
    await storage.put(storagePath, body, type, length);
    const by = c.var.staff.email;
    const doc = await repo.addDocument({ caseId, storagePath, filename, kind }, by);
    await auditQuietly(repo, by, 'document.upload', 'case', caseId, { documentId: doc.id, kind });
    return c.json(publicDoc(doc), 201);
  });

  r.get('/documents/:docId/download', staff, async (c) => {
    const { repo, storage } = c.var;
    const docId = c.req.param('docId');
    const doc = UUID.test(docId) ? await repo.getDocument(docId) : null;
    if (!doc) throw new HttpError(404, '找不到文件');
    const file = await storage.get(doc.storagePath);
    if (!file) throw new HttpError(404, '找不到文件');
    await auditQuietly(repo, c.var.staff.email, 'document.download', 'document', doc.id, { caseId: doc.caseId });
    const headers: Record<string, string> = {
      'Content-Type': file.contentType,
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(doc.filename),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (file.size !== null) headers['Content-Length'] = String(file.size);
    return new Response(file.body, { status: 200, headers });
  });

  return r;
}
