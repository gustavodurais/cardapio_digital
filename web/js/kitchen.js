// Telas da cozinha: quadro de pedidos, estatísticas e administração.
import { S, db } from './state.js';
import { LATE_MS, NEXT, ST, VERB, brl, h, hhmm, mins } from './util.js';

export function boardView() {
  const d0 = new Date().setHours(0, 0, 0, 0), cols = ['new', 'prep', 'ready', 'done', 'canceled'];
  const lst = st => db.orders.filter(o => o.status === st && (NEXT[st] || o.at.new >= d0)).sort((a, b) => a.at.new - b.at.new);
  const card = o => {
    const late = NEXT[o.status] && Date.now() - o.at.new > LATE_MS;
    return h`<article class="ord k ${late ? 'late' : ''}" data-order="${o.id}">
      <div class="oh"><span class="mesa">Mesa ${o.table}</span><span class="meta">nº ${o.id} · ${hhmm(o.at.new)}</span><span class="age ${late ? 'late' : ''}">${late ? '⚠ ' : ''}${mins(o.at.new)} min</span></div>
      <div class="ob">${o.name && h`<small>👤 ${o.name}</small>`}<ul class="items">${o.lines.map(l => h`<li><b>${l.qty}×</b><span>${l.name}${l.picks.length > 0 && h`<small>${l.picks.join(', ')}</small>`}</span></li>`)}</ul>${o.note && h`<div class="note">📝 ${o.note}</div>`}<div class="kf"><span class="mute">Total</span><b>${brl(o.total)}</b></div></div>
      <div class="ka">${NEXT[o.status] ? h`<button class="go go-${o.status}" data-go="adv" data-id="${o.id}">${VERB[o.status]} →</button>` : ''}<div class="two">${NEXT[o.status] ? h`<button class="ghost danger-o" data-go="cancel" data-id="${o.id}">Cancelar</button>` : ''}<button class="ghost" data-go="print" data-id="${o.id}">🖨 Imprimir</button></div></div></article>`;
  };
  return h`<div class="pills cols">${cols.map(c => h`<button class="pill ${S.col === c ? 'on' : ''}" data-go="col" data-v="${c}">${ST[c]}<b>${lst(c).length}</b></button>`)}</div>
  <div class="board">${cols.map(c => { const l = lst(c); return h`<section class="${S.col === c ? 'cur' : ''}"><h3>${ST[c]} <span class="tag st-${c}">${l.length}</span></h3>${l.map(card)}${!l.length && h`<p class="empty">Nenhum pedido</p>`}</section>`; })}</div>`;
}
export function statsView() {
  const s = db.stats || {};
  const k = [[s.orders ?? 0, 'Pedidos hoje'], [brl(s.revenue || 0), 'Faturamento (entregues)'], [brl(s.avgTicket || 0), 'Ticket médio'], [s.canceled ?? 0, 'Cancelados'],
    [s.topItem ? `${s.topItem.name} (${s.topItem.qty})` : '—', 'Item mais vendido'], [s.avgPrepMs == null ? '—' : String(Math.round(s.avgPrepMs / 6e3) / 10).replace('.', ',') + ' min', 'Tempo médio de preparo']];
  return h`<div class="kpis">${k.map(([b, l], i) => h`<div class="kpi" style="--i:${i}"><b>${b}</b><span>${l}</span></div>`)}</div>`;
}
export const tbl = rows => h`<table class="tbl">${rows.map(([a, b]) => h`<tr><td>${a}</td><td>${b}</td></tr>`)}</table>`;
export const btn = (go, id, t, cls = 'ghost') => h`<button class="${cls} sm" data-go="${go}" data-id="${id}">${t}</button>`;
export function adminView() {
  const A = {
    board: boardView, stats: statsView,
    items: () => h`<div class="row"><h2>Itens</h2><button data-go="item" data-id="">+ Novo item</button></div>${tbl(db.items.map(i => [h`<b>${i.name}</b> <small>${db.cats.find(c => c.id === i.cat)?.name || '—'} · ${brl(i.price)}${i.on ? '' : ' · INDISPONÍVEL'}</small>`, h`${btn('toggle', i.id, i.on ? 'Desativar' : 'Ativar')} ${btn('item', i.id, 'Editar')} ${btn('delItem', i.id, 'Excluir', 'danger')}`]))}`,
    cats: () => h`<div class="row"><h2>Categorias</h2><button data-go="cat+">+ Nova</button></div>${tbl(db.cats.map(c => [c.name + ' ', h`${btn('catEdit', c.id, 'Renomear')} ${btn('catDel', c.id, 'Excluir', 'danger')}`]))}`,
    tables: () => h`<div class="row"><h2>Mesas</h2><button data-go="tab+">+ Nova</button></div>${tbl(db.tables.map(t => [h`Mesa ${t.name}${t.on ? '' : ' (inativa)'}`, h`${btn('tabOn', t.id, t.on ? 'Desativar' : 'Ativar')} ${btn('tabDel', t.id, 'Excluir', 'danger')}`]))}`,
    groups: () => h`<div class="row"><h2>Opcionais</h2><button data-go="grp" data-id="">+ Novo grupo</button></div>${tbl(db.groups.map(g => [h`<b>${g.name}</b> <small>${g.req ? 'obrigatório' : 'opcional'} · ${g.ch.map(c => c.name + (c.extra ? ' +' + brl(c.extra) : '')).join(', ')}</small>`, h`${btn('grp', g.id, 'Editar')} ${btn('grpDel', g.id, 'Excluir', 'danger')}`]))}`,
    cfg: () => h`<h2>Ajustes</h2><div class="acts" style="max-width:260px"><button data-go="cfg">Editar ajustes</button></div><p class="mute" style="margin-top:12px">Taxa atual: ${db.cfg.fee}% (${db.cfg.feeOn ? 'marcada' : 'desmarcada'} por padrão). A senha da cozinha fica no servidor (com hash) e pode ser trocada em “Editar ajustes”.</p>`
  };
  const names = { board: 'Quadro', stats: 'Hoje', items: 'Itens', cats: 'Categorias', tables: 'Mesas', groups: 'Opcionais', cfg: 'Ajustes' };
  const active = db.orders.filter(o => NEXT[o.status]).length;
  return h`<div class="pills">${Object.entries(names).map(([k, n]) => h`<button class="pill ${S.adm === k ? 'on' : ''}" data-go="adm" data-v="${k}">${n}${k === 'board' && ` (${active})`}</button>`)}</div>${A[S.adm]()}`;
}
