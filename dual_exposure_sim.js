export const WEEKDAYS_KO = Object.freeze(["월", "화", "수", "목", "금", "토", "일"]);

export const DUAL_EXPOSURE_NOTICE =
  "두 곡선은 반감기 기반 잔류량 추정치입니다. 합산 노출지수는 서로 다른 약의 기준량 대비 비율을 더한 표시일 뿐, "
  + "동등용량·효과·안전성·병용 허용을 뜻하지 않습니다. 레타트루타이드는 임상시험 약이며 "
  + "레타트루타이드와 티르제파타이드 병용 안전성은 확립되지 않았습니다.";

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function clampWeekday(value) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? Math.max(0, Math.min(6, number)) : 0;
}

function residualAt(day, events, halfLifeDays) {
  let total = 0;
  for (const event of events) {
    if (event.day > day) break;
    total += event.doseMg * (0.5 ** ((day - event.day) / halfLifeDays));
  }
  return total;
}

export function buildWeeklyRegimen({ doseMg, halfLifeDays, weekday, weeks }) {
  const dose = finitePositive(doseMg);
  const halfLife = finitePositive(halfLifeDays);
  const durationWeeks = Math.max(1, Math.trunc(finitePositive(weeks) || 8));
  if (!dose || !halfLife) return [];
  const firstDay = clampWeekday(weekday);
  const events = [];
  for (let day = firstDay; day < durationWeeks * 7; day += 7) {
    events.push({ day, doseMg: dose });
  }
  return events;
}

function curveStats(points, key, firstDoseDay) {
  const values = points
    .filter((point) => point.day >= firstDoseDay)
    .map((point) => finitePositive(point[key]));
  if (!values.length) return { cmaxMg: 0, cavgMg: 0, cminMg: 0 };
  return {
    cmaxMg: Math.max(...values),
    cavgMg: values.reduce((sum, value) => sum + value, 0) / values.length,
    cminMg: Math.min(...values),
  };
}

