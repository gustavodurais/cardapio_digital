// Ações disparadas por data-go="…" (delegação de eventos).
import { $ } from './util.js';
import { cartDialog, checkoutDialog, pickDialog, pushCart } from './client.js';
import { groupsOf } from './rules.js';
import { S, api, cart, connect, db, leave, refresh, token, ui } from './state.js';
import { ask, dlg, raw, toast } from './ui.js';
import { NEXT, brl, h, inputBRL, safeImg, toCents } from './util.js';
import { paint } from './view.js';

export const nameOk = (s, list, self) => !s.trim() ? 'Informe um nome.' : list.some(x => x.id !== self && x.name.toLowerCase() === s.trim().toLowerCase()) ? 'Já existe um com esse nome.' : '';
export const itemBody = (it, over = {}) => ({ name: it.name, desc: it.desc, price: it.price, catId: it.cat, img: it.img, active: it.on, groupIds: it.groups, ...over });
export const save = async (method, path, body) => { await api(method, path, body); await refresh(); };
export const GO = {
  role: async d => {
    if (d.v === 'kitchen') { const r = await api('POST', '/api/auth/login', { pin: $('#pin').value }); sessionStorage.token = r.token; }
    S.role = sessionStorage.role = d.v; ui.fresh = true; paint(); await refresh(); connect();
  },
  out: () => { if (token()) api('POST', '/api/auth/logout').catch(() => { }); leave(); },
  tab: d => { S.tab = d.v; ui.fresh = true; paint(); }, cat: d => { S.cat = d.v; ui.fresh = true; paint(); }, adm: d => { S.adm = d.v; ui.fresh = true; paint(); },
  col: d => { S.col = d.v; paint(); },
  close: () => dlg.close(),
  add: d => { const it = db.items.find(i => i.id === +d.id); if (!it) return; groupsOf(it).length ? pickDialog(it) : pushCart(it.id, []); },
  cart: cartDialog, checkout: checkoutDialog,
  inc: d => { cart[d.k].qty++; cartDialog(); paint(); },
  dec: d => { --cart[d.k].qty || cart.splice(d.k, 1); cartDialog(); paint(); },
  adv: async d => { const o = db.orders.find(o => o.id === +d.id); if (o && NEXT[o.status]) await save('PATCH', '/api/admin/orders/' + o.id, { status: NEXT[o.status] }); },
  cancel: async d => { if (confirm('Cancelar este pedido?')) await save('PATCH', '/api/admin/orders/' + d.id, { status: 'canceled' }); },
  print: d => {
    const o = db.orders.find(o => o.id === +d.id); if (!o) return;
    $('#ticket').innerHTML = h`<b>${db.cfg.name}</b><br>COMANDA nº ${o.id} · MESA ${o.table}<br>${new Date(o.at.new).toLocaleString('pt-BR')}<br>${o.name && 'Cliente: ' + o.name}<hr>${o.lines.map(l => h`${l.qty}× ${l.name}${l.picks.length > 0 && ' (' + l.picks.join(', ') + ')'} ${brl(l.unit * l.qty)}<br>`)}<hr>${o.note && h`OBS: ${o.note}<hr>`}Subtotal ${brl(o.sub)}<br>Serviço ${brl(o.fee)}<br><b>TOTAL ${brl(o.total)}</b>`.s;
    print();
  },
  toggle: async d => { const it = db.items.find(i => i.id === +d.id); await save('PUT', '/api/admin/items/' + it.id, itemBody(it, { active: !it.on })); },
  delItem: async d => { if (confirm('Excluir item? Pedidos antigos não mudam.')) await save('DELETE', '/api/admin/items/' + d.id); },
  item: d => {
    const it = db.items.find(i => i.id === +d.id) || { name: '', desc: '', price: 0, cat: db.cats[0]?.id, img: '', on: true, groups: [] };
    if (!db.cats.length) return toast('Crie uma categoria primeiro.');
    ask(d.id ? 'Editar item' : 'Novo item', [
      { k: 'name', label: 'Nome', v: it.name, req: 1 }, { k: 'desc', label: 'Descrição', type: 'area', v: it.desc, rows: 2 },
      { k: 'price', label: 'Preço (R$)', v: inputBRL(it.price), req: 1 }, { k: 'cat', label: 'Categoria', type: 'select', v: it.cat, opts: db.cats.map(c => [c.id, c.name]) },
      { k: 'img', label: 'URL da foto (opcional)', v: it.img, max: 400 }, { k: 'on', label: 'Disponível no cardápio', type: 'check', v: it.on }
    ], async v => {
      const p = toCents(v.price); if (!v.name.trim()) return 'Informe o nome.'; if (isNaN(p)) return 'Preço inválido.';
      if (v.img.trim() && !safeImg(v.img.trim())) return 'A foto deve começar com http(s)://';
      await save(d.id ? 'PUT' : 'POST', '/api/admin/items' + (d.id ? '/' + d.id : ''), { name: v.name.trim(), desc: v.desc.trim(), price: p, catId: +v.cat, img: v.img.trim(), active: v.on, groupIds: v.sel });
    }, h`<fieldset><legend>Opcionais deste item</legend>${db.groups.map(g => h`<label class="opt"><input type="checkbox" name="sel" value="${g.id}" ${raw(it.groups.includes(g.id) ? 'checked' : '')}> ${g.name}</label>`)}</fieldset>`);
  },
  'cat+': () => ask('Nova categoria', [{ k: 'n', label: 'Nome', req: 1, max: 40 }], v => nameOk(v.n, db.cats) || save('POST', '/api/admin/cats', { name: v.n.trim() })),
  catEdit: d => { const c = db.cats.find(c => c.id === +d.id); ask('Renomear', [{ k: 'n', label: 'Nome', v: c.name, req: 1, max: 40 }], v => nameOk(v.n, db.cats, c.id) || save('PUT', '/api/admin/cats/' + c.id, { name: v.n.trim() })); },
  catDel: async d => { if (db.items.some(i => i.cat === +d.id)) return toast('Mova ou exclua os itens desta categoria antes.'); if (confirm('Excluir categoria?')) await save('DELETE', '/api/admin/cats/' + d.id); },
  'tab+': () => ask('Nova mesa', [{ k: 'n', label: 'Número ou nome', req: 1, max: 20 }], v => nameOk(v.n, db.tables) || save('POST', '/api/admin/tables', { name: v.n.trim() })),
  tabOn: async d => { const t = db.tables.find(t => t.id === +d.id); await save('PUT', '/api/admin/tables/' + t.id, { active: !t.on }); },
  tabDel: async d => { if (confirm('Excluir mesa?')) await save('DELETE', '/api/admin/tables/' + d.id); },
  grp: d => {
    const g = db.groups.find(g => g.id === +d.id) || { name: '', req: false, ch: [] };
    ask(d.id ? 'Editar grupo' : 'Novo grupo', [
      { k: 'n', label: 'Nome do grupo', v: g.name, req: 1, max: 40 }, { k: 'req', label: 'Obrigatório (escolha única)', type: 'check', v: g.req },
      { k: 'ch', label: 'Escolhas, uma por linha: nome | preço extra', type: 'area', rows: 5, v: g.ch.map(c => `${c.name} | ${inputBRL(c.extra)}`).join('\n') }
    ], async v => {
      const ch = []; for (const ln of v.ch.split('\n').filter(l => l.trim())) {
        const [n, p = '0'] = ln.split('|'), extra = toCents(p || '0'); if (!n.trim() || isNaN(extra)) return 'Linha inválida: ' + ln;
        ch.push({ id: g.ch.find(c => c.name === n.trim())?.id, name: n.trim(), extra });
      }
      if (!v.n.trim() || !ch.length) return 'Informe o nome e ao menos uma escolha.';
      await save(d.id ? 'PUT' : 'POST', '/api/admin/groups' + (d.id ? '/' + d.id : ''), { name: v.n.trim(), req: v.req, choices: ch });
    });
  },
  grpDel: async d => { if (confirm('Excluir grupo? Ele sai dos itens.')) await save('DELETE', '/api/admin/groups/' + d.id); },
  cfg: () => ask('Ajustes', [
    { k: 'name', label: 'Nome do restaurante', v: db.cfg.name, max: 40 }, { k: 'fee', label: 'Taxa de serviço (% inteiro, 0 a 30)', v: db.cfg.fee },
    { k: 'feeOn', label: 'Taxa marcada por padrão', type: 'check', v: db.cfg.feeOn }, { k: 'pin', label: 'Nova senha da cozinha (vazio = manter)', max: 60 }
  ], async v => {
    const f = Number(v.fee.replace(',', '.')); if (!Number.isInteger(f) || f < 0 || f > 30) return 'Taxa: número inteiro entre 0 e 30.';
    await save('PUT', '/api/admin/settings', { name: v.name.trim() || 'Brasa', fee: f, feeOn: v.feeOn, pin: v.pin || undefined });
  })
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  try { const r = GO[b.dataset.go]?.(b.dataset, b); if (r instanceof Promise) { b.disabled = true; r.catch(x => toast(x.message)).finally(() => { b.disabled = false; }); } } catch (x) { toast(x.message); }
});
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener('close', () => paint());
