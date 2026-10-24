import { compareDoseTiming } from './schedule_comparison_model.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KST = 9 * HOUR;
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const FDA_URL = 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/215866s044s045lbl.pdf';
const RETA_URL = 'https://www.lilly.com/news/stories/what-to-know-about-retatrutide';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g,
  (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const mg = (value) => Number.isFinite(value) ? value.toFixed(2) : '—';

export function formatKstInput(time) {
  return new Date(time + KST).toISOString().slice(0, 16);
}

export function parseKstInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) return NaN;
  const time = Date.parse(`${value}:00+09:00`);
  return Number.isFinite(time) && formatKstInput(time) === value ? time : NaN;
}

export function defaultScheduleFields(records, drug, intervalDays, now) {
  const latest = (records || []).filter((record) => record?.drug === drug
    && !record.isOverride && Number(record.dose) > 0 && Number.isFinite(Number(record.time))
    && Number(record.time) > 0 && Number(record.time) <= now)
    .sort((a, b) => Number(b.time) - Number(a.time))[0];
  const weekday = drug.includes('Tirzepatide') ? 4 : 0;
  const interval = Number(intervalDays) > 0 ? Number(intervalDays) : 7;
  if (!latest) return { dose: '', planned: '', changed: '', interval, weekday };
  let planned = Number(latest.time) + interval * DAY;
  if (interval === 7) {
    const local = new Date(Number(latest.time) + KST);
    const days = ((weekday - local.getUTCDay() + 7) % 7) || 7;
    planned = Number(latest.time) + days * DAY;
  }
  return {
    dose: String(latest.dose), interval, weekday,
    planned: formatKstInput(planned), changed: formatKstInput(Math.max(planned, now)),
  };
}

function formatTime(time) {
  const input = formatKstInput(time);
  return `${input.slice(5, 10).replace('-', '/')}(${DAYS[new Date(time + KST).getUTCDay()]}) ${input.slice(11)}`;
}

function duration(hours) {
  return `${(hours / 24).toFixed(2).replace(/\.00$/, '')}일`;
}

function drawComparison(canvas, result, doc, targetWindow) {
  const width = Math.max(260, Math.round(canvas.getBoundingClientRect().width || 600));
  const height = 215;
  const ratio = Math.max(1, Math.min(3, targetWindow.devicePixelRatio || 1));
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const light = doc.body.classList.contains('light-mode');
  const muted = light ? '#475569' : '#94a3b8';
  ctx.fillStyle = light ? '#f8fafc' : '#080810';
  ctx.fillRect(0, 0, width, height);
  const pad = { l: 39, r: 12, t: 20, b: 36 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const first = result.points[0].time;
  const last = result.points.at(-1).time;
  const max = Math.max(1, result.peak.baselineMg, result.peak.changedMg) * 1.12;
  const x = (time) => pad.l + (time - first) / (last - first) * plotW;
  const y = (value) => pad.t + plotH * (1 - value / max);
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const value = max * i / 4;
    ctx.strokeStyle = light ? '#e2e8f0' : '#1e293b';
    ctx.beginPath(); ctx.moveTo(pad.l, y(value)); ctx.lineTo(width - pad.r, y(value)); ctx.stroke();
    ctx.fillStyle = muted; ctx.fillText(value.toFixed(1), pad.l - 5, y(value) + 3);
  }
  ctx.textAlign = 'left'; ctx.fillText('모델 mg', pad.l, 12);
  for (let i = 0; i <= 3; i++) {
    const time = first + (last - first) * i / 3;
    ctx.textAlign = i === 0 ? 'left' : i === 3 ? 'right' : 'center';
    ctx.fillText(formatKstInput(time).slice(5, 10).replace('-', '/'), x(time), height - 16);
  }
  for (const [key, color, dash] of [
    ['baselineMg', light ? '#64748b' : '#cbd5e1', [5, 4]],
    ['changedMg', light ? '#2563eb' : '#60a5fa', []],
  ]) {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash); ctx.beginPath();
    result.points.forEach((point, index) => index ? ctx.lineTo(x(point.time), y(point[key]))
      : ctx.moveTo(x(point.time), y(point[key])));
    ctx.stroke();
  }
  ctx.setLineDash([2, 3]); ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x(result.changedTime), pad.t); ctx.lineTo(x(result.changedTime), height - pad.b); ctx.stroke();
  ctx.setLineDash([]); ctx.fillStyle = light ? '#92400e' : '#fbbf24'; ctx.textAlign = 'center';
  ctx.fillText('변경 시각', Math.max(68, Math.min(width - 36, x(result.changedTime))), height - 3);
}

