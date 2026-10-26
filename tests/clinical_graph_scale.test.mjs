import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import * as scale from "../clinical_graph_scale.js";
import { patchClinicalGraphSource } from "../clinical_graph_patch.js";

function extractFunction(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} 함수가 운영 bundle에 있어야 합니다.`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${functionName} 함수 끝을 찾지 못했습니다.`);
}

test("레타 누적 잔류량은 12mg 1회 기준의 100%를 넘어도 절단하지 않는다", () => {
  assert.equal(scale.formatResidualPercent(13.13, 12), "109.4");
  assert.equal(scale.formatResidualPercent(26.27, 12), "218.9");
  assert.equal(scale.axisMaxPercentFromCurves([
    { cfg: { clinicalMax: 12 }, points: [{ val: 13.13 }] },
  ]), 125);
  assert.equal(scale.axisMaxPercentFromCurves([
    { cfg: { clinicalMax: 12 }, points: [{ val: 26.27 }] },
  ]), 250);
  assert.equal(scale.plotRatio(26.27, 12, 250).toFixed(4), "0.8757");
});

test("1회 실제 투여량 비율과 누적 잔류 비율은 서로 다른 값으로 유지된다", () => {
  assert.equal(scale.formatResidualPercent(6, 12), "50.0");
  assert.equal(scale.formatResidualPercent(13.13, 12), "109.4");
});

test("15개 약물 기준량은 모두 감사표에 있고 임상최대로 뭉뚱그리지 않는다", () => {
  assert.equal(Object.keys(scale.DOSE_REFERENCE_AUDIT).length, 15);
  const kinds = Object.values(scale.DOSE_REFERENCE_AUDIT).map((entry) => entry.referenceKind);
  assert.ok(kinds.includes("approved_max"));
  assert.ok(kinds.includes("trial_dose"));
  assert.ok(kinds.includes("app_display"));
  assert.equal(scale.DOSE_REFERENCE_AUDIT["레타 (Retatrutide)"].referenceKind, "trial_dose");
  assert.equal(scale.DOSE_REFERENCE_AUDIT["KLOW (GHK-Cu+TB500+BPC157+KPV)"].referenceKind, "app_display");
});

test("운영 난독화 bundle의 그래프 함수에 동적축과 원시 % 패치가 정확히 적용된다", async () => {
  const indexUrl = new URL("../index.html", import.meta.url);
  const html = await readFile(indexUrl, "utf8");
  const original = extractFunction(html, "renderPeptideGraph");
  const patched = patchClinicalGraphSource(original);

  assert.match(patched, /clinicalGraphScale\.axisMaxPercentFromCurves/);
  assert.match(patched, /clinicalGraphScale\.axisTickPercent/);
  assert.equal((patched.match(/clinicalGraphScale\.formatResidualPercent/g) || []).length, 2);
  assert.doesNotMatch(patched, /return\s+Math\[[^\]]+\]\(0x1,[^;]+\);/);
  assert.doesNotThrow(() => new Function("clinicalGraphScale", `return (${patched});`));
  const compiled = vm.runInNewContext(`(${patched})`, { clinicalGraphScale: scale });
  assert.equal(typeof compiled, "function");
  assert.match(patched, /singleAxisMaxMgFromCurves/);
  assert.match(patched, /singlePlotRatio/);
  assert.match(patched, /formatMass/);
  assert.match(patched, /prepareDisplayCurves\([^;]+appData\.records/);
});

test("안내문은 100%가 안전상한이 아니며 실제 1회량을 별도로 표시한다", () => {
  const hint = { style: {}, innerHTML: "" };
  const fakeDocument = {
    body: { classList: { contains: () => false } },
    getElementById: (id) => id === "graph-legend-hint" ? hint : null,
  };
  const configs = {
    "레타 (Retatrutide)": {
      short: "레타", color: "#f87171", clinicalMax: 12,
      doseReferenceMg: 12, doseReferenceLabel: "임상시험 1회 비교 용량",
    },
    "위고비 (Semaglutide)": {
      short: "위고비", color: "#4ade80", clinicalMax: 2.4,
      doseReferenceMg: 2.4, doseReferenceLabel: "허가 라벨 유지 1회 용량",
    },
  };
  scale.updateGraphLegendHint({
    document: fakeDocument,
    configs,
    records: [
      { drug: "레타 (Retatrutide)", dose: 6, time: 2 },
      { drug: "위고비 (Semaglutide)", dose: 2.4, time: 1 },
    ],
    filter: "전체",
  });
  assert.match(hint.innerHTML, /100%를 넘을 수 있으며/);
  assert.match(hint.innerHTML, /안전상한·권장량·승인 최대를 뜻하지 않습니다/);
  assert.match(hint.innerHTML, /최근 실투여 6mg = 기준의 50\.0%/);
});


