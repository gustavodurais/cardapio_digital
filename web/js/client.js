// Telas do cliente: cardápio, opções, carrinho, checkout, meus pedidos.
import { cartSub, feeOf, groupsOf, priced } from './rules.js';
import { MINE, S, api, cart, connect, db, mine, refresh, ui } from './state.js';
import { ask, dlg, open, toast } from './ui.js';
import { PH, ST, brl, h, hhmm, safeImg } from './util.js';
import { paint } from './view.js';

export const linesView = o => h`<ul>${o.lines.map(l => h`<li>${l.qty}× ${l.name}${l.picks.length > 0 && h` <small>(${l.picks.join(', ')})</small>`}</li>`)}</ul>`;
export function clientView() {
  if (!db.ready) return h`<p class="empty">Carregando cardápio…</p>`;
  const tabs = h`<div class="pills tabs"><button class="pill ${S.tab === 'menu' ? 'on' : ''}" data-go="tab" data-v="menu">Cardápio</button><button class="pill ${S.tab === 'mine' ? 'on' : ''}" data-go="tab" data-v="mine">Meus pedidos</button></div>`;
  if (S.tab === 'mine') {
    const list = db.orders;
    return h`${tabs}${list.length ? list.map(o => h`<article class="ord"><div class="row"><b>Pedido nº ${o.id} · Mesa ${o.table}</b><span class="tag st-${o.status}">${ST[o.status]}</span></div>${o.status !== 'canceled' && h`<div class="track">${['new', 'prep', 'ready', 'done'].map((s, k, a) => h`<span class="${k < a.indexOf(o.status) || o.status === 'done' ? 'on' : ''} ${s === o.status && s !== 'done' ? 'cur' : ''}">${ST[s]}</span>`)}</div>`}${linesView(o)}${o.note && h`<small>Obs.: ${o.note}</small>`}<div class="row"><small>${hhmm(o.at.new)}</small><b>${brl(o.total)}</b></div></article>`) : h`<p class="empty">Você ainda não enviou pedidos.</p>`}`;
  }
  const items = db.items.filter(i => i.on && db.cats.some(c => c.id === i.cat) && (S.cat === 'all' || i.cat === S.cat));
  const n = cart.reduce((s, l) => s + l.qty, 0);
  return h`<section class="hero"><small>Bem-vindo ao</small><h1>${db.cfg.name}</h1><p>Escolha, personalize e envie direto da mesa.</p></section>${tabs}<div class="pills cats">${[{ id: 'all', name: 'Tudo' }, ...db.cats].map(c => h`<button class="pill ${S.cat === c.id ? 'on' : ''}" data-go="cat" data-v="${c.id}">${c.name}</button>`)}</div>
  <div class="grid">${items.map((i, k) => h`<article class="dish" style="--i:${Math.min(k, 14)}"><img src="${safeImg(i.img) || PH}" alt="" loading="lazy"><div><h3>${i.name}</h3><p>${i.desc}</p><div class="row"><span class="price">${brl(i.price)}</span><button data-go="add" data-id="${i.id}">Adicionar</button></div></div></article>`) || ''}</div>
  ${!items.length && h`<p class="empty">Nenhum item disponível aqui.</p>`}
  ${n > 0 && h`<button class="bar" data-go="cart">Ver pedido · ${n} ${n > 1 ? 'itens' : 'item'} · ${brl(cartSub())}</button>`}`;
}
export function pickDialog(it) {
  const gs = groupsOf(it);
  const f = ask(it.name, [], v => {
    const ch = [], miss = [];
    gs.forEach(g => { const sel = v.sel.filter(id => g.ch.some(c => c.id === id)); if (g.req && !sel.length) miss.push(g.name); ch.push(...sel); });
    if (miss.length) return 'Escolha: ' + miss.join(', ');
    pushCart(it.id, ch);
  }, h`${gs.map(g => h`<fieldset><legend><b>${g.name}</b> <small>${g.req ? '· obrigatório (escolha 1)' : '· opcional'}</small></legend>${g.ch.map(c => h`<label class="opt"><input type="${g.req ? 'radio' : 'checkbox'}" name="sel${g.req ? g.id : ''}" value="${c.id}">${c.name}<b>${c.extra ? '+ ' + brl(c.extra) : ''}</b></label>`)}</fieldset>`)}`, 'Adicionar');
}
export function pushCart(itemId, ch) {
  ch = [...ch].sort(); const key = itemId + '|' + ch.join(',');
  const hit = cart.find(l => l.key === key); hit ? hit.qty++ : cart.push({ key, itemId, ch, qty: 1 });
  navigator.vibrate?.(12); toast('Adicionado ao pedido'); paint();
}
export function cartDialog() {
  cart.splice(0, cart.length, ...cart.filter(l => priced(l)));
  if (!cart.length) return dlg.close();
  const sub = cartSub();
  open(h`<h2>Seu pedido</h2>${cart.map((l, k) => { const p = priced(l); return h`<div class="ln"><div>${p.it.name}${p.picks.length > 0 && h`<small> ${p.picks.join(', ')}</small>`}<br><small>${brl(p.unit)} cada</small></div><div class="q"><button class="ghost sm" data-go="dec" data-k="${k}" aria-label="Menos">−</button>${l.qty}<button class="ghost sm" data-go="inc" data-k="${k}" aria-label="Mais">+</button></div><b>${brl(p.unit * l.qty)}</b></div>`; })}
  <div class="tot"><span>Subtotal</span><span>${brl(sub)}</span></div>
  <div class="acts"><button class="ghost" data-go="close">Continuar</button><button data-go="checkout">Finalizar</button></div>`);
}
export function checkoutDialog() {
  const tbs = db.tables.filter(t => t.on), pre = new URLSearchParams(location.search).get('mesa'), sub = cartSub();
  ask('Enviar à cozinha', [
    { k: 'table', label: 'Mesa', type: 'select', req: 1, opts: [['', 'Selecione…'], ...tbs.map(t => [t.name, 'Mesa ' + t.name])], v: tbs.some(t => t.name === pre) ? pre : '' },
    { k: 'name', label: 'Seu nome (opcional)', max: 40 }, { k: 'note', label: 'Observações para a cozinha', type: 'area', max: 200 },
    { k: 'fee', label: `Taxa de serviço (${db.cfg.fee}%) · ${brl(feeOf(sub))}`, type: 'check', v: db.cfg.feeOn }
  ], async v => {   // o servidor recalcula preços e grava o snapshot; aqui só enviamos ids e quantidades
    const o = await api('POST', '/api/orders', { table: v.table, name: v.name, note: v.note, fee: v.fee, lines: cart.map(l => ({ itemId: l.itemId, choiceIds: l.ch, qty: l.qty })) })
      .catch(async e => { if (e.status === 409) await refresh(); throw e; });
    localStorage[MINE] = JSON.stringify([...mine(), o.id + '.' + o.token]); cart.length = 0; S.tab = 'mine'; ui.fresh = true; connect();
    toast('Pedido nº ' + o.id + ' enviado!'); await refresh();
  }, h`<div class="tot"><span>Subtotal</span><span>${brl(sub)}</span></div>`, 'Confirmar pedido');
}
