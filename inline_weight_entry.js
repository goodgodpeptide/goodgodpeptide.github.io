export const INLINE_WEIGHT_ENTRY_CSS = `
  #inline-weight-entry {
    margin-bottom: 12px;
    padding: 11px;
    background: linear-gradient(135deg, rgba(5, 150, 105, 0.14), rgba(16, 185, 129, 0.06));
    border: 1px solid rgba(52, 211, 153, 0.38);
    border-radius: 14px;
  }
  #inline-weight-entry .inline-weight-heading {
    margin-bottom: 8px;
    color: #6ee7b7;
    font-size: 12px;
    font-weight: 800;
  }
  #inline-weight-entry .inline-weight-form {
    display: grid;
    grid-template-columns: minmax(92px, 0.7fr) minmax(180px, 1.45fr) 76px;
    gap: 7px;
    align-items: end;
  }
  #inline-weight-entry label {
    display: block;
    min-width: 0;
    color: #94a3b8;
    font-size: 10px;
    font-weight: 600;
  }
  #inline-weight-entry .inline-weight-input {
    width: 100%;
    min-width: 0;
    height: 42px;
    margin-top: 4px;
    padding: 0 10px;
    background: #12121e;
    border: 1px solid #374151;
    border-radius: 10px;
    color: #e2e8f0;
    font-family: inherit;
    font-size: 13px;
    outline: none;
  }
  #inline-weight-entry .inline-weight-input:focus {
    border-color: #34d399;
    box-shadow: 0 0 0 2px rgba(52, 211, 153, 0.14);
  }
  #inline-weight-entry .inline-weight-save {
    height: 42px;
    padding: 0 10px;
    background: linear-gradient(135deg, #059669, #10b981);
    border: 0;
    border-radius: 10px;
    color: white;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    font-weight: 800;
  }
  #inline-weight-entry .inline-weight-save:disabled {
    cursor: wait;
    opacity: 0.65;
  }
  #inline-weight-entry .inline-weight-status {
    min-height: 13px;
    margin-top: 5px;
    color: #6ee7b7;
    font-size: 10px;
    text-align: right;
  }
  #inline-weight-entry .inline-weight-status[data-error="true"] {
    color: #fca5a5;
  }
  body.light-mode #inline-weight-entry {
    background: linear-gradient(135deg, rgba(5, 150, 105, 0.1), rgba(16, 185, 129, 0.03));
    border-color: rgba(5, 150, 105, 0.34);
  }
  body.light-mode #inline-weight-entry .inline-weight-heading { color: #047857; }
  body.light-mode #inline-weight-entry label { color: #64748b; }
  body.light-mode #inline-weight-entry .inline-weight-input {
    background: #ffffff;
    border-color: #cbd5e1;
    color: #0f172a;
  }
  @media (max-width: 520px) {
    #inline-weight-entry .inline-weight-form {
      grid-template-columns: minmax(92px, 0.72fr) minmax(168px, 1.28fr);
    }
    #inline-weight-entry .inline-weight-save { grid-column: 1 / -1; }
  }
`;

export const INLINE_WEIGHT_ENTRY_MARKUP = `
  <div class="inline-weight-heading">⚖️ 체중 바로 기록</div>
  <form class="inline-weight-form" novalidate>
    <label>체중 (kg)
      <input id="inline-weight-value" class="inline-weight-input" type="number" inputmode="decimal"
        min="1" max="500" step="0.1" placeholder="예: 89.7" autocomplete="off" />
    </label>
    <label>날짜 / 시간 (한국시간)
      <input id="inline-weight-time" class="inline-weight-input" type="datetime-local" />
    </label>
    <button id="inline-weight-save" class="inline-weight-save" type="submit">저장</button>
  </form>
  <div id="inline-weight-status" class="inline-weight-status" role="status" aria-live="polite"></div>
`;

export function kstDateTimeInputValue(epochMs = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

export function validateInlineWeightEntry(weightValue, timeValue) {
  const weight = Number(weightValue);
  if (!Number.isFinite(weight) || weight < 1 || weight > 500) {
    return { valid: false, reason: "weight", message: "체중을 1~500kg 범위로 입력하세요." };
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(String(timeValue || ""))) {
    return { valid: false, reason: "time", message: "날짜와 시간을 지정하세요." };
  }
  return { valid: true, weight, time: String(timeValue) };
}

function setStatus(status, message, isError = false) {
  if (!status) return;
  status.textContent = message;
  status.dataset.error = isError ? "true" : "false";
}

export async function submitInlineWeightEntry({
  document: doc = document,
  submitNative = () => globalThis.submitAddWeight?.(),
  now = () => Date.now(),
} = {}) {
  const weightInput = doc.getElementById("inline-weight-value");
  const timeInput = doc.getElementById("inline-weight-time");
  const saveButton = doc.getElementById("inline-weight-save");
  const status = doc.getElementById("inline-weight-status");
  const nativeWeightInput = doc.getElementById("add-weight");
  const nativeTimeInput = doc.getElementById("add-weight-time");
  const checked = validateInlineWeightEntry(weightInput?.value, timeInput?.value);

  if (!checked.valid) {
    setStatus(status, checked.message, true);
    (checked.reason === "weight" ? weightInput : timeInput)?.focus?.();
    return { saved: false, reason: checked.reason };
  }
  if (!nativeWeightInput || !nativeTimeInput || typeof submitNative !== "function") {
    setStatus(status, "저장 기능을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.", true);
    return { saved: false, reason: "native_submit_missing" };
  }

  nativeWeightInput.value = String(checked.weight);
  nativeTimeInput.value = checked.time;
  saveButton.disabled = true;
  setStatus(status, "저장 중…");
  try {
    await Promise.resolve(submitNative());
    weightInput.value = "";
    timeInput.value = kstDateTimeInputValue(now());
    setStatus(status, "✓ 체중 기록 저장됨");
    return { saved: true, weight: checked.weight, time: checked.time };
  } catch (error) {
    setStatus(status, "저장하지 못했습니다. 다시 시도하세요.", true);
    return { saved: false, reason: "submit_failed", error };
  } finally {
    saveButton.disabled = false;
  }
}

function ensureInlineWeightStyle(doc) {
  if (doc.getElementById("inline-weight-entry-style")) return;
  const style = doc.createElement("style");
  style.id = "inline-weight-entry-style";
  style.textContent = INLINE_WEIGHT_ENTRY_CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

export function installInlineWeightEntry({
  document: doc = document,
  submitNative = () => globalThis.submitAddWeight?.(),
  now = () => Date.now(),
} = {}) {
  if (doc.getElementById("inline-weight-entry")) return { installed: true, reason: "already_installed" };
  const oldButton = doc.querySelector('#wtab-record > button[onclick*="openWeightModal"]');
  if (!oldButton) return { installed: false, reason: "weight_button_missing" };

  ensureInlineWeightStyle(doc);
  const entry = doc.createElement("section");
  entry.id = "inline-weight-entry";
  entry.setAttribute("aria-label", "체중 바로 기록");
  entry.innerHTML = INLINE_WEIGHT_ENTRY_MARKUP;
  oldButton.replaceWith(entry);

  const timeInput = doc.getElementById("inline-weight-time");
  if (timeInput) timeInput.value = kstDateTimeInputValue(now());
  const form = entry.querySelector("form");
  const submit = (event) => {
    event?.preventDefault?.();
    return submitInlineWeightEntry({ document: doc, submitNative, now });
  };
  form?.addEventListener("submit", submit);
  return { installed: true, entry, form, submit };
}
