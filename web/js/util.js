// Utilitários puros (sem DOM no import): escape de HTML, dinheiro em centavos, template h``.

export const $ = (s, r = document) => r.querySelector(s);
export const uid = () => crypto.randomUUID().slice(0, 8);
export class Raw { constructor(s) { this.s = s; } }
export const esc = s => String(s).replace(/[&<>"'`]/g, c => '&#' + c.charCodeAt(0) + ';');
export const val = x => x instanceof Raw ? x.s : Array.isArray(x) ? x.map(val).join('') : (x === false || x == null) ? '' : esc(x);
export const h = (t, ...v) => new Raw(t.reduce((a, s, i) => a + s + (i < v.length ? val(v[i]) : ''), ''));
export const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = c => money.format(c / 100).replace(/\u00a0/g, ' ');            // todo dinheiro é inteiro em centavos
export const inputBRL = c => (c / 100).toFixed(2).replace('.', ',');
export const toCents = s => {
  s = String(s).replace(/[R$\s]/g, ''); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Math.round(parseFloat(s) * 100); return Number.isFinite(n) && n >= 0 ? n : NaN;
};
export const hhmm = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const mins = t => Math.floor((Date.now() - t) / 6e4);
export const safeImg = u => /^(https?:\/\/|data:image\/)/i.test(u || '') ? u : '';
export const PH = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect width="160" height="100" fill="#d9cfb6"/><circle cx="80" cy="50" r="26" fill="none" stroke="#8a7f62" stroke-width="3"/><circle cx="80" cy="50" r="14" fill="none" stroke="#8a7f62" stroke-width="3"/></svg>');

export const ST = { new: 'Pendente', prep: 'Preparando', ready: 'Pronto', done: 'Entregue', canceled: 'Cancelado' };
export const NEXT = { new: 'prep', prep: 'ready', ready: 'done' };
export const VERB = { new: 'Iniciar preparo', prep: 'Marcar pronto', ready: 'Marcar entregue' };
export const LATE_MS = 20 * 6e4;
