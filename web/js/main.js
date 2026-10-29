// Ponto de entrada.
import { PH } from './util.js';
import { S, connect, refresh } from './state.js';
import { dlg } from './ui.js';
import { paint } from './view.js';
import './actions.js';                     // registra a delegação de eventos (data-go)

addEventListener('error', e => { if (e.target.tagName === 'IMG' && e.target.src !== PH) e.target.src = PH; }, true);   // foto quebrada → imagem padrão
if (new URLSearchParams(location.search).get('mesa') && !S.role) S.role = sessionStorage.role = 'client';
setInterval(() => { if (S.role && !dlg.open && !document.hidden) refresh(); }, 20000);   // rede de segurança além do SSE
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.role) refresh(); });
paint(); if (S.role) { refresh(); connect(); }
