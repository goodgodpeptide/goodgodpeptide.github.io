import json, tempfile, threading
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs" / "verification" / "20261026_patch_notes"
DRIVER = Path(r"C:\Users\hgd99\.cache\selenium\chromedriver\win64\155.0.8059.84\chromedriver.exe")

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args): pass

@contextmanager
def local_server():
    factory = lambda *a, **kw: QuietHandler(*a, directory=str(ROOT), **kw)
    server = ThreadingHTTPServer(("127.0.0.1", 0), factory)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try: yield "http://127.0.0.1:" + str(server.server_port)
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=3)

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    options = Options()
    for arg in ("--headless=new", "--window-size=430,1600", "--disable-gpu", "--no-first-run",
                "--disable-sync", "--disable-background-networking", "--disable-default-apps", "--disable-extensions"):
        options.add_argument(arg)
    with tempfile.TemporaryDirectory(prefix="ggp-static-chrome-") as profile, local_server() as base:
        options.add_argument("--user-data-dir=" + profile)
        driver = webdriver.Chrome(service=Service(str(DRIVER)), options=options)
        try:
            driver.get(base + "/index.html")
            WebDriverWait(driver, 20).until(lambda d: d.execute_script("return document.readyState") == "complete")
            exposed = driver.execute_script("""
              return Object.fromEntries(
                ['loadEncyclopedia','renderEncyclopedia','openEncyclopediaModal','renderCommunityPatchNotes']
                .map(k => [k, typeof window[k]])
              );
            """)
            actual_renderer = driver.execute_async_script("""
              const done = arguments[0];
              (async () => {
                try {
                  document.getElementById('auth-loading').style.display='none';
                  document.getElementById('login-screen').style.display='none';
                  const panel=document.getElementById('panel-encyclopedia');
                  panel.style.display='block';
                  await window.loadEncyclopedia();
                  window.renderEncyclopedia();
                  const all=document.querySelectorAll('#encyclopedia-grid > *').length;
                  if(all !== 115) throw new Error('백과 카드 수 불일치: '+all);
                  const found={};
                  const input=document.getElementById('enc-search');
                  for(const name of ['AICAR','코르타젠','클로토','PTD-DBM','SLU-PP-915']){
                    input.value=name; window.renderEncyclopedia();
                    found[name]=document.getElementById('encyclopedia-grid').innerText.includes(name);
                    if(!found[name]) throw new Error('신규 검색 실패: '+name);
                  }
                  input.value=''; window.renderEncyclopedia();
                  window.openEncyclopediaModal('epitalon');
                  const modal=[...document.querySelectorAll('[id]')].find(x => x.id.includes('enc-modal'));
                  const modalText=modal ? modal.innerText : document.body.innerText;
                  const epitalonSafety=modalText.includes('사람 피하 표준용량 미확립');
                  if(!epitalonSafety) throw new Error('에피탈론 한국어 안전 문구 누락');
                  done({cardCount:all,newSearch:found,epitalonModal:/에피탈론|Epitalon/.test(modalText),
                    epitalonSafety,
                    countText:document.getElementById('enc-count').innerText});
                } catch(e){done({error:String(e),stack:e.stack});}
              })();
            """)
            driver.save_screenshot(str(OUT / "encyclopedia_public_renderer.png"))
            rendered = driver.execute_async_script("""
              const done = arguments[0];
              fetch('./peptides_v3.json').then(r => r.json()).then(data => {
                const source = document.documentElement.innerHTML;
                const start = source.indexOf('const APP_CHANGELOG=[');
                const end = source.indexOf('];', start);
                const change = source.slice(start, end + 2);
                const dates = ['2026-10-26','2026-10-24','2026-09-01','2026-08-27'];
                const wanted = ['aicar','cortagen','klotho','ptd-dbm','slu-pp-915'];
                const five = data.index.filter(x => wanted.includes(x.id));
                const epi = data.index.filter(x => x.id === 'epitalon');
                const notes = dates.map((date,index) => {
                  const at=change.indexOf(date);
                  const next=index+1<dates.length ? change.indexOf(dates[index+1],at+date.length) : change.indexOf("{'date':",at+date.length);
                  const block=at<0?'':change.slice(at,next>at?next:change.length);
                  const bodies=[...block.matchAll(/'text':'([^']+)'/g)].map(x=>x[1]);
                  if(at<0 || !bodies.length) throw new Error('변경이력 본문 누락: '+date);
                  return {date,present:true,bodies};
                });
                const articles = five.map(x => '<article data-id="'+x.id+'">'+x.nameKo+'</article>').join('');
                const ep = epi.map(x => '<article>'+x.nameKo+'</article>').join('');
                const ns = notes.map(x => '<article data-date="'+x.date+'"><h3>'+x.date+'</h3><ul>'+x.bodies.map(t=>'<li>'+t+'</li>').join('')+'</ul></article>').join('');
                document.body.innerHTML = '<main id="fixture" style="font-family:sans-serif;padding:16px;background:#0a0a14;color:#e2e8f0"><h1>공개 정적 데이터 렌더 검증</h1><section><h2>백과사전 '+data.index.length+'개</h2></section><section><h2>신규 5종 검색</h2>'+articles+'</section><section><h2>에피탈론</h2>'+ep+'</section><section><h2>앱 변경이력</h2>'+ns+'</section><p>로그인·Firestore 없이 공개 정적 파일만 렌더한 테스트 fixture</p></main>';
                done({count:data.index.length, five:five.map(x=>x.nameKo), epitalon:epi.map(x=>x.nameKo),
                  notes, fixtureText:document.getElementById('fixture').innerText});
              }).catch(e => done({error:String(e)}));
            """)
            screenshot = OUT / "static_render_fixture.png"
            driver.save_screenshot(str(screenshot))
            result = {"scope":"격리된 임시 Chrome 프로필의 공개 정적 파일 fixture 렌더. 로그인 UI 또는 인증 후 실제 앱 화면 검증이 아님.",
                      "url":base + "/index.html", "chrome":driver.capabilities.get("browserVersion"),
                      "renderer_functions_on_window":exposed, "actual_public_renderer":actual_renderer,
                      "rendered":rendered, "screenshot":str(screenshot),
                      "actual_renderer_screenshot":str(OUT / "encyclopedia_public_renderer.png")}
            assert actual_renderer.get("cardCount") == 115, actual_renderer
            assert all(actual_renderer.get("newSearch", {}).values())
            assert actual_renderer.get("epitalonSafety") is True
            assert [x["date"] for x in rendered.get("notes", [])] == [
                "2026-10-26", "2026-10-24", "2026-09-01", "2026-08-27"
            ], rendered
            assert all(x.get("bodies") for x in rendered["notes"])
            (OUT / "static_render_result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
            print(json.dumps(result,ensure_ascii=False,indent=2))
        finally: driver.quit()

if __name__ == "__main__": main()
