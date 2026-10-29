"""Gera docs/*.png e docs/demo.gif a partir do app rodando (requer playwright + Pillow)."""
from playwright.sync_api import sync_playwright
from PIL import Image
import subprocess, time, os, json, urllib.request, sqlite3
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); DOCS=os.path.join(ROOT,'docs'); PORT=3475; BASE=f'http://localhost:{PORT}'; DB='/tmp/capture.db'
for f in (DB,DB+'-wal',DB+'-shm'):
    if os.path.exists(f): os.remove(f)
srv=subprocess.Popen(['node','--disable-warning=ExperimentalWarning','server/index.js'],cwd=ROOT,env=dict(os.environ,KITCHEN_PIN='1234',DB_FILE=DB,PORT=str(PORT),TZ='America/Sao_Paulo'),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1.2)
def call(m,p,b=None,t=None):
    r=urllib.request.Request(BASE+p,data=json.dumps(b).encode() if b is not None else None,method=m,headers={'content-type':'application/json',**({'authorization':'Bearer '+t} if t else {})})
    return json.load(urllib.request.urlopen(r))
try:
    tok=call('POST','/api/auth/login',{'pin':'1234'})['token']; menu=call('GET','/api/menu'); it={i['name']:i for i in menu['items']}
    def mk(table,name,note,lines,adv=0):
        o=call('POST','/api/orders',{'table':table,'name':name,'note':note,'fee':True,'lines':lines})
        for s in ['prep','ready','done'][:adv]: call('PATCH',f"/api/admin/orders/{o['id']}",{'status':s},tok)
    ag=it['Água mineral']['id']; bru=it['Bruschetta de tomate']['id']; ris=it['Risoto de cogumelos']['id']
    for t,n in [('2','Carla'),('4','Diego'),('6','Marta')]: mk(t,n,'',[{'itemId':ris,'qty':1},{'itemId':ag,'qty':2}],3)
    mk('1','','',[{'itemId':bru,'qty':2}],2); mk('9','Léo','sem cebola, por favor',[{'itemId':ris,'qty':1}],1); mk('3','Bia','',[{'itemId':bru,'qty':1},{'itemId':ag,'qty':1}])
    con=sqlite3.connect(DB); now=int(time.time()*1000); mn=60000   # tempos realistas para a demonstração
    for tbl,age,ready in [('2',80,11),('4',60,14),('6',40,9)]: con.execute("update orders set new_at=?,prep_at=?,ready_at=?,done_at=? where tbl=?",(now-age*mn,now-(age-2)*mn,now-(age-ready)*mn,now-(age-ready-2)*mn,tbl))
    con.execute("update orders set new_at=?,prep_at=? where tbl='9'",(now-23*mn,now-20*mn)); con.execute("update orders set new_at=?,prep_at=?,ready_at=? where tbl='1'",(now-14*mn,now-12*mn,now-3*mn)); con.execute("update orders set new_at=? where tbl='3'",(now-3*mn,)); con.commit(); con.close()
    M=dict(viewport={'width':390,'height':780},is_mobile=True,has_touch=True,device_scale_factor=2)
    with sync_playwright() as p:
        b=p.chromium.launch(); frames=[]
        def shot(pg,name,gif=True):
            path=os.path.join(DOCS,name+'.png'); pg.screenshot(path=path)
            if gif: frames.append(path)
        c=b.new_context(**M); pg=c.new_page(); pg.goto(BASE); pg.add_style_tag(content='#toasts{display:none}'); pg.click('[data-go=role][data-v=client]'); pg.wait_for_selector('.dish'); pg.wait_for_timeout(900); shot(pg,'cliente-cardapio')
        pg.locator('.dish',has_text='Filé').locator('[data-go=add]').click(); pg.wait_for_selector('dialog[open]'); pg.wait_for_timeout(500)
        pg.get_by_label('Ao ponto').check(); pg.get_by_label('Mostarda e mel').check(); shot(pg,'cliente-opcoes'); pg.click('#f button[type=submit]'); pg.wait_for_timeout(400)
        pg.locator('.dish',has_text='Brownie').locator('[data-go=add]').click(); pg.wait_for_selector('dialog[open]'); pg.get_by_label('Doce de leite').check(); pg.click('#f button[type=submit]'); pg.wait_for_timeout(400)
        pg.click('.bar'); pg.wait_for_timeout(700); shot(pg,'cliente-carrinho'); pg.click('[data-go=checkout]'); pg.wait_for_selector('#f'); pg.select_option('#f_table','5'); pg.fill('#f_name','Ana'); pg.click('#f button[type=submit]'); pg.wait_for_timeout(900)
        oid=json.loads(pg.evaluate("localStorage['brasa.pedidos']"))[0].split('.')[0]; call('PATCH',f'/api/admin/orders/{oid}',{'status':'prep'},tok); pg.wait_for_timeout(1200); pg.evaluate('window.scrollTo(0,0)'); shot(pg,'cliente-acompanhamento')
        k=b.new_context(**M).new_page(); k.goto(BASE); k.fill('#pin','1234'); k.click('[data-go=role][data-v=kitchen]'); k.wait_for_selector('.ord.k'); k.wait_for_timeout(900); shot(k,'cozinha-quadro'); k.click('[data-go=col][data-v=prep]'); k.wait_for_timeout(500); shot(k,'cozinha-atrasado')
        k.click('[data-go=adm][data-v=stats]'); k.wait_for_timeout(900); shot(k,'cozinha-estatisticas')
        d=b.new_context(viewport={'width':1360,'height':820}).new_page(); d.goto(BASE); d.fill('#pin','1234'); d.click('[data-go=role][data-v=kitchen]'); d.wait_for_selector('.ord.k'); d.wait_for_timeout(1000); shot(d,'cozinha-desktop',gif=False)
        b.close()
    ims=[Image.open(f).convert('RGB') for f in frames]; W=300; ims=[i.resize((W,round(i.height*W/i.width)),Image.LANCZOS) for i in ims]
    q=[i.quantize(colors=96,method=Image.MEDIANCUT) for i in ims]; q[0].save(os.path.join(DOCS,'demo.gif'),save_all=True,append_images=q[1:],duration=1500,loop=0,optimize=True)
    print('ok',[os.path.basename(f) for f in frames])
finally: srv.terminate()
