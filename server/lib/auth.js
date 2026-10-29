import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
const sha = t => createHash('sha256').update(t).digest('hex');
export const hashPin = pin => { const salt = randomBytes(16); return salt.toString('hex') + ':' + scryptSync(pin, salt, 32).toString('hex'); };
export function checkPin(pin, stored) {
  const [s, h] = stored.split(':'); return timingSafeEqual(scryptSync(pin, Buffer.from(s, 'hex'), 32), Buffer.from(h, 'hex'));
}
export function login(db, pin) {
  const row = db.prepare("select value v from settings where key='pin_hash'").get();
  if (typeof pin !== 'string' || !pin || !checkPin(pin, row.v)) return null;
  const token = randomBytes(32).toString('hex');
  db.prepare('insert into sessions(hash,expires) values(?,?)').run(sha(token), Date.now() + 12 * 3600e3); return token;
}
export function verify(db, token) {
  if (!token) return false;
  db.prepare('delete from sessions where expires<?').run(Date.now());
  return !!db.prepare('select 1 from sessions where hash=?').get(sha(token));
}
export const logout = (db, token) => db.prepare('delete from sessions where hash=?').run(sha(token));
export function rateLimiter(max, windowMs) {
  const m = new Map();
  return key => { const now = Date.now(), e = m.get(key); if (!e || e.reset < now) { m.set(key, { n: 1, reset: now + windowMs }); return true; } return ++e.n <= max; };
}
