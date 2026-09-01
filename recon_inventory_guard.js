const DAY_MS = 86_400_000;

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) ? String(id) : "";
}

function positiveNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatUnits(value) {
  const amount = Math.max(0, numberOrZero(value));
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(1).replace(/\.0$/, "");
}

function formatSignedUnits(value) {
  const amount = numberOrZero(value);
  const absolute = Math.abs(amount);
  const formatted = Number.isInteger(absolute) ? String(absolute) : absolute.toFixed(1).replace(/\.0$/, "");
  return `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${formatted}`;
}

/**
 * 같은 약을 여러 번 조제해도 각 바이알을 독립 배치로 유지한다.
 * 투약 시점에 이미 조제된 배치 중 가장 오래된 잔량부터 선입선출로 차감한다.
 * 따라서 새 바이알을 조제한 뒤에도 이전 잔량이 먼저 소진되고, 남는 투약량만
 * 다음 배치로 넘어간다.
 */
export function buildReconBatchRows(vials = [], records = []) {
  const groups = new Map();
  for (const vial of Array.isArray(vials) ? vials : []) {
    if (!vial || !vial.drug) continue;
    if (!groups.has(vial.drug)) groups.set(vial.drug, []);
    groups.get(vial.drug).push(vial);
  }

  const rows = [];
  for (const [drug, drugVials] of groups) {
    const ordered = [...drugVials].sort((left, right) => {
      const byDate = numberOrZero(left.reconDate) - numberOrZero(right.reconDate);
      return byDate || numberOrZero(left.id) - numberOrZero(right.id);
    });

    const states = ordered.map((vial, index) => {
      const vialMg = Math.max(0, numberOrZero(vial.vialMg));
      const doseMg = Math.max(0, numberOrZero(vial.doseMg));
      const waterMl = Math.max(0, numberOrZero(vial.waterMl));
      const theoreticalTotalUnits = waterMl * 100;
      const nominalMgPerUnit = waterMl > 0 ? (vialMg / waterMl) * 0.01 : 0;
      const actualTotalUnits = positiveNumberOrNull(vial.actualTotalUnits);
      const isUnitMeasured = actualTotalUnits !== null && nominalMgPerUnit > 0;
      const capacityMg = isUnitMeasured ? actualTotalUnits * nominalMgPerUnit : vialMg;
      const offsetMg = Math.min(capacityMg, Math.max(0, numberOrZero(vial.injOffset)) * doseMg);
      return {
        vial,
        index,
        startAt: numberOrZero(vial.reconDate),
        vialMg,
        doseMg,
        waterMl,
        theoreticalTotalUnits,
        nominalMgPerUnit,
        actualTotalUnits,
        isUnitMeasured,
        capacityMg,
        usedMg: offsetMg,
        remainingMg: Math.max(0, capacityMg - offsetMg),
        overdrawMg: 0,
      };
    });

    const drugRecords = (Array.isArray(records) ? records : [])
      .filter((record) => record?.drug === drug && !record.isOverride)
      .sort((left, right) => numberOrZero(left.time) - numberOrZero(right.time)
        || numberOrZero(left.id) - numberOrZero(right.id));

    for (const record of drugRecords) {
      const recordAt = numberOrZero(record.time);
      let unallocatedMg = Math.max(0, numberOrZero(record.dose));
      if (!unallocatedMg) continue;
      for (const state of states) {
        if (state.startAt > recordAt) break;
        if (state.remainingMg <= 0) continue;
        const usedNow = Math.min(state.remainingMg, unallocatedMg);
        state.usedMg += usedNow;
        state.remainingMg -= usedNow;
        unallocatedMg -= usedNow;
        if (unallocatedMg <= 0) break;
        // 실측 총유닛이 입력된 배치는 그 값이 물리적인 랏 경계다. 한 번의 마지막
        // 투여가 경계를 넘더라도 초과분을 새 랏으로 넘기지 않고 이 랏의 불일치로 둔다.
        if (usedNow > 0 && state.isUnitMeasured) {
          state.overdrawMg += unallocatedMg;
          unallocatedMg = 0;
          break;
        }
      }
    }

    states.forEach((state) => {
      const {
        vial, index, vialMg, doseMg, usedMg, remainingMg, waterMl,
        theoreticalTotalUnits, actualTotalUnits, isUnitMeasured, capacityMg, overdrawMg,
      } = state;
      const totalInjections = doseMg > 0 ? Math.floor(capacityMg / doseMg) : 0;
      const remainingInjections = doseMg > 0 ? Math.floor(remainingMg / doseMg) : 0;
      const mgPerClick = waterMl > 0 ? (vialMg / waterMl) * 0.01 : 0;
      const earlierBalance = states.slice(0, index).some((candidate) => candidate.remainingMg > 0);
      const isNextToUse = remainingMg > 0 && !earlierBalance;

      rows.push({
        ...vial,
        drug,
        batchIndex: index + 1,
        batchCount: ordered.length,
        isCurrent: index === ordered.length - 1,
        usedMg,
        remainingMg,
        hasEarlierBalance: earlierBalance,
        isNextToUse,
        totalInjections,
        remainingInjections,
        theoreticalTotalUnits,
        actualTotalUnits,
        isUnitMeasured,
        capacityMg,
        overdrawMg,
        goldenDoseUnits: positiveNumberOrNull(vial.goldenDoseUnits),
        remainingClicks: mgPerClick > 0 ? Math.max(0, Math.round(remainingMg / mgPerClick)) : 0,
        percentRemaining: capacityMg > 0 ? Math.min(100, Math.round((remainingMg / capacityMg) * 100)) : 0,
      });
    });
  }

  return rows.sort((left, right) => {
    const priority = (row) => (!row.isCurrent && row.remainingMg > 0 ? 0 : row.isCurrent ? 1 : 2);
    const byPriority = priority(left) - priority(right);
    if (byPriority) return byPriority;
    if (priority(left) === 0) {
      return numberOrZero(left.reconDate) - numberOrZero(right.reconDate)
        || numberOrZero(left.id) - numberOrZero(right.id);
    }
    return numberOrZero(right.reconDate) - numberOrZero(left.reconDate)
      || numberOrZero(right.id) - numberOrZero(left.id);
  });
}