test("단일 저용량 곡선은 실제 peak로 확대하고 축·툴팁 단위를 함께 µg로 표시한다", () => {
  const cases = [
    [0.05, 0.1, "50µg"],
    [0.1, 0.2, "100µg"],
    [0.2, 0.25, "200µg"],
    [0.5, 1, "500µg"],
    [20, 25, "20mg"],
  ];
  for (const [peak, expectedMax, expectedLabel] of cases) {
    const axisMax = scale.singleAxisMaxMgFromCurves([{ points: [{ val: peak }] }]);
    assert.equal(axisMax, expectedMax);
    assert.equal(scale.singlePlotRatio(peak, axisMax), peak / expectedMax);
    assert.equal(scale.formatMass(peak, axisMax), expectedLabel);
    assert.equal(scale.formatMass(scale.axisTickMg(4, 4, axisMax), axisMax), scale.formatMass(axisMax, axisMax));
  }
  const withHistoricalHighPeak = scale.singleAxisMaxMgFromCurves([{
    points: [{ val: 20 }, { val: 0.5 }, { val: 0.2 }, { val: 0.1 }, { val: 0.05 }],
  }]);
  assert.equal(withHistoricalHighPeak, 25);
  assert.equal(scale.formatMass(20, withHistoricalHighPeak), "20mg");
  assert.equal(scale.formatMass(0.0625, 0.25), "62.5µg");
  assert.equal(scale.formatMass(0.2), "200µg");
});

test("다약제 app_display 기준은 최근 실제 과거 투여만 쓰고 임상·허가 기준은 보존한다", () => {
  const now = 1000;
  const records = [
    { drug: "KLOW", dose: 0.2, time: 800 },
    { drug: "KLOW", dose: 20, time: 900, isOverride: true },
    { drug: "KLOW", dose: 9, time: 1100 },
    { drug: "KLOW", dose: 0.5, time: 950 },
  ];
  assert.equal(scale.latestActualDose(records, "KLOW", now), 0.5);
  assert.equal(scale.resolveDoseReferenceMg({ doseReferenceMg: 3.2, doseReferenceKind: "app_display" }, records, "KLOW", now), 0.5);
  assert.equal(scale.resolveDoseReferenceMg({ doseReferenceMg: 12, doseReferenceKind: "trial_dose" }, records, "레타", now), 12);
  assert.equal(scale.resolveDoseReferenceMg({ doseReferenceMg: 15, doseReferenceKind: "approved_max" }, records, "마운자로", now), 15);
  assert.equal(scale.formatResidualPercent(6, 12), "50.0");
  assert.equal(scale.formatResidualPercent(7.5, 15), "50.0");
});

test("다약제 표시 복사본은 최근 200µg를 사용하고 원본 설정·기록·곡선 값은 보존한다", () => {
  const cfg = { clinicalMax: 20, doseReferenceMg: 20, doseReferenceKind: "app_display", short: "에피탈론" };
  const fixed = { clinicalMax: 12, doseReferenceMg: 12, doseReferenceKind: "trial_dose", short: "레타" };
  const records = [{ drug: "에피탈론", dose: 0.2, time: 100 }];
  const curves = [
    { drug: "에피탈론", cfg, points: [{ val: 0.15 }] },
    { drug: "레타", cfg: fixed, points: [{ val: 6 }] },
  ];
  const saved = structuredClone(records);
  scale.prepareDisplayCurves(curves, records, 1000);
  assert.equal(curves[0].cfg.clinicalMax, 0.2);
  assert.ok(Math.abs(scale.residualPercent(curves[0].points[0].val, curves[0].cfg.clinicalMax) - 75) < 1e-10);
  assert.equal(curves[1].cfg.clinicalMax, 12);
  assert.equal(cfg.clinicalMax, 20);
  assert.deepEqual(records, saved);
  assert.equal(curves[0].points[0].val, 0.15);
  const hint = { style: {}, innerHTML: "" };
  scale.updateGraphLegendHint({
    document: { getElementById: () => hint, body: { classList: { contains: () => false } } },
    configs: { 에피탈론: cfg, 레타: fixed },
    records: [...records, { drug: "레타", dose: 4, time: 100 }],
    filter: "전체",
  });
  assert.match(hint.innerHTML, /200µg \(최근 실투여 1회량을 표시 기준으로 사용\)/);
  assert.match(hint.innerHTML, /최근 실투여 200µg = 기준의 100\.0%/);
  assert.doesNotMatch(hint.innerHTML, /20mg/);
});
