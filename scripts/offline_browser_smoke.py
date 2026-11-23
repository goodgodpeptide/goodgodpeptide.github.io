"""격리 프로필/로컬서버 전용. 외부 연결 차단, 실제 로그인/서버자료 접근 없음."""
import json, tempfile, threading, time, io, sys
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'outputs'/'offline_browser_smoke'
DRIVER=Path(r'C:\Users\hgd99\.cache\selenium\chromedriver\win64\158.0.8127.36\chromedriver.exe')
PROBE = """
window.__offlineProbe={async select(seed=false){const user={uid:'OFFLINE_SMOKE_SYNTHETIC_UID',email:'offline-smoke@example.invalid',displayName:'합성 검증'};currentUser=user;offlineApp.approvals.record(user,true);if(seed){const base=JSON.parse(JSON.stringify(_offlineInitialData));await offlineApp.engine.stage(user.uid,base,{base});}if(!offlineApp.restore(user,{offline:true}))throw Error('synthetic restore failed');offlineShowUser();return {data:appData};},data:()=>JSON.parse(JSON.stringify(appData)),state:()=>({user:currentUser?.uid,dataLoaded,state:offlineApp.engine.load('OFFLINE_SMOKE_SYNTHETIC_UID')})};
"""
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args): pass
 def send_head(self):
  if self.path.split('?')[0] in ['/', '/index.html']:
   source=(ROOT/'index.html').read_text(encoding='utf8')
   start=source.index('<script type="module">');end=source.index('</script>',start)
   body=(source[:end]+PROBE+source[end:]).encode('utf8')
   self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();return io.BytesIO(body)
  return super().send_head()
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 server=ThreadingHTTPServer(('127.0.0.1',0),lambda *a,**kw:Handler(*a,directory=str(ROOT),**kw))
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 base=f'http://127.0.0.1:{server.server_port}'
 result={'scope':'임시 프로필, 로컬 정적 파일. 실제 인증/서버자료 검증 아님.'}
 try:
  with tempfile.TemporaryDirectory(prefix='ggp-offline-smoke-') as profile:
   options=Options()
   for arg in ['--headless=new','--window-size=430,1000','--disable-gpu','--no-first-run','--disable-background-networking','--disable-sync','--user-data-dir='+profile]:options.add_argument(arg)
   options.set_capability('goog:loggingPrefs',{'browser':'ALL'})
   driver=webdriver.Chrome(service=Service(str(DRIVER)),options=options)
   try:
    driver.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
    driver.execute_cdp_cmd('Network.enable',{})
    driver.execute_cdp_cmd('Network.setBlockedURLs',{'urls':['https://*','http://*.googleapis.com/*']})
    driver.get(base+'/index.html')
    WebDriverWait(driver,30).until(lambda d:d.execute_script('return document.readyState')=='complete')
    registration=driver.execute_async_script("const done=arguments[0];navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(r=>done({active:r.active.scriptURL})).catch(e=>done({error:String(e)}))")
    assert 'error' not in registration,registration
    WebDriverWait(driver,30).until(lambda d:d.execute_script('return !!navigator.serviceWorker.controller'))
    result['registration']=registration
    driver.execute_cdp_cmd('Network.emulateNetworkConditions',{'offline':True,'latency':0,'downloadThroughput':0,'uploadThroughput':0})
    driver.refresh()
    WebDriverWait(driver,30).until(lambda d:d.execute_script('return document.readyState')=='complete')
    result['offline']=driver.execute_async_script("""const done=arguments[0];(async()=>{try{const data=await(await fetch('./peptides_v3.json')).json();const sync=await import('./offline_sync.js');const app=await import('./vendor/firebase-10.12.0/firebase-app.js');const auth=await import('./vendor/firebase-10.12.0/firebase-auth.js');const fs=await import('./vendor/firebase-10.12.0/firebase-firestore.js');done({online:navigator.onLine,encyclopediaCount:data.index.length,moduleExports:[typeof sync.createOfflineSync,typeof app.initializeApp,typeof auth.getAuth,typeof fs.getFirestore],bodyText:document.body.innerText.slice(0,1500),offlineIndicators:[...document.querySelectorAll('[id]')].filter(e=>/offline/i.test(e.id)).map(e=>({id:e.id,text:e.innerText,visible:!!e.getClientRects().length}))});}catch(e){done({error:String(e)})}})()""")
    assert 'error' not in result['offline'],result['offline']
    assert result['offline']['online'] is False
    assert result['offline']['encyclopediaCount']>0
    assert all(x=='function' for x in result['offline']['moduleExports'])
    result['syntheticStorage']=driver.execute_async_script("""const done=arguments[0];(async()=>{try{const {createOfflineSync}=await import('./offline_sync.js');const {createIndexedArchive}=await import('./offline_app.js');const engine=createOfflineSync({storage:localStorage,archive:createIndexedArchive(indexedDB),locks:navigator.locks,readRemote:async()=>{throw Error('NO REAL NETWORK')},commitRemote:async()=>{throw Error('NO REAL NETWORK')}});await engine.stage('OFFLINE_ENGINE_SYNTHETIC_UID',{records:[{id:'synthetic',weight:70}]},{base:{records:[]}});const staged=engine.load('OFFLINE_ENGINE_SYNTHETIC_UID');done({fixture:true,pending:staged.pending,data:staged.data});}catch(e){done({error:String(e)})}})()""")
    assert 'error' not in result['syntheticStorage'],result['syntheticStorage']
    time.sleep(2)
    result['mainFixture']=driver.execute_async_script("const done=arguments[0];window.__offlineProbe.select(true).then(done).catch(e=>done({error:String(e)}))")
    assert 'error' not in result['mainFixture'],result['mainFixture']
    driver.execute_script("document.getElementById('add-weight').value='71.3';document.getElementById('add-weight-time').value='2026-11-24T10:30';window.submitAddWeight();")
    WebDriverWait(driver,15).until(lambda d:'71.3' in json.dumps(d.execute_script('return window.__offlineProbe.state()')))
    result['afterInput']=driver.execute_script('return {data:window.__offlineProbe.data(),state:window.__offlineProbe.state()}')
    driver.refresh()
    WebDriverWait(driver,20).until(lambda d:d.execute_script('return !!window.__offlineProbe'))
    time.sleep(2)
    result['mainRestored']=driver.execute_async_script("const done=arguments[0];window.__offlineProbe.select(false).then(done).catch(e=>done({error:String(e)}))")
    assert 'error' not in result['mainRestored'],result['mainRestored']
    assert '71.3' in json.dumps(result['mainRestored']),result['mainRestored']
    driver.execute_script("[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='체중')?.click()")
    result['renderedWeightVisible']='71.3' in driver.execute_script('return document.body.innerText')
    result['fixtureScope']='테스트 응답에만 probe 삽입. 합성 계정 승인/복원 후 실제 submitAddWeight 사용. 실제 Google 로그인/서버 승인 검증 아님.'
    result['mobileLayout']=driver.execute_script("return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,wide:[...document.querySelectorAll('header,header *')].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>({tag:e.tagName,id:e.id,text:e.innerText.slice(0,90),right:e.getBoundingClientRect().right}))}")
    driver.save_screenshot(str(OUT/'offline.png'))
    result['browserLogs']=driver.get_log('browser')
    result['moduleErrors']=[x for x in result['browserLogs'] if x['level']=='SEVERE' and any(k in x['message'] for k in ['SyntaxError','Failed to load module','Uncaught'])]
    assert not result['moduleErrors'],result['moduleErrors']
    result['offlineNoticeVisible']=driver.execute_script("const e=document.getElementById('jwbs-offline-ready');return !!e && !!e.getClientRects().length && getComputedStyle(e).visibility!=='hidden' && e.innerText.includes('오프라인')")
    result['passed']=result['offlineNoticeVisible'] and result['renderedWeightVisible']
   finally:
    try:
     result['lastLogs']=driver.get_log('browser')
     result['lastProbe']=driver.execute_script('return window.__offlineProbe ? {data:window.__offlineProbe.data(),state:window.__offlineProbe.state(),text:document.body.innerText.slice(-2000)} : null')
     driver.save_screenshot(str(OUT/'last-state.png'))
    except Exception as error: result['diagnosticError']=str(error)
    driver.quit()
 finally:
  server.shutdown();server.server_close();thread.join(timeout=3)
  (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
 print(json.dumps(result,ensure_ascii=False,indent=2))
 assert result.get('passed'),'오프라인 안내 표시 확인 필요'
if __name__=='__main__':main()
