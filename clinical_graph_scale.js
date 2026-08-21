const REFERENCE_KIND_LABELS = Object.freeze({
  approved_max: "허가 라벨 최대 1회 용량",
  approved_maintenance: "허가 라벨 유지 1회 용량",
  trial_dose: "임상시험 1회 비교 용량",
  formulation_label: "제형별 라벨 1회 용량",
  app_display: "앱 표시용 1회 기준량",
});

// 그래프의 분모를 전부 "임상 최대"라고 부르던 오류를 막는 전수 감사표다.
// 수치 자체는 기존 투약기록/그래프 호환을 위해 유지하되, 그 수치의 성격을
// 명시적으로 분리한다. app_display는 안전상한·권장량·허가용량을 뜻하지 않는다.
export const DOSE_REFERENCE_AUDIT = Object.freeze({
  "마운자로 (Tirzepatide)": Object.freeze({
    doseReferenceMg: 15,
    referenceKind: "approved_max",
    source: "FDA Zepbound label 217806",
  }),
  "레타 (Retatrutide)": Object.freeze({
    doseReferenceMg: 12,
    referenceKind: "trial_dose",
    source: "NEJM 2023 phase 2, NCT04881760",
  }),
  "위고비 (Semaglutide)": Object.freeze({
    doseReferenceMg: 2.4,
    referenceKind: "approved_maintenance",
    source: "FDA Wegovy label 215256",
  }),
  "KLOW (GHK-Cu+TB500+BPC157+KPV)": Object.freeze({
    doseReferenceMg: 3.2,
    referenceKind: "app_display",
  }),
  "카그릴린타이드 (Cagrilintide)": Object.freeze({
    doseReferenceMg: 2.4,
    referenceKind: "trial_dose",
    source: "CagriSema phase 2/3 target dose",
  }),
  "에피탈론 (Epithalon)": Object.freeze({
    doseReferenceMg: 20,
    referenceKind: "app_display",
  }),
  "티모신알파1 (Thymosin α1)": Object.freeze({
    doseReferenceMg: 3.2,
    referenceKind: "app_display",
  }),
  "GHK-Cu (구리펩타이드)": Object.freeze({
    doseReferenceMg: 5,
    referenceKind: "app_display",
  }),
  "세맥스 (Semax)": Object.freeze({
    doseReferenceMg: 3,
    referenceKind: "app_display",
  }),
  "셀랑크 (Selank)": Object.freeze({
    doseReferenceMg: 1.5,
    referenceKind: "app_display",
  }),
  "CJC-1295+Ipamorelin": Object.freeze({
    doseReferenceMg: 0.3,
    referenceKind: "app_display",
  }),
  "테사모렐린 (Tesamorelin)": Object.freeze({
    doseReferenceMg: 2,
    referenceKind: "formulation_label",
    source: "FDA Egrifta original formulation label; formulation-specific",
  }),
  "SS-31 (Elamipretide)": Object.freeze({
    doseReferenceMg: 1,
    referenceKind: "app_display",
  }),
  "MOTS-c": Object.freeze({
    doseReferenceMg: 15,
    referenceKind: "app_display",
  }),
  "NAD+": Object.freeze({
    doseReferenceMg: 1000,
    referenceKind: "app_display",
  }),
});

export function referenceKindLabel(kind) {
  return REFERENCE_KIND_LABELS[kind] || REFERENCE_KIND_LABELS.app_display;
}

export function applyDoseReferenceAudit(configs) {
  const names = Object.keys(configs || {});
  const missing = names.filter((name) => !DOSE_REFERENCE_AUDIT[name]);
  const stale = Object.keys(DOSE_REFERENCE_AUDIT).filter((name) => !configs?.[name]);
  if (missing.length || stale.length) {
    throw new Error(
      `약물 기준량 감사표 불일치: missing=${missing.join(",") || "0"}; stale=${stale.join(",") || "0"}`,
    );
  }

  for (const [name, cfg] of Object.entries(configs)) {
    const audit = DOSE_REFERENCE_AUDIT[name];
    if (Number(cfg.clinicalMax) !== audit.doseReferenceMg) {
      throw new Error(
        `${name} 기준량 불일치: config=${cfg.clinicalMax}, audit=${audit.doseReferenceMg}`,
      );
    }
    cfg.doseReferenceMg = audit.doseReferenceMg;
    cfg.doseReferenceKind = audit.referenceKind;
    cfg.doseReferenceLabel = referenceKindLabel(audit.referenceKind);
    cfg.doseReferenceSource = audit.source || "앱 내부 비교 기준";
  }
  return configs;
}