export function clearStaleReconEditState(targetWindow = globalThis) {
  targetWindow._editingReconId = null;
  targetWindow._reconGuardEditingId = null;
}

function setModalMode(doc, mode, editingId = null) {
  const modal = doc.getElementById("recon-modal");
  if (!modal) return false;
  modal.dataset.reconMode = mode;
  const title = modal.querySelector("div[style*='font-size:16px']");
  const drugSelect = doc.getElementById("recon-drug");
  const saveButton = modal.querySelector("button[onclick='submitRecon()']");

  if (mode === "edit") {
    doc.getElementById("recon-create-notice")?.remove();
    if (title) title.textContent = "🧪 조제 기록 수정";
    if (drugSelect) {
      drugSelect.disabled = true;
      drugSelect.title = "기존 배치의 약물은 변경할 수 없습니다. 다른 약은 새 조제로 추가하세요.";
    }
    if (saveButton) saveButton.textContent = "수정 저장";
    modal.dataset.editingId = safeId(editingId);
  } else {
    if (title) title.textContent = "🧪 새 조제 배치 추가";
    if (drugSelect) {
      drugSelect.disabled = false;
      drugSelect.removeAttribute("title");
    }
    if (saveButton) saveButton.textContent = "새 배치 추가";
    delete modal.dataset.editingId;

    const content = modal.firstElementChild;
    if (content && !doc.getElementById("recon-create-notice")) {
      const notice = doc.createElement("div");
      notice.id = "recon-create-notice";
      notice.textContent = "기존 조제 잔량은 유지되고, 새 배치가 별도로 추가됩니다.";
      notice.style.cssText = "margin:-6px 0 12px;padding:8px 10px;border:1px solid #34d39955;border-radius:9px;background:#10b98112;color:#6ee7b7;font-size:11px;line-height:1.5";
      const heading = content.children?.[0];
      heading?.insertAdjacentElement?.("afterend", notice);
    }
  }
  return true;
}

