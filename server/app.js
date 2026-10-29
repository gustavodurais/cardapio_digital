import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, E, send, readJson, router } from './lib/http.js';
import { login, logout, verify, rateLimiter } from './lib/auth.js';
import { createBus } from './lib/sse.js';
import * as menu from './services/menu.js';
import { createOrder, clientOrders, ownedIds, listForKitchen, setStatus } from './services/orders.js';
import { dayStats } from './services/stats.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const CSP = "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'";

export function createApp(db, { webDir = join(here, '../web') } = {}) {
  const bus = createBus(), r = router(), loginLimit = rateLimiter(5, 60_000);
  const bearer = req => (req.headers.authorization || '').replace(/^Bearer /, '');
  const id = p => { const n = Number(p.id); if (!Number.isInteger(n) || n < 1) throw E.bad('id inválido'); return n; };
  const A = (method, path, fn) => r.add(method, path, c => { if (!verify(db, bearer(c.req))) throw E.unauth(); return fn(c); });

  r.add('GET', '/api/health', () => ({ ok: true }));
  r.add('GET', '/api/menu', () => menu.publicMenu(db));
  r.add('POST', '/api/orders', c => { c.status = 201; return createOrder(db, c.body, bus); });
  r.add('GET', '/api/orders', c => clientOrders(db, c.url.searchParams.get('ids') || ''));
  r.add('GET', '/api/stream', c => {                    // EventSource não envia headers: tokens vão na query (use HTTPS em produção)
    const q = c.url.searchParams;
    if (q.get('t')) { if (!verify(db, q.get('t'))) throw E.unauth(); bus.subscribe(c.req, c.res, { kitchen: true }); }
    else bus.subscribe(c.req, c.res, { kitchen: false, ids: ownedIds(db, q.get('orders') || '') });
  });
  r.add('POST', '/api/auth/login', c => {
    if (!loginLimit(c.req.socket.remoteAddress)) throw E.tooMany();
    const token = login(db, c.body.pin); if (!token) throw new HttpError(401, 'Senha incorreta'); return { token };
  });
  A('POST', '/api/auth/logout', c => { logout(db, bearer(c.req)); return { ok: true }; });
  A('GET', '/api/admin/catalog', () => menu.adminCatalog(db));
  A('GET', '/api/admin/orders', () => listForKitchen(db));
  A('PATCH', '/api/admin/orders/:id', c => setStatus(db, id(c.params), c.body.status, bus));
  A('GET', '/api/admin/stats', () => dayStats(db));
  A('PUT', '/api/admin/settings', c => { menu.setSettings(db, c.body); return { ok: true }; });
  for (const name of ['cats', 'tables', 'groups', 'items']) {
    const m = menu[name];
    A('POST', `/api/admin/${name}`, c => { c.status = 201; return m.create(db, c.body); });
    A('PUT', `/api/admin/${name}/:id`, c => { m.update(db, id(c.params), c.body); return { ok: true }; });
    A('DELETE', `/api/admin/${name}/:id`, c => { m.remove(db, id(c.params)); return { ok: true }; });
  }

  async function serveStatic(res, pathname) {
    const file = resolve(join(webDir, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(resolve(webDir))) throw E.notFound();
    try {
      const body = await readFile(file), ext = extname(file);
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache', ...(ext === '.html' ? { 'content-security-policy': CSP } : {}) }); res.end(body);
    } catch { throw E.notFound(); }
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer'); res.setHeader('x-frame-options', 'DENY');
    try {
      const url = new URL(req.url, 'http://x');
      if (!url.pathname.startsWith('/api/')) { if (!['GET', 'HEAD'].includes(req.method)) throw E.notFound(); return await serveStatic(res, decodeURIComponent(url.pathname)); }
      const hit = r.find(req.method, url.pathname); if (!hit) throw E.notFound();
      const ctx = { req, res, url, params: hit.params, status: 200, body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : {} };
      const out = await hit.fn(ctx);
      if (!res.headersSent) send(res, ctx.status, out);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      const m = String(e.message);
      if (m.includes('UNIQUE')) return send(res, 409, { error: 'Já existe um registro com esse nome' });
      if (m.includes('FOREIGN KEY')) return send(res, 409, { error: 'Registro em uso: remova ou mova os itens vinculados antes' });
      console.error(e); send(res, 500, { error: 'Erro interno' });
    }
  });
  return { server, bus, close: () => new Promise(ok => { bus.close(); server.close(ok); server.closeAllConnections?.(); }) };
}