export function residualPercent(valueMg, referenceMg) {
  const value = Number(valueMg);
  const reference = Number(referenceMg);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(reference) || reference <= 0) return 0;
  return (value / reference) * 100;
}

export function axisMaxPercentFromCurves(curves, { minimum = 100, step = 25 } = {}) {
  let peakPercent = 0;
  for (const curve of curves || []) {
    const reference = Number(
      curve?.cfg?.doseReferenceMg ?? curve?.cfg?.clinicalMax ?? 0,
    );
    for (const point of curve?.points || []) {
      peakPercent = Math.max(peakPercent, residualPercent(point?.val, reference));
    }
  }
  if (peakPercent <= minimum) return minimum;
  return Math.max(minimum, Math.ceil((peakPercent * 1.05) / step) * step);
}

export function plotRatio(valueMg, referenceMg, axisMaxPercent) {
  const ceiling = Number(axisMaxPercent);
  if (!Number.isFinite(ceiling) || ceiling <= 0) return 0;
  return residualPercent(valueMg, referenceMg) / ceiling;
}

export function axisTickPercent(index, divisions, axisMaxPercent) {
  const i = Number(index);
  const count = Number(divisions);
  const ceiling = Number(axisMaxPercent);
  if (![i, count, ceiling].every(Number.isFinite) || count <= 0 || ceiling < 0) return 0;
  return Math.round((i / count) * ceiling * 10) / 10;
}

export function formatResidualPercent(valueMg, referenceMg) {
  return residualPercent(valueMg, referenceMg).toFixed(1);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function latestDose(records, drug) {
  let latest = null;
  for (const record of records || []) {
    if (record?.drug !== drug || record?.isOverride) continue;
    if (!latest || Number(record.time) > Number(latest.time)) latest = record;
  }
  return latest && Number.isFinite(Number(latest.dose)) ? Number(latest.dose) : null;
}

export function updateGraphLegendHint({ document, configs, records, filter }) {
  const hint = document?.getElementById?.("graph-legend-hint");
  if (!hint) return;

  const activeNames = Object.keys(configs || {}).filter((name) => {
    const cfg = configs[name];
    if (filter && filter !== "전체" && cfg.short !== filter) return false;
    return (records || []).some((record) => record?.drug === name);
  });
  if (activeNames.length <= 1) {
    hint.style.display = "none";
    return;
  }

  const isLight = document.body?.classList?.contains?.("light-mode");
  const background = isLight ? "#f1f5f9" : "#0f172a";
  const border = isLight ? "#e2e8f0" : "#1e293b";
  const color = isLight ? "#475569" : "#94a3b8";
  const heading = isLight ? "#1e293b" : "#e2e8f0";
  hint.style.cssText = `display:block;margin-top:8px;padding:8px 12px;background:${background};border:1px solid ${border};border-radius:10px;font-size:11px;color:${color};line-height:1.7`;

  const rows = activeNames.map((name) => {
    const cfg = configs[name];
    const reference = Number(cfg.doseReferenceMg ?? cfg.clinicalMax);
    const dose = latestDose(records, name);
    const latest = dose == null
      ? "최근 실투여 없음"
      : `최근 실투여 ${dose}mg = 기준의 ${formatResidualPercent(dose, reference)}%`;
    return `<span style="color:${escapeHtml(cfg.color)};font-weight:700">${escapeHtml(cfg.short)}</span> `
      + `${escapeHtml(reference)}mg (${escapeHtml(cfg.doseReferenceLabel)}) · ${escapeHtml(latest)}`;
  });

  hint.innerHTML = `<span style="color:${heading};font-weight:700">% 그래프:</span> `
    + "누적 체내 잔류 추정량 ÷ 1회 용량 기준. 반복투여 누적으로 100%를 넘을 수 있으며, "
    + "100%는 안전상한·권장량·승인 최대를 뜻하지 않습니다.<br>"
    + `<span style="font-size:10px">${rows.join("<br>")}</span>`;
}
