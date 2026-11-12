import { put, get, del } from '@vercel/blob';
import { Readable } from 'node:stream';
import { createServer } from '../src/core.mjs';
import { DocumentStore } from '../src/storage.mjs';
import { interpreter } from '../dist/interpreter.mjs';
import { nodeNetwork } from '../src/node-network.mjs';

function supabaseDocumentStore() {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) throw Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required');
  const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const endpoint = `${base.replace(/\/$/, '')}/rest/v1/server_state`;
  const request = async (url, init) => {
    const response = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers || {}) } });
    if (response.status === 409) return null;
    if (!response.ok) throw Error(`Supabase storage returned ${response.status}`);
    return response.status === 204 ? [] : response.json();
  };
  return new DocumentStore({
    read: async () => {
      const rows = await request(`${endpoint}?id=eq.1&select=id,version,data`, { method: 'GET' });
      return rows?.[0] || null;
    },
    cas: async (version, data) => {
      if (version < 0) {
        const rows = await request(endpoint, { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ id: 1, version: 0, data }) });
        return Array.isArray(rows) && rows.length === 1;
      }
      const rows = await request(`${endpoint}?id=eq.1&version=eq.${encodeURIComponent(version)}`, {
        method: 'PATCH', headers: { prefer: 'return=representation' },
        body: JSON.stringify({ version: version + 1, data, updated_at: new Date().toISOString() }),
      });
      return Array.isArray(rows) && rows.length === 1;
    },
  });
}

export default async function handler(req, res) {
  try {
    const app = await createServer({
      platform: 'vercel',
      store: supabaseDocumentStore(),
      secret: process.env.SERVER_SECRET,
      bootstrapSecret: process.env.BOOTSTRAP_SECRET,
      interpreter,
      network: nodeNetwork(),
      artifacts: {
        put: (key, value) => put(`extensions/${key}`, value, { access: 'private', addRandomSuffix: false }),
        get: async key => { const result = await get(`extensions/${key}`, { access: 'private' }); if (!result) throw Error('Extension artifact missing'); return new Response(result.stream).text(); },
        remove: key => del(`extensions/${key}`),
      },
    });
    const abort = new AbortController();
    req.on('aborted', () => abort.abort());
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    const target = new URL(req.url, process.env.PUBLIC_URL);
    if (target.searchParams.has('serverPath')) {
      target.pathname = '/api/server/' + target.searchParams.get('serverPath');
      target.searchParams.delete('serverPath');
    }
    const parsedBody = req.body !== undefined ? (typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body)) : Readable.toWeb(req);
    const request = new Request(target, { method: req.method, headers: req.headers, signal: abort.signal, ...(!['GET', 'HEAD'].includes(req.method) ? { body: parsedBody, duplex: 'half' } : {}) });
    const response = await app(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res); else res.end();
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ success: false, error: { code: 'deployment_configuration', message: error?.message || 'Check this deployment configuration.' } }));
  }
}
