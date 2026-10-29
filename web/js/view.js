// Renderização raiz.
import { $ } from './util.js';
import { clientView } from './client.js';
import { adminView } from './kitchen.js';
import { S, cart, db, ui } from './state.js';
import { h } from './util.js';

export function paint() {
  sessionStorage.cart = JSON.stringify(cart);
  const body = S.role === 'client' ? clientView() : S.role === 'kitchen' ? adminView()
    : h`<div class="login"><section><h2>Sou cliente</h2><p>Veja o cardápio, monte o pedido e acompanhe o preparo.</p><button data-go="role" data-v="client">Abrir cardápio</button></section>
    <section><h2>Cozinha / administração</h2><p>Pedidos, estatísticas e cardápio.</p><label for="pin">Senha</label><input id="pin" type="password" autocomplete="off"><div class="acts"><button data-go="role" data-v="kitchen">Entrar</button></div></section></div>`;
  const keep = document.activeElement?.id === 'pin' ? $('#pin').value : '';
  $('#root').innerHTML = h`<header><span class="logo">${db.cfg.name}</span>${db.offline && h`<span class="tag st-canceled">sem conexão</span>`}${S.role && h`<button class="ghost sm" data-go="out">Sair</button>`}</header><main class="${ui.fresh ? 'enter' : ''}">${body}</main>`.s; ui.fresh = false;
  if (keep) { $('#pin').value = keep; $('#pin').focus(); }
}