export function installScheduleComparison({ document: doc = document, targetWindow = window,
  configs, getRecords, getDoseCycle = () => 7, contribution, now = () => Date.now() }) {
  const anchor = doc.getElementById('remaining-cards');
  if (!anchor || doc.getElementById('schedule-comparison')) return { installed: false };
  const drugs = Object.keys(configs || {}).filter((name) => /Tirzepatide|Retatrutide/.test(name))
    .sort((a) => a.includes('Tirzepatide') ? -1 : 1);
  if (!drugs.length || typeof contribution !== 'function') return { installed: false };
  const style = doc.createElement('style');
  style.textContent = `
    #schedule-comparison { color:#e2e8f0; margin:10px 0 14px; }
    #schedule-comparison .sc-muted { color:#94a3b8; font-size:11px; line-height:1.65; }
    #schedule-comparison .sc-fields { display:grid; grid-template-columns:1fr 1fr; gap:9px; margin:10px 0; }
    #schedule-comparison label { display:block; font-size:11px; color:#cbd5e1; min-width:0; }
    #schedule-comparison .input-field { width:100%; min-width:0; margin-top:4px; font-size:12px; }
    #schedule-comparison .sc-wide { grid-column:1/-1; }
    #schedule-comparison button { white-space:normal; }
    #schedule-comparison table { width:100%; border-collapse:collapse; font-size:11px; margin-top:9px; }
    #schedule-comparison th, #schedule-comparison td { padding:7px 3px; border-bottom:1px solid #334155; text-align:right; }
    #schedule-comparison th:first-child, #schedule-comparison td:first-child { text-align:left; }
    #schedule-comparison .sc-notice { background:#78350f22; color:#fcd34d; padding:9px; border-radius:8px; font-size:11px; line-height:1.65; }
    #schedule-comparison a { color:#93c5fd; }
    body.light-mode #schedule-comparison { color:#0f172a; }
    body.light-mode #schedule-comparison .sc-muted, body.light-mode #schedule-comparison label { color:#475569; }
    body.light-mode #schedule-comparison .sc-notice { color:#92400e; background:#fffbeb; }
    body.light-mode #schedule-comparison a { color:#1d4ed8; }
    @media(max-width:360px) { #schedule-comparison .sc-fields { grid-template-columns:1fr; } }
  `;
  doc.head.appendChild(style);
  const root = doc.createElement('section');
  root.id = 'schedule-comparison'; root.className = 'card';
  root.innerHTML = `
    <h3 style="font-size:14px;margin-bottom:7px">📆 투약일 변경 비교</h3>
    <div class="sc-muted">같은 입력량으로 원 예정일과 변경일을 비교합니다. 두 약은 각각 확인하며 서로 합산하지 않습니다.</div>
    <div class="sc-fields">
      <label class="sc-wide">비교할 약<select id="sc-drug" class="input-field">${drugs.map((drug) => `<option value="${escapeHtml(drug)}">${escapeHtml(drug)}</option>`).join('')}</select></label>
      <label>평소 1회 입력량 (mg)<input id="sc-dose" class="input-field" type="number" min="0" step="any" inputmode="decimal" /></label>
      <label>주기 (일)<input id="sc-cycle" class="input-field" type="number" min="0.25" max="30" step="any" /></label>
      <label class="sc-wide">원 예정 시각 (한국시간)<input id="sc-planned" class="input-field" type="datetime-local" /></label>
      <label class="sc-wide">이번 변경 시각 (한국시간)<input id="sc-changed" class="input-field" type="datetime-local" /></label>
      <label class="sc-wide">다음 회차의 비교 가정<select id="sc-next" class="input-field"><option value="original">원래 다음 예정일로 복귀</option><option value="shifted">변경 시각부터 같은 주기로 이동</option></select></label>
    </div>
    <div style="display:flex;gap:7px;margin-bottom:9px"><button id="sc-now" class="qbtn" type="button">변경 시각을 지금으로</button><button id="sc-reload" class="qbtn" type="button">최근 기록 다시 읽기</button></div>
    <div id="sc-origin" class="sc-muted"></div>
    <div id="sc-error" role="status" class="sc-notice" hidden></div>
    <div id="sc-result" hidden>
      <div id="sc-summary" style="font-size:12px;line-height:1.8;margin:9px 0"></div>
      <canvas id="sc-chart" style="display:block;width:100%;border-radius:8px" role="img" aria-label="같은 약의 원 일정 점선과 변경 일정 실선 비교"></canvas>
      <div class="sc-muted" style="margin-top:6px">┈ 원 일정　<span style="color:#60a5fa">━ 변경 일정</span>　│ 변경 시각</div>
      <table aria-label="일정별 모델 추정값 비교"><thead><tr><th>비교 시점</th><th>원 일정</th><th>변경 일정</th><th>차이</th></tr></thead><tbody id="sc-table"></tbody></table>
      <div class="sc-muted">표의 수치는 모두 모델 추정값(mg)입니다.</div>
      <div id="sc-warnings" class="sc-muted" style="margin:8px 0"></div>
    </div>
    <div class="sc-notice" style="margin-top:10px">이 값은 기존 그래프와 같은 흡수·반감기 모델의 추정값입니다. 실제 혈중농도·약효·안전한 다음 용량이 아닙니다. 날짜 차이로 증량·감량할 양을 역산하지 않습니다. 병용 및 용량 변경은 처방 의료진 확인이 필요합니다.</div>
    <details style="margin-top:8px;font-size:11px;line-height:1.7"><summary>공식 안내와 계산 범위</summary><div class="sc-muted" style="margin-top:6px"><a href="${FDA_URL}" target="_blank" rel="noopener noreferrer">마운자로 FDA 라벨</a>: 누락 후 96시간 이내 / 초과 시 건너뛰기, 투여 간격 최소 72시간 안내가 있습니다. 이는 레타와 병용하는 보정량이나 안전간격을 뜻하지 않습니다.<br><a href="${RETA_URL}" target="_blank" rel="noopener noreferrer">Lilly 레타트루타이드 안내</a>: 미승인 연구약으로 누락·병용 용량 규칙이 확립되지 않았습니다.<br>기존 실제기록 + 각 일정의 가상기록을 같은 모델로 비교합니다. 기록·재고·알림 일정은 저장하거나 변경하지 않습니다. 투약시각 직후에는 흡수 전이므로 그래프가 즉시 입력량만큼 뛰지 않을 수 있습니다.</div></details>
  `;
  anchor.insertAdjacentElement('afterend', root);
  const byId = (id) => doc.getElementById(`sc-${id}`);
  const fields = Object.fromEntries(['drug', 'dose', 'cycle', 'planned', 'changed', 'next', 'origin', 'error', 'result', 'summary', 'chart', 'table', 'warnings'].map((id) => [id, byId(id)]));
  const states = new Map();
  let result = null;
  let dirty = false;
  const store = () => states.set(fields.drug.value, Object.fromEntries(['dose', 'cycle', 'planned', 'changed', 'next'].map((key) => [key, fields[key].value])));
  const run = () => {
    const drug = fields.drug.value;
    try {
      const records = getRecords() || [];
      const config = configs[drug];
      result = compareDoseTiming({ records, drug, config, doseMg: fields.dose.value,
        plannedTime: parseKstInput(fields.planned.value), changedTime: parseKstInput(fields.changed.value),
        intervalDays: fields.cycle.value, nextMode: fields.next.value, contribution, now: now() });
      fields.error.hidden = true; fields.result.hidden = false;
      const shift = Math.abs(result.delayHours) < 1 / 60 ? '원 일정과 같은 시각'
        : `${duration(Math.abs(result.delayHours))} ${result.delayHours > 0 ? '늦춘' : '앞당긴'} 비교`;
      fields.summary.textContent = `${shift} · 입력량 ${fields.dose.value}mg 유지\n이전 기록 → 변경일: ${result.previousGapHours === null ? '기록 없음' : duration(result.previousGapHours)}\n변경일 → 다음 가상회차: ${duration(result.nextGapHours)} (${formatTime(result.changedNextTime)})`;
      fields.summary.style.whiteSpace = 'pre-line';
      const rows = [[result.changedTime, '변경 시각'], [result.changedTime + DAY, '24시간 뒤'], [result.changedTime + 3 * DAY, '72시간 뒤']];
      fields.table.innerHTML = rows.map(([time, label]) => {
        const point = result.points.find((item) => item.time === time);
        return point ? `<tr><td>${label}<br><span class="sc-muted">${formatTime(time)}</span></td><td>${mg(point.baselineMg)}</td><td>${mg(point.changedMg)}</td><td>${point.deltaMg > 0 ? '+' : ''}${mg(point.deltaMg)}</td></tr>` : '';
      }).join('');
      const notices = [...result.warnings];
      if (drug.includes('Tirzepatide') && (result.previousGapHours !== null && result.previousGapHours < 72 || result.nextGapHours < 72)) {
        notices.push('이 가정에는 마운자로 라벨의 최소 72시간보다 짧은 같은 약 투여 간격이 있습니다. 투약 지시가 아닙니다.');
      }
      fields.warnings.textContent = `${result.historyCount}건의 기존 기록을 공통 적용했습니다. ${notices.join(' ')}`;
      drawComparison(fields.chart, result, doc, targetWindow);
    } catch (error) {
      result = null; fields.result.hidden = true; fields.error.hidden = false;
      fields.error.textContent = `비교하려면 입력을 확인해주세요. ${error.message}`;
    }
  };
  const load = (force = false) => {
    const drug = fields.drug.value;
    const value = !force && states.get(drug);
    const defaults = defaultScheduleFields(getRecords(), drug, getDoseCycle(drug), now());
    const state = value || { dose: defaults.dose, cycle: defaults.interval, planned: defaults.planned, changed: defaults.changed, next: 'original' };
    for (const key of ['dose', 'cycle', 'planned', 'changed', 'next']) fields[key].value = String(state[key]);
    fields.origin.textContent = `기준: ${drugs.map((name) => `${configs[name].short || name} ${name.includes('Tirzepatide') ? '목' : '일'}요일`).join(' · ')}. ${defaults.planned ? '예정일은 마지막 기록 뒤 기준 요일로 계산하며 직접 바꿀 수 있습니다.' : '기존 투약기록이 없어 용량과 예정 시각을 직접 입력해야 합니다.'}`;
    dirty = Boolean(value); run();
  };
  fields.drug.addEventListener('change', () => load());
  for (const key of ['dose', 'cycle', 'planned', 'changed', 'next']) fields[key].addEventListener('input', () => { dirty = true; store(); run(); });
  byId('now').addEventListener('click', () => { fields.changed.value = formatKstInput(now()); dirty = true; store(); run(); });
  byId('reload').addEventListener('click', () => { states.delete(fields.drug.value); dirty = false; load(true); });
  const Observer = doc.defaultView?.MutationObserver || targetWindow.MutationObserver;
  const observer = Observer ? new Observer(() => { if (!dirty) load(true); else run(); }) : null;
  observer?.observe(anchor, { childList: true });
  targetWindow.addEventListener('resize', () => { if (result) drawComparison(fields.chart, result, doc, targetWindow); });
  const themeObserver = Observer ? new Observer(() => { if (result) drawComparison(fields.chart, result, doc, targetWindow); }) : null;
  themeObserver?.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
  doc.documentElement.dataset.scheduleComparison = 'same-dose-timing-v1';
  load();
  return { installed: true, run, reload: () => load(true), observer, themeObserver };
}
