import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { compareDoseTiming } from "../schedule_comparison_model.js";

// 공개 회귀검사용 가상 날짜·용량이며 실제 사용자 투약기록이 아닙니다.
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`${name} 함수를 index.html에서 찾지 못했습니다.`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

async function loadProductionPk() {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const rotateStart = html.indexOf("const a0_0x4109b5");
  const rotateEnd = html.indexOf("const a0_0x1a5c3c", rotateStart);
  assert.ok(rotateStart >= 0 && rotateEnd > rotateStart, "운영 decoder 초기화 구간이 있어야 함");
  const source = [
    extractFunction(html, "a0_0x74b6"),
    extractFunction(html, "a0_0x5584"),
    html.slice(rotateStart, rotateEnd),
    extractFunction(html, "computeKa"),
    extractFunction(html, "pkConcentration"),
    "globalThis.__productionPk = { computeKa, pkConcentration };",
  ].join("\n");
  const context = vm.createContext({ Math });
  new vm.Script(source, { filename: "index-production-pk.vm.js" })
    .runInContext(context, { timeout: 1_000 });
  return context.__productionPk;
}

test("운영 index PK를 주입해 목요일 5mg을 토요일로 이동 계산한다", async () => {
  const { computeKa, pkConcentration } = await loadProductionPk();
  assert.equal(typeof computeKa, "function");
  assert.equal(typeof pkConcentration, "function");

  const thursday = Date.UTC(2030, 0, 3, 12);
  const saturday = thursday + 2 * DAY;
  const previousThursday = thursday - 7 * DAY;
  const config = { halfLifeDays: 5, tmaxHours: 8 };
  const records = [{ drug: "마운자로", dose: 5, time: previousThursday }];
  const before = JSON.stringify(records);
  const injected = [];
  const contribution = (dose, elapsedHours, cfg, isOverride) => {
    assert.equal(isOverride, false);
    const value = pkConcentration(dose, elapsedHours, cfg);
    injected.push({ dose, elapsedHours, value });
    return value;
  };

  const result = compareDoseTiming({
    records, drug: "마운자로", config, doseMg: 5,
    plannedTime: thursday, changedTime: saturday,
    intervalDays: 7, nextMode: "original", now: thursday - HOUR,
    horizonDays: 14, contribution,
  });

  assert.equal(JSON.stringify(records), before, "실제 기록은 변경하지 않아야 함");
  assert.equal(result.delayHours, 48);
  assert.equal(result.changedNextTime, thursday + 7 * DAY);
  assert.ok(result.points.length > 100);
  assert.ok(injected.length > 0, "비교 모델이 운영 PK 함수를 실제 호출해야 함");

  assert.equal(pkConcentration(5, 0, config), 0, "흡수 직후 모델값은 0");
  assert.ok(Math.abs(pkConcentration(5, 8, config) - 5) < 1e-10,
    "운영 peak-normalized PK는 Tmax 8시간에 단일 5mg 피크");

  const atBaselinePeak = result.points.find((point) => point.time === thursday + 8 * HOUR);
  assert.ok(atBaselinePeak, "원 일정 Tmax 시점이 points에 있어야 함");
  const expectedHistory = pkConcentration(5, (atBaselinePeak.time - previousThursday) / HOUR, config);
  const expectedNewDose = pkConcentration(5, 8, config);
  assert.ok(Math.abs(atBaselinePeak.baselineMg - (expectedHistory + expectedNewDose)) < 1e-10,
    "실제 기록 기여와 새 일정 기여를 운영 main PK와 같은 연산으로 합산");
  assert.ok(Math.abs(atBaselinePeak.changedMg - expectedHistory) < 1e-10,
    "변경안 투약 전에는 동일한 실제 기록 기여만 존재");

  const atChangedPeak = result.points.find((point) => point.time === saturday + 8 * HOUR);
  assert.ok(atChangedPeak);
  const expectedChanged = pkConcentration(5, (atChangedPeak.time - previousThursday) / HOUR, config)
    + pkConcentration(5, 8, config);
  assert.ok(Math.abs(atChangedPeak.changedMg - expectedChanged) < 1e-10,
    "변경안도 운영 pkConcentration 호출값과 동일");
});