function injectUnitAuditFields(doc, vial = null) {
  const modal = doc.getElementById("recon-modal");
  if (!modal) return false;
  doc.getElementById("recon-unit-audit")?.remove();
  const saveButton = modal.querySelector("button[onclick='submitRecon()']");
  if (!saveButton) return false;

  const panel = doc.createElement("div");
  panel.id = "recon-unit-audit";
  panel.style.cssText = "margin:10px 0;padding:10px;border:1px solid #60a5fa55;border-radius:10px;background:#2563eb0d";
  panel.innerHTML = `
    <div style="font-size:12px;font-weight:800;color:#60a5fa;margin-bottom:7px">실제 조제 유닛 점검</div>
    <div style="font-size:10px;color:#94a3b8;line-height:1.45;margin-bottom:8px">이론값과 다를 때만 입력하세요. 실측 총량은 이 랏의 물리적 경계가 되어 마지막 투여 차이가 새 랏으로 넘어가지 않습니다.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <label style="font-size:10px;color:#94a3b8">실제 총유닛
        <input id="recon-actual-total-units" type="number" min="0.1" max="10000" step="0.1" inputmode="decimal" placeholder="예: 309" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #64748b;border-radius:8px;background:transparent;color:inherit;font:inherit">
      </label>
      <label style="font-size:10px;color:#94a3b8">마지막 골든도즈
        <input id="recon-golden-dose-units" type="number" min="0.1" max="10000" step="0.1" inputmode="decimal" placeholder="예: 59" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #64748b;border-radius:8px;background:transparent;color:inherit;font:inherit">
      </label>
    </div>
    <label style="display:block;font-size:10px;color:#94a3b8;margin-top:8px">차이 사유
      <input id="recon-unit-audit-note" type="text" maxlength="120" placeholder="예: 조제 후 실측, 혼합 손실, 주사기 잔량" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #64748b;border-radius:8px;background:transparent;color:inherit;font:inherit">
    </label>`;

  const buttonRow = saveButton.parentElement;
  if (buttonRow?.parentElement) buttonRow.parentElement.insertBefore(panel, buttonRow);
  else modal.firstElementChild?.appendChild(panel);
  const totalInput = doc.getElementById("recon-actual-total-units");
  const goldenInput = doc.getElementById("recon-golden-dose-units");
  const noteInput = doc.getElementById("recon-unit-audit-note");
  if (totalInput && positiveNumberOrNull(vial?.actualTotalUnits)) totalInput.value = String(vial.actualTotalUnits);
  if (goldenInput && positiveNumberOrNull(vial?.goldenDoseUnits)) goldenInput.value = String(vial.goldenDoseUnits);
  if (noteInput && vial?.unitAuditNote) noteInput.value = String(vial.unitAuditNote);
  return true;
}

function readUnitAuditInputs(doc) {
  const totalInput = doc.getElementById("recon-actual-total-units");
  if (!totalInput) return { present: false };
  const goldenInput = doc.getElementById("recon-golden-dose-units");
  const noteInput = doc.getElementById("recon-unit-audit-note");
  const totalRaw = String(totalInput.value || "").trim();
  const goldenRaw = String(goldenInput?.value || "").trim();
  const actualTotalUnits = positiveNumberOrNull(totalRaw);
  const goldenDoseUnits = positiveNumberOrNull(goldenRaw);

  if (totalRaw && actualTotalUnits === null) {
    totalInput.setCustomValidity("실제 총유닛은 0보다 큰 숫자로 입력하세요.");
    totalInput.reportValidity?.();
    return { present: true, valid: false };
  }
  totalInput.setCustomValidity("");
  if (goldenRaw && goldenDoseUnits === null) {
    goldenInput?.setCustomValidity?.("골든도즈는 0보다 큰 숫자로 입력하세요.");
    goldenInput?.reportValidity?.();
    return { present: true, valid: false };
  }
  goldenInput?.setCustomValidity?.("");
  if (goldenDoseUnits !== null && actualTotalUnits === null) {
    totalInput.setCustomValidity("골든도즈를 기록하려면 실제 총유닛도 함께 입력하세요.");
    totalInput.reportValidity?.();
    return { present: true, valid: false };
  }
  if (goldenDoseUnits !== null && goldenDoseUnits > actualTotalUnits) {
    goldenInput?.setCustomValidity?.("골든도즈는 실제 총유닛보다 클 수 없습니다.");
    goldenInput?.reportValidity?.();
    return { present: true, valid: false };
  }
  return {
    present: true,
    valid: true,
    actualTotalUnits,
    goldenDoseUnits,
    unitAuditNote: String(noteInput?.value || "").trim(),
  };
}

