import json
import tempfile
import threading
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs" / "verification" / "20261026_microdose_graph"
DRIVER = Path(r"C:\Users\hgd99\.cache\selenium\chromedriver\win64\155.0.8059.84\chromedriver.exe")

HOOK = r"""
window.__microGraphTest = {
  run(records, filter = '에피탈론', rangeHours = 24) {
    const original = JSON.parse(JSON.stringify(records));
    const texts = [], strokes = [];
    const proto = CanvasRenderingContext2D.prototype;
    const nativeFillText = proto.fillText;
    const nativeBeginPath = proto.beginPath;
    const nativeMoveTo = proto.moveTo;
    const nativeLineTo = proto.lineTo;
    const nativeStroke = proto.stroke;
    let path = [];
    proto.fillText = function(text, x, y, ...rest) {
      texts.push({text: String(text), x: Number(x), y: Number(y), fillStyle: String(this.fillStyle)});
      return nativeFillText.call(this, text, x, y, ...rest);
    };
    proto.beginPath = function(...args) { path = []; return nativeBeginPath.apply(this, args); };
    proto.moveTo = function(x, y) { path.push([Number(x), Number(y)]); return nativeMoveTo.call(this, x, y); };
    proto.lineTo = function(x, y) { path.push([Number(x), Number(y)]); return nativeLineTo.call(this, x, y); };
    proto.stroke = function(...args) {
      if (path.length > 5) {
        const ys = path.map(point => point[1]).filter(Number.isFinite);
        strokes.push({strokeStyle: String(this.strokeStyle), points: path.length,
          minY: Math.min(...ys), maxY: Math.max(...ys), spanY: Math.max(...ys) - Math.min(...ys)});
      }
      return nativeStroke.apply(this, args);
    };
    try {
      appData.records = JSON.parse(JSON.stringify(records));
      graphDrugFilter = filter;
      graphRangeHours = rangeHours;
      graphZoom = {scale: 1, offsetX: 0};
      const canvas = document.getElementById('peptide-chart');
      let node = canvas;
      while (node) { if (node.style) node.style.display = 'block'; node = node.parentElement; }
      document.getElementById('auth-loading')?.style.setProperty('display', 'none');
      document.getElementById('login-screen')?.style.setProperty('display', 'none');
      canvas.style.width = '390px';
      canvas.style.height = '300px';
      renderPeptideGraph();
      const hint = document.getElementById('graph-legend-hint');
      return {
        texts, strokes, hint: hint?.innerText || '', width: canvas.width, height: canvas.height,
        recordsUnchanged: JSON.stringify(appData.records) === JSON.stringify(original),
        config: {
          epithalonClinicalMax: DRUG_CONFIG['에피탈론 (Epithalon)'].clinicalMax,
          epithalonColor: DRUG_CONFIG['에피탈론 (Epithalon)'].color,
          retatrutideClinicalMax: DRUG_CONFIG['레타 (Retatrutide)'].clinicalMax,
          tirzepatideClinicalMax: DRUG_CONFIG['마운자로 (Tirzepatide)'].clinicalMax,
        },
      };
    } finally {
      proto.fillText = nativeFillText;
      proto.beginPath = nativeBeginPath;
      proto.moveTo = nativeMoveTo;
      proto.lineTo = nativeLineTo;
      proto.stroke = nativeStroke;
    }
  },
};
"""


class FixtureHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path.split("?", 1)[0] in ("/", "/index.html"):
            source = (ROOT / "index.html").read_text(encoding="utf-8")
            auth_listener = "onAuthStateChanged(auth,"
            if source.count(auth_listener) != 1:
                self.send_error(500, "auth listener replacement count mismatch")
                return
            source = source.replace(auth_listener, "((...args) => () => {})(auth,", 1)
            marker = "</script>\n\n  <style>"
            if marker not in source:
                self.send_error(500, "module script insertion marker missing")
                return
            body = source.replace(marker, HOOK + "\n</script>\n\n  <style>", 1).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


