import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
