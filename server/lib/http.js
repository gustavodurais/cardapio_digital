export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const E = {
  bad: m => new HttpError(400, m), unauth: () => new HttpError(401, 'Não autorizado'),
  notFound: m => new HttpError(404, m || 'Não encontrado'), conflict: m => new HttpError(409, m), tooMany: () => new HttpError(429, 'Muitas tentativas. Aguarde um minuto.')
};
export function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}
export async function readJson(req, max = 100_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw new HttpError(413, 'Corpo grande demais'); chunks.push(c); }
  if (!size) return {};
  try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; }
  catch { throw E.bad('JSON inválido'); }
}
export function router() {
  const routes = [];
  return {
    add: (method, path, fn) => routes.push({ method, re: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn }),
    find(method, pathname) { for (const r of routes) { const m = r.method === method && r.re.exec(pathname); if (m) return { fn: r.fn, params: m.groups || {} }; } return null; }
  };
}