function applyUnitAudit(vial, audit, now = () => Date.now()) {
  if (!vial || !audit?.present || !audit.valid) return false;
  if (audit.actualTotalUnits === null) {
    delete vial.actualTotalUnits;
    delete vial.goldenDoseUnits;
    delete vial.unitAuditNote;
    delete vial.unitAuditAt;
    return true;
  }
  vial.actualTotalUnits = audit.actualTotalUnits;
  if (audit.goldenDoseUnits === null) delete vial.goldenDoseUnits;
  else vial.goldenDoseUnits = audit.goldenDoseUnits;
  if (audit.unitAuditNote) vial.unitAuditNote = audit.unitAuditNote;
  else delete vial.unitAuditNote;
  vial.unitAuditAt = now();
  return true;
}

function bindRowActions(container, targetWindow) {
  container.querySelectorAll("[data-recon-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.reconAction;
      if (action === "create") {
        targetWindow.openReconModal?.(button.dataset.drug || undefined);
        return;
      }
      const rawId = button.dataset.id;
      if (!rawId) return;
      const id = Number(rawId);
      if (!Number.isSafeInteger(id)) return;
      if (action === "edit") targetWindow.openEditReconModal?.(id);
      if (action === "archive") targetWindow.archiveRecon?.(id);
      if (action === "delete") targetWindow.deleteRecon?.(id);
    });
  });
}

