// Toast, bipe, diálogo modal e formulário genérico.
import { $ } from './util.js';
import { Raw, h } from './util.js';

export const dlg = $('#dlg');
export function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('#toasts').append(t); setTimeout(() => t.remove(), 4000); }
export function beep() {
  try {
    const a = new AudioContext(); [660, 880].forEach((f, i) => {
      const o = a.createOscillator(), g = a.createGain(); o.frequency.value = f; o.connect(g); g.connect(a.destination);
      g.gain.setValueAtTime(.2, a.currentTime + i * .18); g.gain.exponentialRampToValueAtTime(.001, a.currentTime + i * .18 + .16);
      o.start(a.currentTime + i * .18); o.stop(a.currentTime + i * .18 + .17);
    });
  } catch { }
}
export function open(content) { dlg.innerHTML = `<div class="dl">${content.s}</div>`; dlg.open || dlg.showModal(); }
export function ask(title, fields, ok, extra = '', label = 'Salvar') {
  open(h`<h2>${title}</h2><form id="f">${fields.map(f => {
    const nm = `name="${f.k}"`;
    if (f.type === 'check') return h`<label class="opt"><input type="checkbox" ${raw(nm)} ${raw(f.v ? 'checked' : '')}> ${f.label}</label>`;
    return h`<label for="f_${f.k}">${f.label}</label>${f.type === 'select' ? h`<select id="f_${f.k}" ${raw(nm)} ${raw(f.req ? 'required' : '')}>${f.opts.map(([v, t]) => h`<option value="${v}" ${raw(String(v) === String(f.v) ? 'selected' : '')}>${t}</option>`)}</select>`
      : f.type === 'area' ? h`<textarea id="f_${f.k}" ${raw(nm)} rows="${f.rows || 3}" maxlength="${f.max || 500}">${f.v ?? ''}</textarea>`
        : h`<input id="f_${f.k}" ${raw(nm)} value="${f.v ?? ''}" maxlength="${f.max || 120}" ${raw(f.req ? 'required' : '')}>`}`;
  })}${extra}<p id="err" class="mute" role="alert" style="color:var(--brick)"></p><div class="acts"><button type="button" class="ghost" data-go="close">Cancelar</button><button type="submit">${label}</button></div></form>`);
  $('#f').onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(e.target), v = {}, sb = e.submitter;
    v.sel = [...new Set([...e.target.querySelectorAll('input[name^=sel]:checked')].map(x => Number(x.value)))];
    fields.forEach(f => v[f.k] = f.type === 'check' ? e.target.elements[f.k].checked : String(fd.get(f.k) ?? ''));
    if (sb) sb.disabled = true; let err;                      // evita envio duplicado
    try { err = await ok(v); } catch (x) { err = x.message; }
    if (err) { $('#err').textContent = err; if (sb) sb.disabled = false; } else dlg.close();
  };
}
export const raw = s => new Raw(s);
