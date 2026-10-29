// Regras de cálculo exibidas ao cliente (o servidor é quem manda: recalcula tudo no envio).
import { cart, db } from './state.js';

export const groupsOf = it => it.groups.map(id => db.groups.find(g => g.id === id)).filter(Boolean);
export function priced(l) {                                  // preço sempre recalculado do cardápio vigente
  const it = db.items.find(i => i.id === l.itemId);
  if (!it || !it.on) return null;
  let unit = it.price; const picks = [];
  groupsOf(it).forEach(g => g.ch.forEach(c => { if (l.ch.includes(c.id)) { unit += c.extra; picks.push(c.name); } }));
  return { it, unit, picks };
}
export const cartSub = () => cart.reduce((s, l) => { const p = priced(l); return s + (p ? p.unit * l.qty : 0); }, 0);
export const feeOf = sub => Math.round(sub * db.cfg.fee / 100);