export function simulateDualExposure({ primary, secondary, weeks = 8, stepHours = 6 }) {
  const durationWeeks = Math.max(1, Math.trunc(finitePositive(weeks) || 8));
  const stepDays = Math.max(1, finitePositive(stepHours) || 6) / 24;
  const aEvents = buildWeeklyRegimen({ ...primary, weeks: durationWeeks });
  const bEvents = buildWeeklyRegimen({ ...secondary, weeks: durationWeeks });
  const aHalfLife = finitePositive(primary?.halfLifeDays);
  const bHalfLife = finitePositive(secondary?.halfLifeDays);
  const aReference = finitePositive(primary?.referenceMg);
  const bReference = finitePositive(secondary?.referenceMg);
  if (!aEvents.length || !bEvents.length || !aReference || !bReference) {
    return { points: [], primaryEvents: aEvents, secondaryEvents: bEvents, axisMaxPercent: 100 };
  }

  const points = [];
  const totalDays = durationWeeks * 7;
  for (let day = 0; day <= totalDays + 1e-9; day += stepDays) {
    const primaryMg = residualAt(day, aEvents, aHalfLife);
    const secondaryMg = residualAt(day, bEvents, bHalfLife);
    const primaryPercent = (primaryMg / aReference) * 100;
    const secondaryPercent = (secondaryMg / bReference) * 100;
    points.push({
      day: Math.round(day * 1_000_000) / 1_000_000,
      primaryMg,
      secondaryMg,
      primaryPercent,
      secondaryPercent,
      combinedIndexPercent: primaryPercent + secondaryPercent,
    });
  }
  const peak = Math.max(100, ...points.map((point) => point.combinedIndexPercent));
  const axisMaxPercent = Math.max(100, Math.ceil((peak * 1.05) / 25) * 25);
  return {
    points,
    primaryEvents: aEvents,
    secondaryEvents: bEvents,
    axisMaxPercent,
    primaryStats: curveStats(points, "primaryMg", aEvents[0].day),
    secondaryStats: curveStats(points, "secondaryMg", bEvents[0].day),
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function configHalfLife(config, fallback) {
  return finitePositive(config?.halfLifeDays ?? config?.halfLife ?? config?.halfLifeDay) || fallback;
}

function configReference(config) {
  return finitePositive(config?.doseReferenceMg ?? config?.clinicalMax);
}

function latestDose(records, drug) {
  let latest = null;
  for (const record of records || []) {
    if (record?.drug !== drug || record?.isOverride || !finitePositive(record?.dose)) continue;
    if (!latest || Number(record.time) > Number(latest.time)) latest = record;
  }
  return latest ? Number(latest.dose) : 0;
}

function formatMg(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toFixed(number >= 10 ? 1 : 2).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
}

function drawGraph(canvas, simulation, colors) {
  if (!canvas || !simulation.points.length) return;
  const cssWidth = Math.max(300, Math.round(canvas.getBoundingClientRect().width || 640));
  const cssHeight = 260;
  const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const light = document.body.classList.contains("light-mode");
  ctx.fillStyle = light ? "#f8fafc" : "#080810";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const pad = { left: 40, right: 12, top: 18, bottom: 28 };
  const width = cssWidth - pad.left - pad.right;
  const height = cssHeight - pad.top - pad.bottom;
  const maxDay = simulation.points.at(-1)?.day || 1;
  const axis = simulation.axisMaxPercent || 100;
  const x = (day) => pad.left + (day / maxDay) * width;
  const y = (percent) => pad.top + height - (percent / axis) * height;

  ctx.font = "10px 'Noto Sans KR', sans-serif";
  ctx.textAlign = "right";
  ctx.strokeStyle = light ? "#e2e8f0" : "#1f2937";
  ctx.fillStyle = light ? "#64748b" : "#6b7280";
  for (let index = 0; index <= 4; index += 1) {
    const percent = (axis / 4) * index;
    const yy = y(percent);
    ctx.beginPath();
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(pad.left + width, yy);
    ctx.stroke();
    ctx.fillText(`${Math.round(percent)}%`, pad.left - 4, yy + 3);
  }

  const drawEvents = (events, color) => {
    ctx.save();
    ctx.strokeStyle = `${color}55`;
    ctx.setLineDash([3, 3]);
    for (const event of events) {
      ctx.beginPath();
      ctx.moveTo(x(event.day), pad.top);
      ctx.lineTo(x(event.day), pad.top + height);
      ctx.stroke();
    }
    ctx.restore();
  };
  drawEvents(simulation.primaryEvents, colors.primary);
  drawEvents(simulation.secondaryEvents, colors.secondary);

  const drawCurve = (key, color, dashed = false, widthPx = 2) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = widthPx;
    ctx.setLineDash(dashed ? [7, 4] : []);
    ctx.beginPath();
    simulation.points.forEach((point, index) => {
      const xx = x(point.day);
      const yy = y(point[key]);
      if (index === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    });
    ctx.stroke();
    ctx.restore();
  };
  drawCurve("primaryPercent", colors.primary);
  drawCurve("secondaryPercent", colors.secondary);
  drawCurve("combinedIndexPercent", light ? "#0f172a" : "#f8fafc", true, 2.5);

  ctx.fillStyle = light ? "#64748b" : "#6b7280";
  ctx.textAlign = "center";
  const totalWeeks = Math.round(maxDay / 7);
  [0, Math.round(totalWeeks / 2), totalWeeks].forEach((week) => {
    ctx.fillText(`${week}주`, x(week * 7), cssHeight - 8);
  });
}

function statCard(label, color, stats) {
  return `<div style="padding:8px;background:#111827;border:1px solid #1f2937;border-radius:9px">`
    + `<div style="font-size:10px;color:${color};font-weight:700;margin-bottom:3px">${escapeHtml(label)}</div>`
    + `<div style="font-size:10px;color:#94a3b8">최고 ${formatMg(stats.cmaxMg)}mg · 평균 ${formatMg(stats.cavgMg)}mg · 최저 ${formatMg(stats.cminMg)}mg</div>`
    + "</div>";
}

export function installDualExposureSimulator({ document: doc = document, configs = {}, getRecords = () => [] } = {}) {
  const root = doc.getElementById("dual-exposure-simulator");
  if (!root) return { installed: false, reason: "container_missing" };
  const names = Object.keys(configs);
  const defaultPrimary = names.find((name) => name.includes("Retatrutide")) || names[0] || "";
  const defaultSecondary = names.find((name) => name.includes("Tirzepatide")) || names[1] || names[0] || "";
  const options = names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(configs[name]?.short || name)}</option>`).join("");
  root.innerHTML = `
    <div style="border-top:1px solid #1f2937;margin-top:14px;padding-top:12px">
      <div style="font-size:12px;font-weight:700;color:#fb7185;margin-bottom:4px">🔀 두 약 동시 노출 시뮬레이션</div>
      <div style="font-size:10px;color:#64748b;margin-bottom:9px">각 약의 요일·용량을 따로 설정해 개별 잔류곡선과 합산 노출지수를 함께 봅니다.</div>
      <div style="display:grid;grid-template-columns:1fr;gap:8px">
        <div style="padding:9px;border:1px solid #7f1d1d;border-radius:10px;background:#450a0a22">
          <div style="font-size:10px;color:#fb7185;font-weight:700;margin-bottom:6px">약 A</div>
          <div style="display:grid;grid-template-columns:1.35fr .8fr .8fr;gap:6px">
            <select id="dual-drug-a" class="input-field">${options}</select>
            <input id="dual-dose-a" class="input-field" type="number" min="0" step="any" placeholder="mg" aria-label="약 A 용량" />
            <select id="dual-day-a" class="input-field" aria-label="약 A 투약 요일">${WEEKDAYS_KO.map((day, index) => `<option value="${index}">${day}요일</option>`).join("")}</select>
          </div>
        </div>
        <div style="padding:9px;border:1px solid #1d4ed8;border-radius:10px;background:#17255444">
          <div style="font-size:10px;color:#60a5fa;font-weight:700;margin-bottom:6px">약 B</div>
          <div style="display:grid;grid-template-columns:1.35fr .8fr .8fr;gap:6px">
            <select id="dual-drug-b" class="input-field">${options}</select>
            <input id="dual-dose-b" class="input-field" type="number" min="0" step="any" placeholder="mg" aria-label="약 B 용량" />
            <select id="dual-day-b" class="input-field" aria-label="약 B 투약 요일">${WEEKDAYS_KO.map((day, index) => `<option value="${index}">${day}요일</option>`).join("")}</select>
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <span style="font-size:10px;color:#64748b">기간</span>
        <select id="dual-weeks" class="input-field" style="width:auto;min-width:90px"><option value="8">8주</option><option value="12">12주</option><option value="24">24주</option></select>
        <button id="dual-latest-dose" class="qbtn" type="button" style="flex:1">최근 실투여량 불러오기</button>
      </div>
      <div id="dual-error" style="display:none;margin-top:8px;font-size:10px;color:#fca5a5"></div>
      <div id="dual-stats" style="display:none;grid-template-columns:1fr;gap:5px;margin-top:8px"></div>
      <canvas id="dual-exposure-canvas" style="width:100%;display:block;border-radius:8px;background:#080810;margin-top:8px"></canvas>
      <div id="dual-legend" style="display:none;font-size:9px;color:#64748b;line-height:1.6;margin-top:5px"></div>
      <div style="font-size:9px;color:#fca5a5;line-height:1.55;margin-top:7px">⚠️ ${escapeHtml(DUAL_EXPOSURE_NOTICE)}</div>
    </div>`;

  const fields = {
    drugA: doc.getElementById("dual-drug-a"), doseA: doc.getElementById("dual-dose-a"), dayA: doc.getElementById("dual-day-a"),
    drugB: doc.getElementById("dual-drug-b"), doseB: doc.getElementById("dual-dose-b"), dayB: doc.getElementById("dual-day-b"),
    weeks: doc.getElementById("dual-weeks"), error: doc.getElementById("dual-error"), stats: doc.getElementById("dual-stats"),
    canvas: doc.getElementById("dual-exposure-canvas"), legend: doc.getElementById("dual-legend"), latest: doc.getElementById("dual-latest-dose"),
  };
  fields.drugA.value = defaultPrimary;
  fields.drugB.value = defaultSecondary;
  fields.dayA.value = "6";
  fields.dayB.value = "3";

  let lastSimulation = null;
  const prefillLatest = () => {
    const records = getRecords() || [];
    const aDose = latestDose(records, fields.drugA.value);
    const bDose = latestDose(records, fields.drugB.value);
    if (aDose) fields.doseA.value = String(aDose);
    if (bDose) fields.doseB.value = String(bDose);
  };
  const run = () => {
    const aCfg = configs[fields.drugA.value] || {};
    const bCfg = configs[fields.drugB.value] || {};
    if (fields.drugA.value === fields.drugB.value) {
      fields.error.textContent = "서로 다른 두 약을 선택해주세요.";
      fields.error.style.display = "block";
      fields.stats.style.display = "none";
      fields.legend.style.display = "none";
      fields.canvas.style.display = "none";
      return;
    }
    const primary = {
      doseMg: fields.doseA.value,
      halfLifeDays: configHalfLife(aCfg, fields.drugA.value.includes("Retatrutide") ? 6 : 5),
      referenceMg: configReference(aCfg),
      weekday: fields.dayA.value,
    };
    const secondary = {
      doseMg: fields.doseB.value,
      halfLifeDays: configHalfLife(bCfg, fields.drugB.value.includes("Retatrutide") ? 6 : 5),
      referenceMg: configReference(bCfg),
      weekday: fields.dayB.value,
    };
    lastSimulation = simulateDualExposure({ primary, secondary, weeks: fields.weeks.value });
    if (!lastSimulation.points.length) {
      fields.error.textContent = "두 약의 1회 용량을 모두 입력해주세요.";
      fields.error.style.display = "block";
      fields.stats.style.display = "none";
      fields.legend.style.display = "none";
      fields.canvas.style.display = "none";
      return;
    }
    fields.error.style.display = "none";
    fields.canvas.style.display = "block";
    fields.stats.style.display = "grid";
    fields.stats.innerHTML = statCard(aCfg.short || fields.drugA.value, aCfg.color || "#fb7185", lastSimulation.primaryStats)
      + statCard(bCfg.short || fields.drugB.value, bCfg.color || "#60a5fa", lastSimulation.secondaryStats);
    fields.legend.style.display = "block";
    fields.legend.innerHTML = `<span style="color:${escapeHtml(aCfg.color || "#fb7185")}">━ ${escapeHtml(aCfg.short || fields.drugA.value)} 잔류/자체기준</span> · `
      + `<span style="color:${escapeHtml(bCfg.color || "#60a5fa")}">━ ${escapeHtml(bCfg.short || fields.drugB.value)} 잔류/자체기준</span> · `
      + `<span style="color:#e2e8f0">┈ 합산 노출지수</span> · Y축 ${lastSimulation.axisMaxPercent}%`;
    drawGraph(fields.canvas, lastSimulation, {
      primary: aCfg.color || "#fb7185",
      secondary: bCfg.color || "#60a5fa",
    });
  };

  [fields.drugA, fields.doseA, fields.dayA, fields.drugB, fields.doseB, fields.dayB, fields.weeks]
    .forEach((field) => field.addEventListener("input", run));
  fields.latest.addEventListener("click", () => { prefillLatest(); run(); });
  root.addEventListener("focusin", () => {
    if (!fields.doseA.value || !fields.doseB.value) prefillLatest();
  }, { once: true });
  window.addEventListener("resize", () => { if (lastSimulation?.points?.length) run(); });
  window.runDualExposureSimulation = run;
  doc.documentElement.dataset.dualExposureSimulator = "reta-tirzepatide-v1";
  prefillLatest();
  run();
  return { installed: true, run, prefillLatest };
}
