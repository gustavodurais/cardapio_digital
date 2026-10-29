// Estado, acesso à API, sincronização (refresh) e tempo real (SSE).
import { beep, dlg, toast } from './ui.js';
import { paint } from './view.js';

export const MINE = 'brasa.pedidos';                         // pedidos DESTE aparelho: ["id.token", ...]
export const mine = () => { try { return JSON.parse(localStorage[MINE] || '[]'); } catch { return []; } };
export const token = () => sessionStorage.token || '';
export const db = { cfg: { name: 'Brasa', fee: 10, feeOn: true }, cats: [], items: [], groups: [], tables: [], orders: [], stats: null, ready: false, offline: false };
export const S = { role: sessionStorage.role || '', cat: 'all', tab: 'menu', adm: 'board', col: 'new' };
export const cart = (() => { try { return JSON.parse(sessionStorage.cart || '[]'); } catch { return []; } })();
export const ui = { fresh: true };           // estado de UI compartilhado (fresh = animar a próxima renderização)
export async function api(method, path, body) {
  let r;
  try { r = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(token() ? { authorization: 'Bearer ' + token() } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('Sem conexão com o servidor'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || 'Erro ' + r.status); e.status = r.status; throw e; }
  return d;
}
export const mapGroup = g => ({ id: g.id, name: g.name, req: g.req, ch: g.choices });
export const mapTable = t => ({ id: t.id, name: t.name, on: t.active !== false });
export function applyMenu(m) {
  const gs = new Map(); db.cfg = m.settings; db.cats = m.cats; db.tables = m.tables.map(mapTable);
  db.items = m.items.map(i => { i.groups.forEach(g => gs.set(g.id, mapGroup(g))); return { id: i.id, name: i.name, desc: i.desc, price: i.price, cat: i.catId, img: i.img, on: true, groups: i.groups.map(g => g.id) }; });
  db.groups = [...gs.values()];
}
export function applyCatalog(c) {
  db.cfg = c.settings; db.cats = c.cats; db.groups = c.groups.map(mapGroup); db.tables = c.tables.map(mapTable);
  db.items = c.items.map(i => ({ id: i.id, name: i.name, desc: i.desc, price: i.price, cat: i.catId, img: i.img, on: i.active, groups: i.groupIds }));
}
export let busy = false, again = false, es = null;
export async function refresh() {
  if (busy) { again = true; return; } busy = true;
  try {
    if (S.role === 'kitchen') {
      const [c, o, st] = await Promise.all([api('GET', '/api/admin/catalog'), api('GET', '/api/admin/orders'), api('GET', '/api/admin/stats')]);
      applyCatalog(c); db.orders = o; db.stats = st;
    } else if (S.role) { applyMenu(await api('GET', '/api/menu')); db.orders = mine().length ? await api('GET', '/api/orders?ids=' + mine().join(',')) : []; }
    db.ready = true; db.offline = false;
  } catch (e) { if (e.status === 401 && S.role === 'kitchen') { leave(); toast('Sessão expirada. Entre novamente.'); } else db.offline = true; }
  finally { busy = false; }
  if (again) { again = false; return refresh(); }
  if (!dlg.open) paint();
}
export function leave() { es?.close(); es = null; S.role = ''; sessionStorage.removeItem('role'); sessionStorage.removeItem('token'); db.ready = false; ui.fresh = true; paint(); }
export function connect() {                                  // tempo real: SSE (cozinha: tudo; cliente: só os próprios pedidos)
  es?.close(); es = null;
  const url = S.role === 'kitchen' ? '/api/stream?t=' + token() : S.role === 'client' && mine().length ? '/api/stream?orders=' + mine().join(',') : '';
  if (!url) return;
  es = new EventSource(url);
  es.addEventListener('order.created', e => { const o = JSON.parse(e.data); beep(); toast('🔔 Novo pedido · mesa ' + o.table); refresh(); });
  es.addEventListener('order.updated', () => refresh());
  es.onopen = () => refresh(); es.onerror = () => { db.offline = true; };
}
