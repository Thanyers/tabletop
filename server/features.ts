import { z } from 'zod';
import type { RouteExtension } from './app.js';
import { processUpload } from './artifacts.js';
import { hashValue } from './codec.js';
import { exportInvoice } from '../src/tabletop/shared/export-invoice.js';
import { AuthorityError } from './errors.js';
import type { PrivateObjectStore } from './storage.js';
import { DomainError } from '../src/tabletop/shared/contracts.js';

const uploadRequest = z.strictObject({
  filename: z.string().min(1).max(200), mime: z.string().max(100),
  kind: z.enum(['shipments', 'invoice', 'rate-card', 'excerpt']), dataBase64: z.string().max(14_000_000),
  commandId: z.string().uuid(), expectedRevision: z.string().min(1).max(200), expectedEpoch: z.number().int().positive(),
});

/** Feature routes share the same session, Origin, CSRF and command authority. */
export function featureRoutes(options: { objects: PrivateObjectStore; localUploads: boolean }): RouteExtension {
  let parsing = 0;
  return async context => {
    const { request, response, url, authority } = context;
    if (url.pathname === '/api/capabilities' && request.method === 'GET') {
      context.json(200, { uploads: options.localUploads,
        tableAssistant: { available: false, reason: 'Conversation is not available in this local workspace. You can continue using the Canvas and reviewing rules.' },
        model: { enabled: false, reason: 'Provider and budget will be selected after local validation.' } });
      return true;
    }
    const match = /^\/api\/workspaces\/([0-9a-f-]{36})\/(uploads|export|model|sources\/([0-9a-f-]{36}))$/i.exec(url.pathname);
    if (!match) return false;
    const [, workspaceId, action, sourceId] = match;
    const authorized = await context.authorize(workspaceId);
    if (authorized.member.role !== 'owner' || authorized.workspace.domain.kind !== 'invoice') throw new AuthorityError('ROLE_FORBIDDEN');
    const state = authorized.workspace.domain;
    if (action === 'uploads' && request.method === 'POST') {
      context.requireMutation(authorized.session);
      if (!options.localUploads) throw new AuthorityError('UPLOAD_SERVICE_NOT_CONFIGURED', 'Public uploads require a configured private object store and scanner.', 503);
      const parsed = uploadRequest.safeParse(await context.readJsonBody(14_500_000));
      if (!parsed.success) throw new AuthorityError('UPLOAD_INPUT', 'The upload is incomplete or exceeds the supported limit.', 422);
      const { commandId, expectedRevision, expectedEpoch, ...file } = parsed.data;
      const envelope = { commandId, expectedRevision, expectedEpoch, type: 'invoice.import', payload: {} };
      const fingerprint = hashValue(file);
      const receipt = await authority.findTrustedReceipt(authorized.session, workspaceId, envelope, fingerprint);
      if (receipt) { context.json(200, receipt); return true }
      if (state.sources.length >= 20) throw new AuthorityError('SOURCE_QUOTA', 'This table holds at most 20 evidence sources. Export your work and start another table.', 429);
      if (parsing >= 2) throw new AuthorityError('UPLOAD_BUSY', 'Two files are being read. Try again shortly.', 429);
      parsing += 1;
      let stagedKey: string | undefined;
      try {
        const imported = await processUpload(file, authorized.context, options.objects);
        stagedKey = imported.artifact.id;
        const ack = await authority.executeTrusted(authorized.session, envelope, imported, workspaceId, fingerprint);
        if (ack.duplicate) await options.objects.remove(stagedKey);
        stagedKey = undefined;
        context.json(200, ack);
      } catch (error) {
        if (stagedKey) await options.objects.remove(stagedKey);
        if (error instanceof DomainError) throw new AuthorityError(error.code, error.message, 422);
        throw error;
      } finally { parsing -= 1 }
      return true;
    }
    if (action === 'export' && request.method === 'GET') {
      const format = url.searchParams.get('format');
      if (format !== 'csv' && format !== 'html') throw new AuthorityError('EXPORT_FORMAT', 'Choose CSV or HTML.', 400);
      const body = exportInvoice(state, format);
      response.writeHead(200, { 'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="tabletop-reconciliation-r${state.ruleRevision}.${format}"`, 'cache-control': 'no-store' });
      response.end(body);
      return true;
    }
    if (sourceId && request.method === 'GET') {
      const source = state.sources.find(item => item.id === sourceId);
      if (!source) throw new AuthorityError('NOT_FOUND', 'Source not found.', 404);
      let bytes: Uint8Array;
      try { bytes = await options.objects.get(source.id) } catch { throw new AuthorityError('NOT_FOUND', 'Source file is unavailable.', 404) }
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="source"; filename*=UTF-8''${encodeURIComponent(source.filename).replaceAll("'", '%27')}`, 'cache-control': 'no-store', 'content-length': bytes.byteLength });
      response.end(bytes);
      return true;
    }
    if (action === 'model' && request.method === 'POST') {
      context.requireMutation(authorized.session);
      throw new AuthorityError('MODEL_NOT_CONFIGURED', 'ยังไม่ได้เลือกบริการ AI และงบ ใช้ตัวแก้ไขกฎเพื่อทดลองในเครื่องได้', 503);
    }
    throw new AuthorityError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  };
}
