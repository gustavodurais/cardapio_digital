from playwright.sync_api import sync_playwright
import subprocess, time, os, json, sqlite3, shutil
PORT=3461; URL=f'http://localhost:{PORT}/'; DB='/tmp/e2e.db'
for f in (DB,DB+'-wal',DB+'-shm'):
    if os.path.exists(f): os.remove(f)
env=dict(os.environ,KITCHEN_PIN='1234',DB_FILE=DB,PORT=str(PORT),TZ='America/Sao_Paulo')
srv=subprocess.Popen(['node','--disable-warning=ExperimentalWarning','server/index.js'],cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE); time.sleep(1.2)
R=[]; errs=[]
def T(n,c,x=''): R.append((n,bool(c),str(x)[:150]))
def run(n,f):
    try: f()
    except Exception as e: T(n+' [EXCEÇÃO]',False,' '.join(str(e).splitlines()[:5])[:380])
try:
  with sync_playwright() as p:
    b=p.chromium.launch(); M=dict(viewport={'width':375,'height':667},is_mobile=True,has_touch=True,device_scale_factor=2)
    cA,cB,cK=b.new_context(**M),b.new_context(**M),b.new_context(**M)   # 3 aparelhos distintos: cliente A, cliente B, cozinha
    def np(c):
        pg=c.new_page(); pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('dialog',lambda d:d.accept()); pg.goto(URL); return pg
    ov=lambda pg:pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
    def add(pg,n): pg.locator('.dish',has_text=n).locator('[data-go=add]').click()
    def opencart(pg): pg.click('.bar'); pg.wait_for_selector('dialog[open]'); pg.wait_for_timeout(650)
    def checkout(pg,table='5',name='',note='',fee=True):
        opencart(pg); pg.click('[data-go=checkout]'); pg.wait_for_selector('#f'); pg.select_option('#f_table',table); pg.fill('#f_name',name); pg.fill('#f_note',note); pg.set_checked('input[name=fee]',fee)
        pg.click('#f button[type=submit]'); pg.wait_for_timeout(600)
    def kapi(k,m,path,body=None):
        return k.evaluate("""async([m,p,b])=>{const r=await fetch(p,{method:m,headers:{'content-type':'application/json',authorization:'Bearer '+sessionStorage.token},body:b?JSON.stringify(b):undefined});return [r.status,await r.json().catch(()=>null)]}""",[m,path,body])
    def wf(pg,js,timeout=5000):   # polling próprio: wait_for_function usa eval e a CSP do servidor (corretamente) bloqueia
        t=time.time()
        while time.time()-t<timeout/1000:
            if pg.evaluate("() => "+js): return True
            time.sleep(0.1)
        raise Exception('tempo esgotado aguardando: '+js[:80])
    def kit_login(k,pin='1234'):
        k.fill('#pin',pin); k.click('[data-go=role][data-v=kitchen]'); k.wait_for_timeout(900)
    A=np(cA); K=np(cK); B=np(cB)
    def t1():
        A.click('[data-go=role][data-v=client]'); A.wait_for_selector('.dish'); A.wait_for_timeout(600)
        T('cliente 375px sem overflow; 7 itens',ov(A) and A.locator('.dish').count()==7,A.locator('.dish').count())
        sm=A.evaluate("[...document.querySelectorAll('button')].filter(b=>b.offsetParent&&!b.classList.contains('sm')&&b.getBoundingClientRect().height<43).map(b=>b.textContent.trim())"); T('alvos de toque >=44px',not sm,sm)
        A.set_viewport_size({'width':320,'height':640}); A.wait_for_timeout(200); T('320px sem overflow',ov(A)); A.set_viewport_size({'width':375,'height':667})
        add(A,'Bruschetta'); opencart(A); bx=A.locator('dialog').bounding_box()
        T('carrinho centralizado (mobile)',abs(bx['x']+bx['width']/2-187.5)<2 and abs(bx['y']+bx['height']/2-333.5)<30,bx); A.click('[data-go=close]'); A.wait_for_timeout(200)
        A.reload(); A.wait_for_selector('.bar'); T('carrinho sobrevive ao recarregar a página',A.locator('.bar').count()==1)
    run('t1',t1)
    def t2():
        add(A,'Filé'); A.wait_for_selector('dialog[open]'); A.click('#f button[type=submit]'); T('opção obrigatória bloqueia','Ponto da carne' in A.inner_text('#err'),A.inner_text('#err'))
        for lbl,ex in [('Ao ponto',True),('Ao ponto',True),('Bem passado',False)]:
            if lbl!='Ao ponto' or True: pass
        A.get_by_label('Ao ponto').check(); A.get_by_label('Mostarda e mel').check(); A.click('#f button[type=submit]'); A.wait_for_timeout(300)
        add(A,'Filé'); A.get_by_label('Ao ponto').check(); A.get_by_label('Mostarda e mel').check(); A.click('#f button[type=submit]'); A.wait_for_timeout(300)
        add(A,'Filé'); A.get_by_label('Bem passado').check(); A.click('#f button[type=submit]'); A.wait_for_timeout(300); opencart(A)
        T('mesmas opções somam; subtotal R$ 197,60',A.locator('dialog .ln').count()==3 and 'R$ 197,60' in A.inner_text('dialog'))
        A.click('[data-go=dec][data-k="2"]'); A.wait_for_timeout(200); T('qtd 0 remove; R$ 140,70',A.locator('dialog .ln').count()==2 and 'R$ 140,70' in A.inner_text('dialog'))
        A.click('[data-go=checkout]'); A.wait_for_selector('#f'); A.click('#f button[type=submit]'); T('mesa obrigatória',A.locator('#f').evaluate('f=>!f.checkValidity()'))
        A.select_option('#f_table','5'); A.fill('#f_name','<b>Ana</b>'); A.fill('#f_note','<img src=x onerror="window.__x=1">'); A.click('#f button[type=submit]'); A.wait_for_timeout(900)
        tx=A.inner_text('main'); T('pedido enviado: nº 1, total R$ 154,77 (servidor)','Pedido nº 1' in tx and 'R$ 154,77' in tx,tx[:100])
        T('XSS neutro no cliente',A.locator('main img[src=x]').count()==0 and A.evaluate('window.__x')is None); T('carrinho esvaziado',A.locator('.bar').count()==0)
        A.reload(); A.wait_for_selector('.dish'); A.click('[data-go=tab][data-v=mine]'); A.wait_for_selector('.ord'); T('"Meus pedidos" sobrevive ao recarregar (token local)',A.locator('.ord').count()==1)
    run('t2',t2)
    def t3():
        K.fill('#pin','0000'); K.click('[data-go=role][data-v=kitchen]'); K.wait_for_timeout(700); T('senha errada: continua no login + aviso',K.locator('#pin').count()==1 and 'incorreta' in K.inner_text('#toasts'))
        kit_login(K); T('cozinha sem overflow',ov(K))
        T('pílula Pendente=1',K.locator('.pills.cols .pill').first.inner_text().replace('\n','')=='Pendente1',K.locator('.pills.cols').inner_text())
        T('XSS neutro na cozinha','<img src=x' in K.inner_text('.board>section.cur') and K.locator('.ord.k img').count()==0)
        sm=K.evaluate("[...document.querySelectorAll('.ord.k button')].filter(b=>b.offsetParent&&b.getBoundingClientRect().height<43).length"); T('botões do card >=44px',sm==0)
        K.screenshot(path='/tmp/e2e_kitchen.png')
        K.click('[data-go=adv]'); wf(A,"document.querySelector('.track .cur')?.textContent==='Preparando'"); T('TEMPO REAL: cliente A (outro aparelho) vê "Preparando"',True)
        K.click('[data-go=col][data-v=prep]'); K.click('[data-go=adv]'); K.wait_for_timeout(300); K.click('[data-go=col][data-v=ready]'); K.click('[data-go=adv]'); K.wait_for_timeout(400)
        wf(A,"!document.querySelector('.track .cur') && document.querySelectorAll('.track .on').length==4"); T('cliente A vê pedido Entregue (4 etapas)',True)
        K.click('[data-go=col][data-v=done]'); T('entregue sem botões de avançar/cancelar',K.locator('.board>section.cur .ord.k').count()==1 and K.locator('.board>section.cur [data-go=adv],.board>section.cur [data-go=cancel]').count()==0)
    run('t3',t3)
    def t4():
        B.click('[data-go=role][data-v=client]'); B.wait_for_selector('.dish'); B.click('[data-go=tab][data-v=mine]'); B.wait_for_timeout(300); T('cliente B não vê o pedido do A',B.locator('.ord').count()==0)
        B.click('[data-go=tab][data-v=menu]'); add(B,'Água'); checkout(B,'3')
        K.wait_for_selector('.toast:has-text("Novo pedido")',timeout=5000); T('TEMPO REAL: cozinha recebe alerta de pedido novo',True)
        A.click('[data-go=tab][data-v=mine]'); A.wait_for_timeout(500); T('cliente A continua vendo só 1 pedido (o dele)',A.locator('.ord').count()==1)
        K.click('[data-go=col][data-v=new]'); K.click('[data-go=cancel]'); wf(B,"document.querySelector('.ord .tag')?.textContent==='Cancelado'"); T('cliente B vê "Cancelado" em tempo real',True)
        K.click('[data-go=adm][data-v=stats]'); K.wait_for_timeout(700); tx=K.inner_text('.kpis')
        T('stats: 2 pedidos, faturamento R$ 154,77, 1 cancelado',tx.split('\n')[0]=='2' and tx.count('R$ 154,77')>=2 and '1\nCancelados' in tx,tx.replace('\n',' | ')[:140]); T('mais vendido Filé (2); tempo médio exibido','Filé ao madeira (2)' in tx and 'min' in tx)
    run('t4',t4)
    def t5():
        before=json.dumps(kapi(K,'GET','/api/admin/orders')[1])
        K.click('[data-go=adm][data-v=items]'); K.locator('tr',has_text='Bruschetta').locator('[data-go=item]').click(); K.fill('#f_price','99,90'); K.click('#f button[type=submit]'); K.wait_for_timeout(700)
        T('diálogo fecha ao salvar item',K.locator('dialog[open]').count()==0)
        K.locator('tr',has_text='Filé').locator('[data-go=delItem]').click(); K.wait_for_timeout(700); after=json.dumps(kapi(K,'GET','/api/admin/orders')[1])
        T('editar/excluir item não altera pedidos antigos',before==after); K.click('[data-go=adm][data-v=stats]'); K.wait_for_timeout(300); T('faturamento intacto','R$ 154,77' in K.inner_text('.kpis'))
        K.click('[data-go=adm][data-v=cats]'); K.locator('tr',has_text='Pratos').locator('[data-go=catEdit]').click(); K.fill('#f_n','Principais'); K.click('#f button[type=submit]'); K.wait_for_timeout(700)
        cat=kapi(K,'GET','/api/admin/catalog')[1]; T('renomear categoria: sem órfãos e diálogo fecha',all(any(c['id']==i['catId'] for c in cat['cats']) for i in cat['items']) and K.locator('dialog[open]').count()==0)
        K.locator('tr',has_text='Entradas').locator('[data-go=catDel]').click(); K.wait_for_timeout(500); T('excluir categoria com itens é barrado',len(kapi(K,'GET','/api/admin/catalog')[1]['cats'])==len(cat['cats']))
    run('t5',t5)
    def t6():
        A.click('[data-go=tab][data-v=menu]'); add(A,'Água'); A.wait_for_selector('.bar')
        K.click('[data-go=adm][data-v=items]'); K.locator('tr',has_text='Água').locator('[data-go=toggle]').click(); K.wait_for_timeout(700)
        opencart(A); A.click('[data-go=checkout]'); A.wait_for_selector('#f'); A.select_option('#f_table','5'); A.click('#f button[type=submit]'); A.wait_for_timeout(700)
        T('item que ficou indisponível: servidor recusa com mensagem','indisponível' in A.inner_text('#err'),A.inner_text('#err')); A.click('[data-go=close]'); A.wait_for_timeout(300)
        A.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); A.wait_for_timeout(700); T('cliente atualiza cardápio ao voltar ao app (Água sumiu)',A.locator('.dish',has_text='Água').count()==0)
        K.locator('tr',has_text='Água').locator('[data-go=toggle]').click(); K.wait_for_timeout(500)
    run('t6',t6)
    def t7():
        con=sqlite3.connect(DB); now=int(time.time()*1000)
        for st,ago in [('prep',26*3600e3),('done',30*3600e3),('new',25*60e3)]:
            con.execute("insert into orders(tbl,sub,fee,total,token,status,new_at) values('7',100,0,100,'t',?,?)",(st,int(now-ago)))
        con.commit(); con.close(); K.reload(); K.wait_for_selector('.ord.k, .empty'); K.click('[data-go=adm][data-v=board]'); K.wait_for_timeout(300)
        K.click('[data-go=col][data-v=prep]'); T('pedido ativo de ontem continua e está atrasado',K.locator('.ord.k.late:visible').count()==1)
        K.click('[data-go=col][data-v=new]'); T('pedido >20 min com alerta',K.locator('.ord.k.late:visible').count()==1)
        K.click('[data-go=col][data-v=done]'); T('entregue de ontem fora do quadro',K.locator('.ord.k:visible',has_text='Mesa 7').count()==0)
        K.click('[data-go=adm][data-v=stats]'); K.wait_for_timeout(300); T('stats ignoram dias anteriores; sessão sobreviveu ao reload','R$ 154,77' in K.inner_text('.kpis'))
    run('t7',t7)
    def t8():
        K.click('[data-go=adm][data-v=items]'); K.click('[data-go=item][data-id=""]'); K.fill('#f_name','Pudim <script>alert(1)</script>'); K.fill('#f_price','1.234,56'); K.fill('#f_img','javascript:alert(1)'); K.click('#f button[type=submit]'); T('foto javascript: rejeitada','http' in K.inner_text('#err'))
        K.fill('#f_img','https://invalid.example/x.png'); K.click('#f button[type=submit]'); K.wait_for_timeout(900)
        A.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); A.click('[data-go=tab][data-v=menu]'); A.wait_for_timeout(2500); d=A.locator('.dish',has_text='Pudim')
        T('item novo: nome como texto, R$ 1.234,56, foto quebrada vira padrão',d.count()==1 and '<script>' in d.inner_text() and 'R$ 1.234,56' in d.inner_text() and d.locator('img').get_attribute('src').startswith('data:image'))
        K.click('[data-go=adm][data-v=tables]'); K.click('[data-go="tab+"]'); K.fill('#f_n','5'); K.click('#f button[type=submit]'); T('mesa duplicada rejeitada','Já existe' in K.inner_text('#err'))
        K.fill('#f_n','VIP'); K.click('#f button[type=submit]'); K.wait_for_timeout(600); T('diálogo fecha ao criar mesa',K.locator('dialog[open]').count()==0)
        K.locator('tr',has_text='Mesa 1').first.locator('[data-go=tabOn]').click(); K.wait_for_timeout(600)
        K.click('[data-go=adm][data-v=groups]'); K.click('[data-go=grp][data-id=""]'); K.fill('#f_n','Extras'); K.fill('#f_ch','Queijo | abc'); K.click('#f button[type=submit]'); T('opcional inválido rejeitado','inválida' in K.inner_text('#err'))
        K.fill('#f_ch','Queijo | 3,50\nBacon | 5'); K.click('#f button[type=submit]'); K.wait_for_timeout(700)
        K.click('[data-go=adm][data-v=items]'); K.locator('tr',has_text='Risoto').locator('[data-go=item]').click(); K.get_by_label('Extras',exact=True).check(); K.click('#f button[type=submit]'); K.wait_for_timeout(700)
        K.click('[data-go=adm][data-v=cfg]'); K.click('[data-go=cfg]'); K.fill('#f_fee','50'); K.click('#f button[type=submit]'); T('taxa >30% rejeitada','Taxa' in K.inner_text('#err'))
        K.fill('#f_fee','0'); K.set_checked('input[name=feeOn]',False); K.click('#f button[type=submit]'); K.wait_for_timeout(700)
        A.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); A.wait_for_timeout(600); add(A,'Risoto'); A.wait_for_selector('dialog[open]'); T('opcional novo chega ao cliente (+ R$ 3,50)','+ R$ 3,50' in A.inner_text('dialog'))
        A.get_by_label('Queijo').check(); A.click('#f button[type=submit]'); A.wait_for_timeout(300); opencart(A); A.click('[data-go=checkout]'); A.wait_for_selector('#f'); opts=A.locator('#f_table option').all_inner_texts()
        T('mesa desativada some; VIP aparece',not any(o=='Mesa 1' for o in opts) and 'Mesa VIP' in opts); T('taxa 0% desmarcada por padrão','(0%)' in A.inner_text('#f') and not A.locator('input[name=fee]').is_checked())
        A.select_option('#f_table','VIP'); A.click('#f button[type=submit]'); A.wait_for_timeout(800); T('total sem taxa: Risoto 42,50 + Queijo 3,50 + Água 6,00 (que ficou no carrinho) = R$ 52,00','R$ 52,00' in A.inner_text('main'),A.inner_text('main')[:160])
    run('t8',t8)
    def t9():
        K.evaluate("window.print=()=>{window.__p=1}"); K.click('[data-go=adm][data-v=board]'); K.click('[data-go=col][data-v=done]'); K.locator('.board>section.cur [data-go=print]').first.click()
        T('comanda monta e imprime','COMANDA' in K.inner_html('#ticket') and K.evaluate('window.__p')==1)
        K.click('[data-go=adm][data-v=cfg]'); K.click('[data-go=cfg]'); K.fill('#f_pin','novaPIN'); K.click('#f button[type=submit]'); K.wait_for_timeout(700)
        K.click('[data-go=out]'); K.wait_for_timeout(500); T('sair volta ao login',K.locator('#pin').count()==1); kit_login(K,'1234'); T('senha antiga não entra',K.locator('#pin').count()==1); kit_login(K,'novaPIN'); T('senha nova entra',K.locator('#pin').count()==0)
    run('t9',t9)
    def t10():
        cA.set_offline(True); A.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); A.wait_for_timeout(700); T('offline: aviso "sem conexão" no cabeçalho','sem conexão' in A.inner_text('header'))
        cA.set_offline(False); A.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); A.wait_for_timeout(900); T('volta online: aviso some','sem conexão' not in A.inner_text('header'))
    run('t10',t10)
    def t11():
        dc=b.new_context(viewport={'width':1280,'height':800}); d=np(dc); d.click('[data-go=role][data-v=client]'); d.wait_for_selector('.dish'); d.wait_for_timeout(700)
        cols=d.evaluate("getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length"); T('desktop: grade 4+ colunas, sem overflow',cols>=4 and ov(d),cols)
        add(d,'Bruschetta'); opencart(d); bx=d.locator('dialog').bounding_box(); T('desktop: carrinho centralizado',abs(bx['x']+bx['width']/2-640)<2 and abs(bx['y']+bx['height']/2-400)<30,bx)
        d.click('[data-go=close]'); d.click('[data-go=out]'); d.fill('#pin','novaPIN'); d.click('[data-go=role][data-v=kitchen]'); d.wait_for_timeout(900)
        T('desktop: 5 colunas visíveis, pílulas ocultas',d.locator('.board>section:visible').count()==5 and d.locator('.pills.cols:visible').count()==0)
    run('t11',t11)
    T('sem erros de JS',not errs,errs[:2]); b.close()
finally:
    srv.terminate(); err=srv.stderr.read().decode()[:300]
    if 'Error' in err: print('SERVER ERR:',err)
ok=sum(1 for r in R if r[1])
for n,c_,x in R:
    if not c_: print('✗',n,'|',x)
print(f'{ok}/{len(R)} passaram')
import sys; sys.exit(0 if ok==len(R) else 1)