export function renderReconInventory({
  document: doc = document,
  targetWindow = globalThis,
  data = {},
  configs = {},
  activeDrugs = [],
  getDoseCycle = () => 0,
  formatDate = (value) => String(value || ""),
  archiveHtml = () => "",
  now = () => Date.now(),
} = {}) {
  const container = doc.getElementById("recon-section");
  if (!container) return { rendered: false, reason: "container_missing" };
  const isLight = doc.body?.classList?.contains?.("light-mode") || false;
  const rows = buildReconBatchRows(data.reconVials, data.records);
  const rowBg = isLight ? "#f8fafc" : "#0d0d1a";
  const border = isLight ? "#e2e8f0" : "#1f2937";
  const valueColor = isLight ? "#111827" : "#e2e8f0";

  if (!rows.length) {
    container.innerHTML = `<div style="text-align:center;color:#4a5568;padding:16px;font-size:13px">조제된 바이알이 없습니다<br><button data-recon-action="create" style="margin-top:10px;padding:7px 16px;background:#1d4ed8;border:none;border-radius:10px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">+ 조제 기록하기</button></div>${archiveHtml(isLight) || ""}`;
    bindRowActions(container, targetWindow);
    return { rendered: true, rowCount: 0 };
  }

  const currentDrugs = new Set(rows.map((row) => row.drug));
  const cards = rows.map((row) => {
    const config = configs[row.drug] || {};
    const color = config.color || "#60a5fa";
    const badge = row.isCurrent ? "현재 조제" : "이전 잔량";
    const badgeColor = row.isCurrent ? "#34d399" : "#fbbf24";
    const intervalDays = numberOrZero(getDoseCycle(row.drug));
    let exhaustLabel = "";
    if (row.remainingMg <= 0) {
      exhaustLabel = "소진 완료";
    } else if (!row.isCurrent) {
      exhaustLabel = row.isNextToUse ? "투약 시 이 잔량부터 차감" : "앞 배치 소진 후 차감";
    } else if (row.hasEarlierBalance) {
      exhaustLabel = "이전 잔량 소진 후 차감";
    } else if (config.halfLifeDays < 0.1) {
      exhaustLabel = "당일 소진";
    } else if (row.remainingInjections > 0 && intervalDays > 0) {
      exhaustLabel = `${formatDate(now() + row.remainingInjections * intervalDays * DAY_MS)} 예상 소진`;
    }
    const id = safeId(row.id);
    const clicks = row.remainingClicks > 0 ? ` · ${row.remainingClicks}클릭` : "";
    const notes = row.notes ? `<div style="font-size:11px;color:#6b7280;margin-top:5px">📝 ${escapeHtml(row.notes)}</div>` : "";
    const theoreticalUnits = formatUnits(row.theoreticalTotalUnits);
    const unitDifference = row.isUnitMeasured ? row.actualTotalUnits - row.theoreticalTotalUnits : 0;
    const differenceLabel = Math.abs(unitDifference) < 0.05 ? "차이 없음" : `${formatSignedUnits(unitDifference)}유닛`;
    const unitAudit = row.isUnitMeasured
      ? `<div style="font-size:10px;line-height:1.55;color:#93c5fd;margin-top:6px">실측 총 ${formatUnits(row.actualTotalUnits)}유닛 · 이론 ${theoreticalUnits}유닛 · 조제 차이 ${differenceLabel}${row.goldenDoseUnits ? `<br>골든도즈 ${formatUnits(row.goldenDoseUnits)}유닛` : ""}${row.unitAuditNote ? ` · ${escapeHtml(row.unitAuditNote)}` : ""}</div>`
      : `<div style="font-size:10px;color:#64748b;margin-top:6px">이론 ${theoreticalUnits}유닛 · 실제 조제 총유닛 미입력</div>`;
    const mismatch = row.overdrawMg > 0
      ? `<div style="font-size:10px;line-height:1.45;color:#fbbf24;margin-top:6px;padding:6px 8px;border:1px solid #f59e0b44;border-radius:7px;background:#f59e0b10">⚠️ 투여 기록이 실측 총량보다 ${row.overdrawMg.toFixed(2)}mg 큽니다. 이 차이는 해당 랏의 확인 대상으로 고정했고 다음 랏에서는 차감하지 않았습니다.</div>`
      : "";

    return `<article data-recon-vial-id="${id}" data-recon-drug="${escapeHtml(row.drug)}" style="background:${rowBg};border:1px solid ${row.isCurrent ? color : badgeColor}66;border-radius:12px;padding:12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <strong style="font-size:13px;color:${color}">${escapeHtml(config.emoji || "")} ${escapeHtml(String(row.drug).split(" ")[0])}</strong>
            <span style="font-size:9px;font-weight:800;color:${badgeColor};border:1px solid ${badgeColor}55;border-radius:8px;padding:2px 6px">${badge}</span>
            <span style="font-size:9px;color:#6b7280">배치 ${row.batchIndex}/${row.batchCount}</span>
          </div>
          <div style="font-size:10px;color:#6b7280;margin-top:3px">${escapeHtml(formatDate(row.reconDate))} 조제 · ${row.vialMg}mg/${row.waterMl || 0}ml</div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button data-recon-action="edit" data-id="${id}" title="이 배치 수정" style="width:25px;height:25px;border-radius:6px;border:1px solid ${border};background:transparent;color:#6b7280;cursor:pointer">✏️</button>
          <button data-recon-action="archive" data-id="${id}" title="보관함으로 이동" style="width:25px;height:25px;border-radius:6px;border:1px solid ${border};background:transparent;color:#6b7280;cursor:pointer">📥</button>
          <button data-recon-action="delete" data-id="${id}" title="삭제" style="width:25px;height:25px;border-radius:6px;border:1px solid #f8717133;background:transparent;color:#f87171;cursor:pointer">🗑</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <div style="flex:1;height:6px;background:${isLight ? "#e2e8f0" : "#1f2937"};border-radius:3px;overflow:hidden"><div style="height:100%;width:${row.percentRemaining}%;background:${color};border-radius:3px"></div></div>
        <div style="font-size:12px;font-weight:800;color:${valueColor};white-space:nowrap">${row.remainingInjections}/${row.totalInjections}회 <span style="font-size:10px;color:#6b7280;font-weight:500">(${row.remainingMg.toFixed(2)}mg${clicks})</span></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span style="font-size:10px;color:#6b7280">${escapeHtml(exhaustLabel)}</span>
        ${row.isCurrent ? `<button data-recon-action="create" data-drug="${escapeHtml(row.drug)}" style="padding:4px 10px;border-radius:8px;border:1px solid ${color}55;background:${color}11;color:${color};font-size:11px;cursor:pointer;font-family:inherit">+ 새 조제</button>` : ""}
      </div>${unitAudit}${mismatch}${notes}
    </article>`;
  }).join("");

  const missing = (Array.isArray(activeDrugs) ? activeDrugs : [])
    .filter((drug) => !currentDrugs.has(drug))
    .map((drug) => {
      const config = configs[drug] || {};
      const color = config.color || "#60a5fa";
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border:1px dashed ${border};border-radius:10px;margin-bottom:6px"><span style="font-size:12px;color:#6b7280">${escapeHtml(config.emoji || "")} ${escapeHtml(String(drug).split(" ")[0])}</span><button data-recon-action="create" data-drug="${escapeHtml(drug)}" style="padding:5px 12px;border-radius:8px;border:1px solid ${color}55;background:${color}11;color:${color};font-size:11px;cursor:pointer;font-family:inherit">+ 조제 기록</button></div>`;
    }).join("");

  container.innerHTML = `<div style="font-size:10px;color:#6b7280;margin:0 2px 8px">같은 약도 조제 배치별로 전부 표시됩니다.</div>${cards}${missing}${archiveHtml(isLight) || ""}`;
  bindRowActions(container, targetWindow);
  return { rendered: true, rowCount: rows.length };
}

