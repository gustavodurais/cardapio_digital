import { E } from './http.js';
export function str(v, name, { max = 120, optional = false } = {}) {
  if (v == null || (typeof v === 'string' && !v.trim())) { if (optional) return ''; throw E.bad(`${name} é obrigatório`); }
  if (typeof v !== 'string') throw E.bad(`${name} inválido`);
  const s = v.trim(); if (s.length > max) throw E.bad(`${name} excede ${max} caracteres`); return s;
}
export function int(v, name, { min = 0, max = 10_000_000 } = {}) { if (!Number.isInteger(v) || v < min || v > max) throw E.bad(`${name} inválido`); return v; }
export function bool(v, name) { if (typeof v !== 'boolean') throw E.bad(`${name} inválido`); return v; }
export function photo(v) { const s = str(v, 'Foto', { optional: true, max: 400 }); if (s && !/^(https?:\/\/|data:image\/)/i.test(s)) throw E.bad('A foto deve começar com http(s)://'); return s; }
