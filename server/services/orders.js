import { randomBytes, timingSafeEqual } from 'node:crypto';
import { tx } from '../db.js';
import { E } from '../lib/http.js';
import { str, int, bool } from '../lib/validate.js';

export const NEXT = { new: 'prep', prep: 'ready', ready: 'done' };
const COL = { new: 'new_at', prep: 'prep_at', ready: 'ready_at', done: 'done_at', canceled: 'canceled_at' };
const dayStart = () => new Date().setHours(0, 0, 0, 0);

export function shape(db, o) {
  const lines = db.prepare('select item_id,name,picks,unit,qty from order_lines where order_id=? order by id').all(o.id)
    .map(l => ({ itemId: l.item_id, name: l.name, picks: JSON.parse(l.picks), unit: l.unit, qty: l.qty }));
  const at = {}; for (const [k, c] of Object.entries(COL)) if (o[c] != null) at[k] = o[c];
  return { id: o.id, table: o.tbl, name: o.cname, note: o.note, lines, sub: o.sub, fee: o.fee, total: o.total, status: o.status, at };
}
const sameToken = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// O servidor NUNCA confia em preço vindo do cliente: recalcula tudo a partir do cardápio vigente e grava o snapshot.
export function createOrder(db, b, bus) {
  const table = str(b.table, 'Mesa', { max: 20 });
  if (!db.prepare('select 1 from tables_ where name=? and active=1').get(table)) throw E.bad('Mesa inválida ou inativa');
  const cname = str(b.name, 'Nome', { max: 40, optional: true }), note = str(b.note, 'Observações', { max: 200, optional: true }), useFee = bool(b.fee, 'Taxa de serviço');
  if (!Array.isArray(b.lines) || b.lines.length < 1 || b.lines.length > 50) throw E.bad('Pedido sem itens, ou itens demais');
  const merged = new Map();
  for (const l of b.lines) {
    const qty = int(l.qty, 'Quantidade', { min: 1, max: 99 }), itemId = int(l.itemId, 'Item', { min: 1 });
    const item = db.prepare('select id,name,price from items where id=? and active=1').get(itemId);
    if (!item) throw E.conflict('Um item ficou indisponível. Revise o pedido.');
    const chosen = [...new Set((l.choiceIds ?? []).map(x => int(x, 'Opção', { min: 1 })))];
    const groups = db.prepare('select g.id,g.name,g.req from groups g join item_groups ig on ig.group_id=g.id where ig.item_id=? order by g.id').all(itemId);
    const options = db.prepare('select c.id,c.group_id g,c.name,c.extra from choices c join item_groups ig on ig.group_id=c.group_id where ig.item_id=? order by c.id').all(itemId);
    if (chosen.some(id => !options.some(o => o.id === id))) throw E.bad('Opção inválida para este item');
    let unit = item.price; const picks = [];
    for (const g of groups) {
      const sel = options.filter(o => o.g === g.id && chosen.includes(o.id));
      if (g.req && sel.length !== 1) throw E.bad(`Escolha uma opção em "${g.name}"`);
      sel.forEach(o => { unit += o.extra; picks.push(o.name); });
    }
    const key = itemId + '|' + [...chosen].sort((a, c) => a - c).join(',');
    const prev = merged.get(key);
    if (prev) { prev.qty += qty; if (prev.qty > 99) throw E.bad('Quantidade máxima por item: 99'); } else merged.set(key, { itemId, name: item.name, picks, unit, qty });
  }
  const lines = [...merged.values()], sub = lines.reduce((s, l) => s + l.unit * l.qty, 0);
  const fee = useFee ? Math.round(sub * Number(db.prepare("select value from settings where key='fee'").get().value) / 100) : 0;
  const token = randomBytes(16).toString('hex'), now = Date.now();
  const id = tx(db, () => {
    const oid = Number(db.prepare('insert into orders(tbl,cname,note,sub,fee,total,token,new_at) values(?,?,?,?,?,?,?,?)').run(table, cname, note, sub, fee, sub + fee, token, now).lastInsertRowid);
    for (const l of lines) db.prepare('insert into order_lines(order_id,item_id,name,picks,unit,qty) values(?,?,?,?,?,?)').run(oid, l.itemId, l.name, JSON.stringify(l.picks), l.unit, l.qty);
    return oid;
  });
  const order = shape(db, db.prepare('select * from orders where id=?').get(id));
  bus.publish('order.created', order);
  return { ...order, token };            // o token só é entregue UMA vez, a quem criou o pedido
}

export function parsePairs(raw) {   // "12.abc,13.def" → [{id,token}]
  return String(raw).split(',').slice(0, 30).map(p => p.split('.')).filter(([i, t]) => /^\d+$/.test(i) && /^[0-9a-f]{32}$/.test(t || '')).map(([i, t]) => ({ id: Number(i), token: t }));
}
export function clientOrders(db, raw) {   // cliente só enxerga pedidos cujo token ele possui
  return parsePairs(raw).map(({ id, token }) => { const o = db.prepare('select * from orders where id=?').get(id); return o && sameToken(o.token, token) ? shape(db, o) : null; })
    .filter(Boolean).sort((a, b) => b.id - a.id);
}
export function ownedIds(db, raw) { return clientOrders(db, raw).map(o => o.id); }

export function listForKitchen(db) {   // ativos de QUALQUER dia + entregues/cancelados de hoje
  return db.prepare("select * from orders where status in('new','prep','ready') or new_at>=? order by new_at").all(dayStart()).map(o => shape(db, o));
}
export function setStatus(db, id, to, bus) {
  if (!(to in COL)) throw E.bad('Status inválido');
  const o = db.prepare('select * from orders where id=?').get(id); if (!o) throw E.notFound('Pedido não encontrado');
  const ok = NEXT[o.status] === to || (to === 'canceled' && NEXT[o.status]);
  if (!ok) throw E.conflict(`Transição inválida: ${o.status} → ${to}`);
  db.prepare(`update orders set status=?, ${COL[to]}=? where id=?`).run(to, Date.now(), id);
  const order = shape(db, db.prepare('select * from orders where id=?').get(id));
  bus.publish('order.updated', order); return order;
}
