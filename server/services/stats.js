export function dayStats(db) {
  const d0 = new Date().setHours(0, 0, 0, 0);
  const rows = db.prepare('select status,total,new_at,ready_at from orders where new_at>=?').all(d0);
  const done = rows.filter(o => o.status === 'done'), revenue = done.reduce((s, o) => s + o.total, 0);   // só entregues: cancelado jamais soma (nada a subtrair)
  const prep = rows.filter(o => o.ready_at != null && o.status !== 'canceled').map(o => o.ready_at - o.new_at);
  const top = db.prepare(`select max(l.name) name, sum(l.qty) qty from order_lines l join orders o on o.id=l.order_id
    where o.new_at>=? and o.status<>'canceled' group by coalesce(l.item_id,l.name) order by qty desc, name limit 1`).get(d0);
  return {
    orders: rows.length, revenue, avgTicket: done.length ? Math.round(revenue / done.length) : 0,
    canceled: rows.filter(o => o.status === 'canceled').length, topItem: top ? { name: top.name, qty: top.qty } : null,
    avgPrepMs: prep.length ? Math.round(prep.reduce((a, b) => a + b, 0) / prep.length) : null
  };
}
