import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DUAL_EXPOSURE_NOTICE,
  buildWeeklyRegimen,
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

test("운영 index와 서비스워커가 듀얼 시뮬레이터 모듈을 실제로 연결한다", async () => {
  const [index, serviceWorker] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../sw.js", import.meta.url), "utf8"),
  ]);
  assert.match(index, /import \{ installDualExposureSimulator \} from '\.\/dual_exposure_sim\.js';/);
  assert.match(index, /id="dual-exposure-simulator"/);
  assert.match(index, /installDualExposureSimulator\(\{/);
  assert.match(serviceWorker, /peptide-app-v23/);
  assert.match(serviceWorker, /'\.\/dual_exposure_sim\.js'/);
});
