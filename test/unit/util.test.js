import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, h, toCents, brl, inputBRL, safeImg } from '../../web/js/util.js';

test('esc: neutraliza HTML e aspas', () => {
  assert.equal(esc(`<img src=x onerror="a('b')">&\``), '&#60;img src=x onerror=&#34;a(&#39;b&#39;)&#34;&#62;&#38;&#96;');
});
test('h``: escapa toda interpolação; false/null somem; arrays concatenam; Raw não é re-escapado', () => {
  const evil = '<script>alert(1)</script>';
  assert.ok(!h`<p>${evil}</p>`.s.includes('<script>'));
  assert.equal(h`a${false}b${null}c${undefined}d`.s, 'abcd');
  assert.equal(h`${[h`<i>${'<'}</i>`, 'x']}`.s, '<i>&#60;</i>x');
  assert.equal(h`${0}`.s, '0', 'zero é valor válido, não "falso"');
});
test('toCents: padrão brasileiro, sem erro de ponto flutuante', () => {
  assert.equal(toCents('1.234,56'), 123456); assert.equal(toCents('19,9'), 1990); assert.equal(toCents('R$ 18,90'), 1890);
  assert.equal(toCents('0,10') + toCents('0,20'), 30); assert.equal(toCents('1.005,00'), 100500); assert.equal(toCents('10'), 1000);
  for (const bad of ['', 'abc', '-5', 'R$']) assert.ok(Number.isNaN(toCents(bad)), bad);
});
test('brl / inputBRL: formato R$ 1.234,56 com espaço comum', () => {
  assert.equal(brl(123456), 'R$ 1.234,56'); assert.equal(brl(0), 'R$ 0,00'); assert.equal(brl(5), 'R$ 0,05'); assert.equal(inputBRL(1890), '18,90');
  assert.equal(toCents(inputBRL(99999)), 99999, 'ida e volta sem perda');
});
test('safeImg: só http(s) e data:image', () => {
  assert.ok(safeImg('https://x.com/a.png') && safeImg('data:image/png;base64,AAA'));
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'ftp://x', '', undefined]) assert.equal(safeImg(bad), '', String(bad));
});
