// Tempo real via Server-Sent Events. Cozinha recebe o pedido completo; cliente só id+status dos PRÓPRIOS pedidos.
export function createBus() {
  const clients = new Set();
  const hb = setInterval(() => { for (const c of clients) c.res.write(': hb\n\n'); }, 25_000); hb.unref();
  const write = (c, ev, d) => c.res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`);
  return {
    subscribe(req, res, { kitchen, ids = [] }) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write('retry: 3000\n\n');
      const c = { res, kitchen, ids: new Set(ids) }; clients.add(c); req.on('close', () => clients.delete(c));
    },
    publish(event, order) {
      for (const c of clients) {
        if (c.kitchen) write(c, event, order);
        else if (c.ids.has(order.id)) write(c, 'order.updated', { id: order.id, status: order.status });
      }
    },
    close() { clearInterval(hb); for (const c of clients) c.res.end(); clients.clear(); }
  };
}
