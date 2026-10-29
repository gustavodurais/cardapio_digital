import { tx } from '../db.js';
import { E } from '../lib/http.js';
import { str, int, bool, photo } from '../lib/validate.js';
import { hashPin } from '../lib/auth.js';

const setting = (db, k) => db.prepare('select value from settings where key=?').get(k)?.value;
export const publicSettings = db => ({ name: setting(db, 'name'), fee: Number(setting(db, 'fee')), feeOn: setting(db, 'feeOn') === '1' });
const must = r => { if (!r.changes) throw E.notFound(); };
const ids = (v, name) => { if (!Array.isArray(v) || v.length > 50) throw E.bad(`${name} inválido`); return [...new Set(v.map(x => int(x, name, { min: 1 })))]; };

export function groupsFull(db) {
  const ch = db.prepare('select id,group_id g,name,extra from choices order by id').all();
  return db.prepare('select id,name,req from groups order by id').all()
    .map(g => ({ id: g.id, name: g.name, req: !!g.req, choices: ch.filter(c => c.g === g.id).map(({ id, name, extra }) => ({ id, name, extra })) }));
}
function itemsFull(db, onlyActive) {
  const links = db.prepare('select item_id i, group_id g from item_groups').all();
  return db.prepare(`select i.* from items i join cats c on c.id=i.cat_id ${onlyActive ? 'where i.active=1' : ''} order by c.pos,c.id,i.id`).all()
    .map(i => ({ id: i.id, name: i.name, desc: i.descr, price: i.price, catId: i.cat_id, img: i.img, active: !!i.active, groupIds: links.filter(l => l.i === i.id).map(l => l.g) }));
}
export function publicMenu(db) {
  const gs = groupsFull(db);
  return {
    settings: publicSettings(db), cats: db.prepare('select id,name from cats order by pos,id').all(),
    items: itemsFull(db, true).map(({ active, groupIds, ...i }) => ({ ...i, groups: gs.filter(g => groupIds.includes(g.id)) })),
    tables: db.prepare('select id,name from tables_ where active=1 order by id').all()
  };
}
export const adminCatalog = db => ({
  settings: publicSettings(db), cats: db.prepare('select id,name from cats order by pos,id').all(), items: itemsFull(db, false), groups: groupsFull(db),
  tables: db.prepare('select id,name,active from tables_ order by id').all().map(t => ({ ...t, active: !!t.active }))
});

// Itens apontam para a categoria por ID: renomear nunca gera órfãos; excluir categoria com itens é barrado pelo banco (FK RESTRICT → 409).
export const cats = {
  create: (db, b) => ({ id: Number(db.prepare('insert into cats(name,pos) values(?,(select coalesce(max(pos),-1)+1 from cats))').run(str(b.name, 'Nome', { max: 40 })).lastInsertRowid) }),
  update: (db, id, b) => must(db.prepare('update cats set name=? where id=?').run(str(b.name, 'Nome', { max: 40 }), id)),
  remove: (db, id) => must(db.prepare('delete from cats where id=?').run(id))
};
export const tables = {
  create: (db, b) => ({ id: Number(db.prepare('insert into tables_(name) values(?)').run(str(b.name, 'Nome da mesa', { max: 20 })).lastInsertRowid) }),
  update(db, id, b) {
    const cur = db.prepare('select * from tables_ where id=?').get(id); if (!cur) throw E.notFound();
    must(db.prepare('update tables_ set name=?,active=? where id=?').run(b.name === undefined ? cur.name : str(b.name, 'Nome da mesa', { max: 20 }), b.active === undefined ? cur.active : +bool(b.active, 'Ativa'), id));
  },
  remove: (db, id) => must(db.prepare('delete from tables_ where id=?').run(id))
};
export const groups = {
  create: (db, b) => groups.save(db, null, b), update: (db, id, b) => groups.save(db, id, b),
  save: (db, id, b) => tx(db, () => {
    const name = str(b.name, 'Nome do grupo', { max: 40 }), req = +bool(b.req, 'Obrigatório');
    if (!Array.isArray(b.choices) || !b.choices.length || b.choices.length > 30) throw E.bad('Informe de 1 a 30 escolhas');
    const ch = b.choices.map(c => ({ id: c.id == null ? null : int(c.id, 'Escolha', { min: 1 }), name: str(c.name, 'Nome da escolha', { max: 40 }), extra: int(c.extra ?? 0, 'Preço extra', { max: 1_000_000 }) }));
    if (id == null) id = Number(db.prepare('insert into groups(name,req) values(?,?)').run(name, req).lastInsertRowid);
    else must(db.prepare('update groups set name=?,req=? where id=?').run(name, req, id));
    const keep = ch.filter(c => c.id).map(c => c.id);
    for (const row of db.prepare('select id from choices where group_id=?').all(id)) if (!keep.includes(row.id)) db.prepare('delete from choices where id=?').run(row.id);
    for (const c of ch) {
      if (c.id) must(db.prepare('update choices set name=?,extra=? where id=? and group_id=?').run(c.name, c.extra, c.id, id));
      else db.prepare('insert into choices(group_id,name,extra) values(?,?,?)').run(id, c.name, c.extra);
    }
    return { id };
  }),
  remove: (db, id) => must(db.prepare('delete from groups where id=?').run(id))
};
export const items = {
  create: (db, b) => items.save(db, null, b), update: (db, id, b) => items.save(db, id, b),
  save: (db, id, b) => tx(db, () => {
    const v = [str(b.name, 'Nome', { max: 80 }), str(b.desc, 'Descrição', { max: 300, optional: true }), int(b.price, 'Preço'), int(b.catId, 'Categoria', { min: 1 }), photo(b.img), +bool(b.active, 'Disponível')];
    const gids = ids(b.groupIds ?? [], 'Opcionais');
    if (!db.prepare('select 1 from cats where id=?').get(v[3])) throw E.bad('Categoria inexistente');
    if (gids.some(g => !db.prepare('select 1 from groups where id=?').get(g))) throw E.bad('Grupo de opcionais inexistente');
    if (id == null) id = Number(db.prepare('insert into items(name,descr,price,cat_id,img,active) values(?,?,?,?,?,?)').run(...v).lastInsertRowid);
    else must(db.prepare('update items set name=?,descr=?,price=?,cat_id=?,img=?,active=? where id=?').run(...v, id));
    db.prepare('delete from item_groups where item_id=?').run(id);
    gids.forEach(g => db.prepare('insert into item_groups values(?,?)').run(id, g));
    return { id };
  }),
  remove: (db, id) => must(db.prepare('delete from items where id=?').run(id))   // pedidos antigos não mudam: linhas guardam o snapshot
};
export function setSettings(db, b) {
  const set = db.prepare('insert into settings values(?,?) on conflict(key) do update set value=excluded.value');
  const vals = [['name', str(b.name, 'Nome', { max: 40 })], ['fee', String(int(b.fee, 'Taxa', { max: 30 }))], ['feeOn', bool(b.feeOn, 'Taxa padrão') ? '1' : '0']];
  if (b.pin != null && b.pin !== '') { const pin = str(b.pin, 'Senha', { max: 60 }); if (pin.length < 4) throw E.bad('A senha precisa ter ao menos 4 caracteres'); vals.push(['pin_hash', hashPin(pin)]); }
  tx(db, () => vals.forEach(kv => set.run(...kv)));
}
