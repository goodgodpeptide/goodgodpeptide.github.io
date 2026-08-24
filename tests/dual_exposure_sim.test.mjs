import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMPACT_GLP1_WARNING_CSS,
  COMPACT_GLP1_WARNING_FALLBACK,
  DUAL_EXPOSURE_NOTICE,
  buildWeeklyRegimen,
  compactExistingGlp1Warning,
  compactGlp1WarningText,
  simulateDualExposure,
} from "../dual_exposure_sim.js";

test("레타 일요일·마운자로 목요일 주간 투약일을 각각 보존한다", () => {
  assert.deepEqual(
    buildWeeklyRegimen({ doseMg: 6, halfLifeDays: 6, weekday: 6, weeks: 3 }).map((event) => event.day),
    [6, 13, 20],
  );
  assert.deepEqual(
    buildWeeklyRegimen({ doseMg: 2.5, halfLifeDays: 5, weekday: 3, weeks: 3 }).map((event) => event.day),
    [3, 10, 17],
  );
});

test("개별 잔류곡선과 합산 노출지수를 같은 시점에서 대사한다", () => {
  const result = simulateDualExposure({
    primary: { doseMg: 6, halfLifeDays: 6, referenceMg: 12, weekday: 6 },
    secondary: { doseMg: 2.5, halfLifeDays: 5, referenceMg: 15, weekday: 3 },
    weeks: 12,
  });
  assert.ok(result.points.length > 300);
  for (const point of result.points) {
    assert.ok(Math.abs(point.combinedIndexPercent - point.primaryPercent - point.secondaryPercent) < 1e-9);
  }
  assert.ok(result.primaryStats.cmaxMg > 6);
  assert.ok(result.secondaryStats.cmaxMg > 2.5);
  assert.ok(result.primaryStats.cminMg > 0);
  assert.ok(result.secondaryStats.cminMg > 0);
});

test("반복투여 합산 노출이 100%를 넘어도 Y축을 절단하지 않는다", () => {
  const result = simulateDualExposure({
    primary: { doseMg: 12, halfLifeDays: 6, referenceMg: 12, weekday: 6 },
    secondary: { doseMg: 15, halfLifeDays: 5, referenceMg: 15, weekday: 3 },
    weeks: 24,
  });
  assert.ok(Math.max(...result.points.map((point) => point.combinedIndexPercent)) > 100);
  assert.ok(result.axisMaxPercent > 100);
});

test("병용 그래프는 효과·안전성 판정이 아니라는 경고를 고정한다", () => {
  assert.match(DUAL_EXPOSURE_NOTICE, /병용 안전성은 확립되지 않았습니다/);
  assert.match(DUAL_EXPOSURE_NOTICE, /동등용량·효과·안전성·병용 허용을 뜻하지 않습니다/);
});

test("큰 중복투약 문구를 약물명이 보존된 작은 한 줄로 줄인다", () => {
  const text = compactGlp1WarningText(
    "🚨 GLP-1 계열 중복투약 — 🔵 마운자로 + 🔴 레타 둘 다 사용 중 체내 잔류량이 둘 다 0보다 큽니다",
  );
  assert.equal(text, "⚠️ GLP-1 병용 · 🔵마운자로+🔴레타 · 잔류 겹침");
  assert.equal(compactGlp1WarningText("다른 안내"), COMPACT_GLP1_WARNING_FALLBACK);
  assert.ok(!text.includes("\n"));
});

test("중복투약 경고를 약물 카드 전부 아래로 옮기고 빨간 배너 모양을 제거한다", () => {
  const classes = new Set();
  const banner = {
    parentElement: null,
    textContent: "GLP-1 계열 중복투약 — 🔵 마운자로 + 🔴 레타 둘 다 사용 중 잔류량 확인",
    dataset: {},
    classList: { add: (name) => classes.add(name) },
    setAttribute(name, value) { this[name] = value; },
  };
  const lastCard = { textContent: "레타 카드" };
  const root = {
    lastElementChild: lastCard,
    querySelectorAll: () => [banner],
    appendChild(element) { this.lastElementChild = element; },
  };
  banner.parentElement = root;

  assert.equal(compactExistingGlp1Warning(root), true);
  assert.equal(root.lastElementChild, banner);
  assert.equal(banner.textContent, "⚠️ GLP-1 병용 · 🔵마운자로+🔴레타 · 잔류 겹침");
  assert.ok(classes.has("glp1-compact-warning"));
  assert.equal(banner.role, "note");
  assert.match(banner["aria-label"], /체내 잔류량|잔류량 확인/);
});

test("축소 경고 스타일은 회색 9px 한 줄이며 빨간 배너 장식을 남기지 않는다", () => {
  assert.match(COMPACT_GLP1_WARNING_CSS, /order:\s*999/);
  assert.match(COMPACT_GLP1_WARNING_CSS, /font-size:\s*9px/);
  assert.match(COMPACT_GLP1_WARNING_CSS, /background:\s*transparent/);
  assert.match(COMPACT_GLP1_WARNING_CSS, /border:\s*0/);
  assert.match(COMPACT_GLP1_WARNING_CSS, /white-space:\s*nowrap/);
});

test("운영 index와 서비스워커가 듀얼 시뮬레이터 모듈을 실제로 연결한다", async () => {
  const [index, serviceWorker] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../sw.js", import.meta.url), "utf8"),
  ]);
  assert.match(index, /import \{ installDualExposureSimulator \} from '\.\/dual_exposure_sim\.js';/);
  assert.match(index, /id="dual-exposure-simulator"/);
  assert.match(index, /installDualExposureSimulator\(\{/);
  assert.match(serviceWorker, /peptide-app-v25/);
  assert.match(serviceWorker, /'\.\/dual_exposure_sim\.js'/);
});