@contextmanager
def local_server():
    factory = lambda *args, **kwargs: FixtureHandler(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", 0), factory)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def record(drug, dose, age_minutes):
    return {"drug": drug, "dose": dose, "time": {"ageMinutes": age_minutes}}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    options = Options()
    for arg in ("--headless=new", "--window-size=430,900", "--disable-gpu", "--no-first-run",
                "--disable-sync", "--disable-background-networking", "--disable-default-apps",
                "--disable-extensions"):
        options.add_argument(arg)

    with tempfile.TemporaryDirectory(prefix="ggp-microdose-chrome-") as profile, local_server() as base:
        options.add_argument("--user-data-dir=" + profile)
        driver = webdriver.Chrome(service=Service(str(DRIVER)), options=options)
        try:
            driver.execute_cdp_cmd("Network.enable", {})
            driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": [
                "*firestore.googleapis.com/*", "*identitytoolkit.googleapis.com/*",
                "*securetoken.googleapis.com/*",
            ]})
            driver.get(base + "/index.html")
            WebDriverWait(driver, 25).until(
                lambda d: d.execute_script("return typeof window.__microGraphTest?.run === 'function'")
            )

            now = driver.execute_script("return Date.now()")
            epi = "에피탈론 (Epithalon)"
            reta = "레타 (Retatrutide)"
            tirz = "마운자로 (Tirzepatide)"

            def run(records, filter_name="에피탈론"):
                materialized = [{**r, "time": now - r["time"]["ageMinutes"] * 60_000} for r in records]
                return driver.execute_script(
                    "return window.__microGraphTest.run(arguments[0], arguments[1], 24)",
                    materialized, filter_name,
                )

            singles = {}
            for dose in (0.05, 0.1, 0.2, 0.5):
                result = run([record(epi, dose, 30)])
                labels = [item["text"] for item in result["texts"]]
                assert any("µg" in label for label in labels), (dose, labels)
                assert "10mg" not in labels and "20mg" not in labels, (dose, labels)
                assert result["recordsUnchanged"] and result["config"]["epithalonClinicalMax"] == 20
                curve_spans = [stroke["spanY"] for stroke in result["strokes"] if stroke["points"] > 20]
                assert curve_spans and max(curve_spans) >= 20, (dose, curve_spans)
                singles[str(dose)] = result
                if dose == 0.2:
                    canvas = driver.find_element("id", "peptide-chart")
                    driver.execute_script("arguments[0].scrollIntoView({block:'center'})", canvas)
                    canvas.screenshot(str(OUT / "epithalon_0_2mg.png"))

            multi = run([
                record(epi, 0.2, 20), record(reta, 4, 40), record(tirz, 4, 60),
            ], "전체")
            epi_multi_strokes = [stroke for stroke in multi["strokes"]
                                 if stroke["strokeStyle"].lower() == multi["config"]["epithalonColor"].lower()
                                 and stroke["points"] > 20]
            assert epi_multi_strokes and max(stroke["spanY"] for stroke in epi_multi_strokes) >= 20, epi_multi_strokes
            multi_canvas = driver.find_element("id", "peptide-chart")
            driver.execute_script("arguments[0].scrollIntoView({block:'center'})", multi_canvas)
            multi_canvas.screenshot(str(OUT / "multi_epithalon_0_2_reta4_tirz4.png"))
            assert "200µg" in multi["hint"], multi["hint"]
            assert "레타" in multi["hint"] and "12mg" in multi["hint"], multi["hint"]
            assert "마운자로" in multi["hint"] and "15mg" in multi["hint"], multi["hint"]
            assert multi["config"] == {
                "epithalonClinicalMax": 20, "epithalonColor": "#c084fc",
                "retatrutideClinicalMax": 12, "tirzepatideClinicalMax": 15,
            }

            historical = run([record(epi, 20, 90), record(epi, 0.2, 20)])
            historical_labels = [item["text"] for item in historical["texts"]]
            assert any(label.endswith("mg") for label in historical_labels), historical_labels
            assert not all("µg" in label for label in historical_labels if "g" in label), historical_labels

            result = {
                "scope": "격리 Chrome, 메모리 HTML fixture, 합성 투약 기록만 사용. fixture에서 auth listener 등록을 비활성화했으며 로그인/사용자 프로필/Firestore 접근 없음.",
                "authListenerDisabledInFixture": True,
                "chrome": driver.capabilities.get("browserVersion"),
                "blocked": ["firestore.googleapis.com", "identitytoolkit.googleapis.com", "securetoken.googleapis.com"],
                "singleDoseCases": singles,
                "multiDrug": multi,
                "multiEpithalonCurveStrokes": epi_multi_strokes,
                "historical20mg": historical,
                "screenshot": str(OUT / "epithalon_0_2mg.png"),
                "multiScreenshot": str(OUT / "multi_epithalon_0_2_reta4_tirz4.png"),
            }
            (OUT / "microdose_graph_result.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            print(json.dumps({
                "singleLabels": {dose: [x["text"] for x in data["texts"] if "g" in x["text"]]
                                 for dose, data in singles.items()},
                "multiHint": multi["hint"],
                "historicalLabels": [x for x in historical_labels if "g" in x],
                "screenshot": result["screenshot"],
            }, ensure_ascii=False, indent=2))
        finally:
            driver.quit()


if __name__ == "__main__":
    main()
