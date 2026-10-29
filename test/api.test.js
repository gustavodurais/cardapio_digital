import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

let app, base, db, tok;
const api = async (method, path, body, token) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const admin = (m, p, b) => api(m, p, b, tok);
const itemId = async name => (await admin('GET', '/api/admin/catalog')).data.items.find(i => i.name === name).id;
const order = async (lines, extra = {}) => api('POST', '/api/orders', { table: '5', fee: false, lines, ...extra });
async function sse(path) {
  const ctl = new AbortController(), res = await fetch(base + path, { signal: ctl.signal }), events = [], dec = new TextDecoder();
  (async () => { try { for await (const c of res.body) for (const blk of dec.decode(c).split('\n\n')) { const m = /event: (.+)\ndata: (.+)/.exec(blk); if (m) events.push([m[1], JSON.parse(m[2])]); } } catch { } })();
  return { events, stop: () => ctl.abort() };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

before(async () => {
  process.env.KITCHEN_PIN = '9999'; db = openDb(); app = createApp(db);
  await new Promise(r => app.server.listen(0, r)); base = 'http://localhost:' + app.server.address().port;
  tok = (await api('POST', '/api/auth/login', { pin: '9999' })).data.token;
});
after(async () => { await app.close(); db.close(); });

test('login: senha errada 401, certa devolve token; admin exige token', async () => {
  assert.equal((await api('POST', '/api/auth/login', { pin: 'x' })).status, 401);
  assert.ok(tok); assert.equal((await api('GET', '/api/admin/orders')).status, 401);
  assert.equal((await api('GET', '/api/admin/orders', null, 'falso')).status, 401);
});
test('cardápio público: só itens ativos, com opções, e mesas ativas', async () => {
  const id = await itemId('Carpaccio'); const it = (await admin('GET', '/api/admin/catalog')).data.items.find(i => i.id === id);
  await admin('PUT', `/api/admin/items/${id}`, { ...it, active: false });
  const m = (await api('GET', '/api/menu')).data;
  assert.ok(!m.items.some(i => i.name === 'Carpaccio')); assert.equal(m.items.find(i => i.name === 'Filé ao madeira').groups.length, 2);
  assert.ok(JSON.stringify(m).indexOf('pin') < 0);
  await admin('PUT', `/api/admin/items/${id}`, { ...it, active: true });
});
test('pedido: preço recalculado no servidor, opções somam, taxa em centavos', async () => {
  const f = await itemId('Filé ao madeira'), cat = (await admin('GET', '/api/admin/catalog')).data;
  const g = cat.groups.find(g => g.name === 'Ponto da carne'), mol = cat.groups.find(g => g.name === 'Molhos extras');
  const ponto = g.choices[1].id, mostarda = mol.choices[0].id;
  const r = await order([{ itemId: f, choiceIds: [ponto, mostarda], qty: 1, unit: 1 }, { itemId: f, choiceIds: [mostarda, ponto], qty: 2 }], { fee: true });
  assert.equal(r.status, 201); assert.equal(r.data.lines.length, 1, 'mesmas opções somam quantidade'); assert.equal(r.data.lines[0].qty, 3);
  assert.equal(r.data.lines[0].unit, 6090); assert.equal(r.data.sub, 18270); assert.equal(r.data.fee, 1827); assert.equal(r.data.total, 20097); assert.ok(r.data.token);
});
test('pedido: validações (opção obrigatória, opção alheia, mesa, qtd, item vazio)', async () => {
  const f = await itemId('Filé ao madeira'), a = await itemId('Água mineral'), cat = (await admin('GET', '/api/admin/catalog')).data;
  const sabor = cat.groups.find(g => g.name === 'Sabor').choices[0].id;
  assert.equal((await order([{ itemId: f, qty: 1 }])).status, 400);
  assert.equal((await order([{ itemId: a, choiceIds: [sabor], qty: 1 }])).status, 400);
  assert.equal((await order([{ itemId: a, qty: 1 }], { table: '999' })).status, 400);
  assert.equal((await order([{ itemId: a, qty: 0 }])).status, 400); assert.equal((await order([{ itemId: a, qty: 100 }])).status, 400);
  assert.equal((await order([])).status, 400); assert.equal((await order([{ itemId: 99999, qty: 1 }])).status, 409);
  assert.equal((await api('POST', '/api/orders', { table: '5', lines: [{ itemId: a, qty: 1 }] })).status, 400, 'fee é obrigatório');
});
test('isolamento: cliente só vê pedidos com o próprio token', async () => {
  const a = await itemId('Água mineral'), o1 = (await order([{ itemId: a, qty: 1 }])).data, o2 = (await order([{ itemId: a, qty: 2 }], { table: '3' })).data;
  const mine = (await api('GET', `/api/orders?ids=${o1.id}.${o1.token}`)).data; assert.deepEqual(mine.map(o => o.id), [o1.id]);
  assert.equal((await api('GET', `/api/orders?ids=${o2.id}.${o1.token}`)).data.length, 0, 'token alheio não abre pedido');
  assert.ok(!('token' in mine[0]));
});
test('status: só avança em ordem; cancelar só de ativo; entregue é final', async () => {
  const a = await itemId('Água mineral'), o = (await order([{ itemId: a, qty: 1 }])).data, p = `/api/admin/orders/${o.id}`;
  assert.equal((await admin('PATCH', p, { status: 'ready' })).status, 409);
  assert.equal((await admin('PATCH', p, { status: 'prep' })).data.status, 'prep');
  assert.equal((await admin('PATCH', p, { status: 'banana' })).status, 400);
  assert.equal((await admin('PATCH', p, { status: 'ready' })).status, 200); assert.equal((await admin('PATCH', p, { status: 'done' })).status, 200);
  assert.equal((await admin('PATCH', p, { status: 'canceled' })).status, 409); assert.equal((await admin('PATCH', p, { status: 'prep' })).status, 409);
});
test('SSE: cozinha recebe pedido novo; cliente só recebe status dos próprios', async () => {
  const a = await itemId('Água mineral'), mine = (await order([{ itemId: a, qty: 1 }])).data, other = (await order([{ itemId: a, qty: 1 }])).data;
  const k = await sse('/api/stream?t=' + tok), c = await sse(`/api/stream?orders=${mine.id}.${mine.token}`);
  assert.equal((await api('GET', '/api/stream?t=falso')).status, 401); await wait(100);
  const n = (await order([{ itemId: a, qty: 1 }])).data;
  await admin('PATCH', `/api/admin/orders/${mine.id}`, { status: 'prep' }); await admin('PATCH', `/api/admin/orders/${other.id}`, { status: 'prep' }); await wait(200);
  assert.ok(k.events.some(([e, d]) => e === 'order.created' && d.id === n.id), 'cozinha vê pedido novo');
  assert.deepEqual(c.events, [['order.updated', { id: mine.id, status: 'prep' }]]); k.stop(); c.stop();
});
test('snapshot: editar/excluir item não altera pedidos nem estatísticas', async () => {
  const id = await itemId('Brownie com sorvete'), o = (await order([{ itemId: id, qty: 2 }])).data, p = `/api/admin/orders/${o.id}`;
  for (const s of ['prep', 'ready', 'done']) await admin('PATCH', p, { status: s });
  const before = (await admin('GET', '/api/admin/stats')).data, it = (await admin('GET', '/api/admin/catalog')).data.items.find(i => i.id === id);
  await admin('PUT', `/api/admin/items/${id}`, { ...it, name: 'Outro', price: 99999 }); assert.equal((await admin('DELETE', `/api/admin/items/${id}`)).status, 200);
  const after = (await admin('GET', '/api/admin/orders')).data.find(x => x.id === o.id);
  assert.equal(after.lines[0].name, 'Brownie com sorvete'); assert.equal(after.lines[0].unit, 1890); assert.equal(after.total, o.total);
  assert.deepEqual((await admin('GET', '/api/admin/stats')).data, before);
});
test('estatísticas: faturamento só de entregues; cancelado fora; centavos exatos', async () => {
  const s0 = (await admin('GET', '/api/admin/stats')).data, a = await itemId('Água mineral');
  const d = (await order([{ itemId: a, qty: 3 }], { fee: true })).data, c = (await order([{ itemId: a, qty: 5 }])).data;
  for (const s of ['prep', 'ready', 'done']) await admin('PATCH', `/api/admin/orders/${d.id}`, { status: s });
  await admin('PATCH', `/api/admin/orders/${c.id}`, { status: 'canceled' });
  const s1 = (await admin('GET', '/api/admin/stats')).data;
  assert.equal(s1.revenue - s0.revenue, 1980); assert.equal(s1.canceled - s0.canceled, 1); assert.equal(s1.orders - s0.orders, 2);
  assert.ok(Number.isInteger(s1.avgTicket) && s1.avgPrepMs != null);
});
test('pedidos ativos de dias anteriores continuam na cozinha; entregues antigos não', async () => {
  const old = Date.now() - 30 * 3600e3, ins = st => db.prepare("insert into orders(tbl,sub,fee,total,token,status,new_at) values('7',100,0,100,'t',?,?)").run(st, old).lastInsertRowid;
  const act = Number(ins('prep')), fin = Number(ins('done'));
  const ids = (await admin('GET', '/api/admin/orders')).data.map(o => o.id); assert.ok(ids.includes(act)); assert.ok(!ids.includes(fin));
});
test('categoria: renomear mantém itens; excluir com itens é 409; nome duplicado 409', async () => {
  const cat = (await admin('GET', '/api/admin/catalog')).data, p = cat.cats.find(c => c.name === 'Pratos');
  assert.equal((await admin('PUT', `/api/admin/cats/${p.id}`, { name: 'Principais' })).status, 200);
  const c2 = (await admin('GET', '/api/admin/catalog')).data; assert.ok(c2.items.filter(i => i.catId === p.id).length >= 2);
  assert.equal((await admin('DELETE', `/api/admin/cats/${p.id}`)).status, 409); assert.equal((await admin('POST', '/api/admin/cats', { name: 'principais' })).status, 409);
  const n = (await admin('POST', '/api/admin/cats', { name: 'Vazia' })).data.id; assert.equal((await admin('DELETE', `/api/admin/cats/${n}`)).status, 200);
});
test('admin: CRUD de item/grupo/mesa com validação (foto, preço, nome)', async () => {
  const cat = (await admin('GET', '/api/admin/catalog')).data, base_ = { name: 'Pudim <b>x</b>', desc: '', price: 123456, catId: cat.cats[0].id, img: '', active: true, groupIds: [] };
  assert.equal((await admin('POST', '/api/admin/items', { ...base_, img: 'javascript:alert(1)' })).status, 400);
  assert.equal((await admin('POST', '/api/admin/items', { ...base_, price: 12.5 })).status, 400); assert.equal((await admin('POST', '/api/admin/items', { ...base_, price: '10' })).status, 400);
  assert.equal((await admin('POST', '/api/admin/items', { ...base_, catId: 9999 })).status, 400);
  const ok = await admin('POST', '/api/admin/items', base_); assert.equal(ok.status, 201);
  assert.equal((await api('GET', '/api/menu')).data.items.find(i => i.id === ok.data.id).name, 'Pudim <b>x</b>', 'texto guardado cru; o front escapa na renderização');
  const g = await admin('POST', '/api/admin/groups', { name: 'Extras', req: false, choices: [{ name: 'Queijo', extra: 350 }] }); assert.equal(g.status, 201);
  assert.equal((await admin('POST', '/api/admin/groups', { name: 'Ruim', req: false, choices: [] })).status, 400);
  assert.equal((await admin('PUT', `/api/admin/items/${ok.data.id}`, { ...base_, groupIds: [g.data.id] })).status, 200);
  assert.equal((await admin('POST', '/api/admin/tables', { name: 'VIP' })).status, 201); assert.equal((await admin('POST', '/api/admin/tables', { name: 'vip' })).status, 409);
  assert.equal((await api('POST', '/api/orders', { table: '5', fee: false, lines: [{ itemId: ok.data.id, qty: 1 }] })).status, 201);
});
test('mesa desativada recusa pedido; ajustes validados e aplicados à taxa', async () => {
  const t = (await admin('GET', '/api/admin/catalog')).data.tables.find(t => t.name === '12'), a = await itemId('Água mineral');
  await admin('PUT', `/api/admin/tables/${t.id}`, { active: false }); assert.equal((await order([{ itemId: a, qty: 1 }], { table: '12' })).status, 400);
  assert.equal((await admin('PUT', '/api/admin/settings', { name: 'Brasa', fee: 50, feeOn: true })).status, 400);
  await admin('PUT', '/api/admin/settings', { name: 'Brasa', fee: 12, feeOn: true }); const r = await order([{ itemId: a, qty: 1 }], { fee: true }); assert.equal(r.data.fee, 72);
});
test('ajustes: trocar a senha da cozinha (mín. 4) invalida a senha antiga', async () => {
  const cfg = { name: 'Brasa', fee: 12, feeOn: true };
  assert.equal((await admin('PUT', '/api/admin/settings', { ...cfg, pin: 'abc' })).status, 400);
  assert.equal((await admin('PUT', '/api/admin/settings', { ...cfg, pin: 'nova-senha' })).status, 200);
  assert.equal((await api('POST', '/api/auth/login', { pin: 'nova-senha' })).status, 200);
  assert.equal((await api('POST', '/api/auth/login', { pin: '9999' })).status, 401);
});
test('segurança: corpo inválido, rota inexistente, path traversal, headers, limite de login', async () => {
  assert.equal((await fetch(base + '/api/orders', { method: 'POST', body: '{ruim' })).status, 400);
  assert.equal((await api('GET', '/api/nada')).status, 404);
  assert.equal((await fetch(base + '/..%2f..%2fetc%2fpasswd')).status, 404);
  const h = await fetch(base + '/api/health'); assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
  let last; for (let i = 0; i < 8; i++) last = (await api('POST', '/api/auth/login', { pin: 'x' })).status; assert.equal(last, 429);
});