export function installReconInventoryGuard({
  document: doc = document,
  targetWindow = globalThis,
  getData,
  configs = {},
  getActiveDrugs = () => [],
  getDoseCycle = () => 0,
  formatDate,
  archiveHtml,
  now,
  saveData,
} = {}) {
  if (targetWindow.__reconInventoryGuardInstalled) return { installed: true, reason: "already_installed" };
  const nativeOpen = targetWindow.openReconModal;
  const nativeEdit = targetWindow.openEditReconModal;
  const nativeSubmit = targetWindow.submitRecon;
  if (typeof nativeOpen !== "function" || typeof nativeEdit !== "function" || typeof getData !== "function") {
    return { installed: false, reason: "native_recon_missing" };
  }

  targetWindow.openReconModal = function guardedOpenReconModal(drug) {
    clearStaleReconEditState(targetWindow);
    const result = nativeOpen.call(targetWindow, drug);
    setTimeout(() => {
      setModalMode(doc, "create");
      injectUnitAuditFields(doc);
    }, 0);
    return result;
  };

  targetWindow.openEditReconModal = function guardedOpenEditReconModal(vialId) {
    targetWindow._reconGuardEditingId = vialId;
    const result = nativeEdit.call(targetWindow, vialId);
    setTimeout(() => {
      targetWindow._editingReconId = vialId;
      targetWindow._reconGuardEditingId = vialId;
      setModalMode(doc, "edit", vialId);
      const vial = (getData()?.reconVials || []).find((candidate) => Number(candidate?.id) === Number(vialId));
      injectUnitAuditFields(doc, vial);
    }, 80);
    return result;
  };

  if (typeof nativeSubmit === "function") {
    targetWindow.submitRecon = function guardedSubmitRecon(...args) {
      const audit = readUnitAuditInputs(doc);
      if (audit.present && !audit.valid) return undefined;
      const modalBeforeSubmit = doc.getElementById("recon-modal");
      const editingId = targetWindow._reconGuardEditingId ?? targetWindow._editingReconId;
      const beforeIds = new Set((getData()?.reconVials || []).map((vial) => String(vial?.id)));
      const result = nativeSubmit.apply(targetWindow, args);
      let applied = false;
      const persistAudit = () => {
        if (applied || !audit.present) return applied;
        if (modalBeforeSubmit && doc.getElementById("recon-modal") === modalBeforeSubmit) return false;
        const vials = getData()?.reconVials || [];
        const target = editingId !== null && editingId !== undefined
          ? vials.find((vial) => Number(vial?.id) === Number(editingId))
          : [...vials].reverse().find((vial) => !beforeIds.has(String(vial?.id)));
        if (!target) return false;
        applied = applyUnitAudit(target, audit, now);
        if (applied) {
          if (typeof saveData === "function") saveData();
          targetWindow.renderReconSection?.();
        }
        return applied;
      };
      setTimeout(persistAudit, 0);
      if (result && typeof result.then === "function") result.then(persistAudit);
      return result;
    };
  }

  targetWindow.renderReconSection = function guardedRenderReconSection() {
    return renderReconInventory({
      document: doc,
      targetWindow,
      data: getData() || {},
      configs,
      activeDrugs: getActiveDrugs(),
      getDoseCycle,
      formatDate,
      archiveHtml,
      now,
    });
  };

  if (typeof MutationObserver === "function" && doc.body) {
    new MutationObserver(() => {
      if (!doc.getElementById("recon-modal") && targetWindow._editingReconId) {
        clearStaleReconEditState(targetWindow);
      }
    }).observe(doc.body, { childList: true, subtree: false });
  }

  targetWindow.__reconInventoryGuardInstalled = true;
  return { installed: true };
}
