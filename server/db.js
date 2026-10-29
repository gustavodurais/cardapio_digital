import { DatabaseSync } from 'node:sqlite';
import { hashPin } from './lib/auth.js';
const SCHEMA = `
pragma foreign_keys=on; pragma journal_mode=wal;
create table if not exists settings(key text primary key, value text not null);
create table if not exists sessions(hash text primary key, expires integer not null);
create table if not exists cats(id integer primary key, name text not null unique collate nocase, pos integer not null default 0);
create table if not exists items(id integer primary key, name text not null, descr text not null default '', price integer not null check(price>=0),
  cat_id integer not null references cats(id) on delete restrict, img text not null default '', active integer not null default 1);
create table if not exists groups(id integer primary key, name text not null unique collate nocase, req integer not null default 0);
create table if not exists choices(id integer primary key, group_id integer not null references groups(id) on delete cascade, name text not null, extra integer not null default 0 check(extra>=0));
create table if not exists item_groups(item_id integer references items(id) on delete cascade, group_id integer references groups(id) on delete cascade, primary key(item_id,group_id));
create table if not exists tables_(id integer primary key, name text not null unique collate nocase, active integer not null default 1);
create table if not exists orders(id integer primary key, tbl text not null, cname text not null default '', note text not null default '',
  sub integer not null, fee integer not null, total integer not null, token text not null,
  status text not null default 'new' check(status in('new','prep','ready','done','canceled')),
  new_at integer not null, prep_at integer, ready_at integer, done_at integer, canceled_at integer);
create table if not exists order_lines(id integer primary key, order_id integer not null references orders(id) on delete cascade,
  item_id integer, name text not null, picks text not null default '[]', unit integer not null, qty integer not null);
create index if not exists ix_orders_status on orders(status); create index if not exists ix_orders_new on orders(new_at);`;
// order_lines.item_id NÃO tem FK de propósito: é só referência; nome e preço da linha são o snapshot da compra.

export function openDb(file = ':memory:', { seed = true } = {}) {
  const db = new DatabaseSync(file); db.exec(SCHEMA);
  if (seed && !db.prepare('select 1 from settings limit 1').get()) seedData(db);
  return db;
}
export function tx(db, fn) { db.exec('begin'); try { const r = fn(); db.exec('commit'); return r; } catch (e) { db.exec('rollback'); throw e; } }

function seedData(db) {
  if (process.env.NODE_ENV === 'production' && !process.env.KITCHEN_PIN) throw new Error('Defina KITCHEN_PIN antes do primeiro start em produção.');
  const pin = process.env.KITCHEN_PIN || '1234';
  if (!process.env.KITCHEN_PIN) console.warn('[aviso] KITCHEN_PIN não definido: usando a senha de demonstração "1234". Defina a variável em produção.');
  const set = db.prepare('insert into settings values(?,?)');
  [['name', 'Brasa'], ['fee', '10'], ['feeOn', '1'], ['pin_hash', hashPin(pin)]].forEach(kv => set.run(...kv));
  const cat = db.prepare('insert into cats(name,pos) values(?,?)'), cid = {};
  ['Entradas', 'Pratos', 'Bebidas', 'Sobremesas'].forEach((n, i) => cid[n] = Number(cat.run(n, i).lastInsertRowid));
  const grp = (name, req, ch) => { const g = Number(db.prepare('insert into groups(name,req) values(?,?)').run(name, req).lastInsertRowid); ch.forEach(([n, x]) => db.prepare('insert into choices(group_id,name,extra) values(?,?,?)').run(g, n, x)); return g; };
  const g0 = grp('Ponto da carne', 1, [['Mal passado', 0], ['Ao ponto', 0], ['Bem passado', 0]]), g1 = grp('Molhos extras', 0, [['Mostarda e mel', 400], ['Pimenta da casa', 300]]);
  const g2 = grp('Sabor', 1, [['Laranja', 0], ['Maracujá', 0], ['Abacaxi', 0]]), g3 = grp('Cobertura', 0, [['Calda de chocolate', 250], ['Doce de leite', 250]]);
  const item = (n, d, p, c, gs = []) => { const i = Number(db.prepare('insert into items(name,descr,price,cat_id) values(?,?,?,?)').run(n, d, p, cid[c]).lastInsertRowid); gs.forEach(g => db.prepare('insert into item_groups values(?,?)').run(i, g)); };
  item('Bruschetta de tomate', 'Pão de fermentação natural, tomate maduro, manjericão.', 1890, 'Entradas');
  item('Carpaccio', 'Lâminas de carne, parmesão, rúcula e azeite.', 2450, 'Entradas');
  item('Filé ao madeira', 'Filé grelhado, molho madeira e purê rústico.', 5690, 'Pratos', [g0, g1]);
  item('Risoto de cogumelos', 'Arroz arbóreo, mix de cogumelos e parmesão.', 4250, 'Pratos');
  item('Suco natural', 'Copo de 300 ml.', 1000, 'Bebidas', [g2]); item('Água mineral', 'Garrafa de 500 ml.', 600, 'Bebidas');
  item('Brownie com sorvete', 'Brownie quente e sorvete de creme.', 1890, 'Sobremesas', [g3]);
  for (let i = 1; i <= 12; i++) db.prepare('insert into tables_(name) values(?)').run(String(i));
}
