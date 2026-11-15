/** App-only display controls. No account or health records are read or written here. */
export const DISPLAY_SCALE_STORAGE_KEY = 'ggp_display_scale_v1';

const MIN_SCALE = 80;
const MAX_SCALE = 120;
const STEP = 5;
let controller = null;

function validScale(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= MIN_SCALE && number <= MAX_SCALE
    && (number - MIN_SCALE) % STEP === 0 ? number : 100;
}

function readSavedScale(win) {
  try {
    return validScale(win.localStorage.getItem(DISPLAY_SCALE_STORAGE_KEY) ?? 100);
  } catch {
    return 100;
  }
}

function saveScale(win, scale) {
  try {
    win.localStorage.setItem(DISPLAY_SCALE_STORAGE_KEY, String(scale));
  } catch {
    // Private browsing and storage policy can block persistence; the current view still works.
  }
}

export function getDisplayPreferencesState(doc = globalThis.document, win = globalThis.window) {
  const supported = Boolean(win?.CSS?.supports?.('zoom', '1'));
  return {
    scale: supported ? validScale(Number(doc?.documentElement?.dataset?.displayScale ?? 100)) : 100,
    bigFont: Boolean(doc?.body?.classList?.contains('big-font')),
    zoomSupported: supported,
  };
}

export function initializeDisplayPreferences(doc = globalThis.document, win = globalThis.window) {
  if (!doc?.body || !win) return null;
  if (controller && controller.document === doc) return controller;

  const oldButton = doc.getElementById('bigfont-toggle');
  if (!oldButton) return null;

  const supported = Boolean(win.CSS?.supports?.('zoom', '1'));
  const menuButton = doc.createElement('button');
  menuButton.type = 'button';
  menuButton.id = 'display-preferences-toggle';
  menuButton.style.cssText = oldButton.style.cssText;
  menuButton.textContent = '🔤 화면·글자 크기';
  menuButton.setAttribute('aria-haspopup', 'dialog');
  menuButton.setAttribute('aria-controls', 'display-preferences-dialog');
  oldButton.replaceWith(menuButton);

  const dialog = doc.createElement('dialog');
  dialog.id = 'display-preferences-dialog';
  dialog.className = 'display-preferences-dialog';
  dialog.setAttribute('aria-labelledby', 'display-preferences-title');
  dialog.innerHTML = `
    <div class="display-preferences-head">
      <h2 id="display-preferences-title">화면·글자 크기</h2>
      <button type="button" id="display-close" class="display-icon-button" aria-label="닫기">×</button>
    </div>
    <div class="display-preferences-content">
      <label for="display-scale-range" class="display-section-label">전체 크기 <span>(글자·버튼 함께)</span></label>
      <output id="display-scale-value" for="display-scale-range" aria-live="polite">100%</output>
      <div class="display-scale-controls">
        <button type="button" id="display-scale-minus" aria-label="전체 크기 5% 줄이기">−</button>
        <input id="display-scale-range" type="range" min="80" max="120" step="5" value="100" aria-label="전체 크기" />
        <button type="button" id="display-scale-plus" aria-label="전체 크기 5% 키우기">+</button>
      </div>
      <div class="display-preset-controls" aria-label="전체 크기 빠른 선택">
        <button type="button" id="display-scale-90" data-scale="90">90%</button>
        <button type="button" id="display-scale-100" data-scale="100">기본 100%</button>
        <button type="button" id="display-scale-110" data-scale="110">110%</button>
      </div>
      <p id="display-zoom-unsupported" class="display-unsupported" role="status" hidden>이 브라우저는 앱 전체 크기 조절을 지원하지 않습니다.</p>
      <label class="display-bigfont-label" for="display-bigfont-checkbox">
        <input id="display-bigfont-checkbox" type="checkbox" />
        <span>작은 안내글 크게</span>
      </label>
      <p class="display-preferences-note">이 설정은 앱 화면에만 적용됩니다. 기기나 브라우저의 배율은 바뀌지 않습니다.</p>
    </div>
    <div class="display-preferences-actions">
      <button type="button" id="display-reset">기본값 복원</button>
      <button type="button" id="display-done">완료</button>
    </div>`;
  doc.body.append(dialog);

  const byId = (id) => doc.getElementById(id);
  const slider = byId('display-scale-range');
  const value = byId('display-scale-value');
  const checkbox = byId('display-bigfont-checkbox');
  const scaleControls = [slider, byId('display-scale-minus'), byId('display-scale-plus'),
    ...dialog.querySelectorAll('[data-scale]')];
  let scale = supported ? readSavedScale(win) : 100;
  let resizeTimer = null;
  let focusBeforeOpen = null;

  function queueGraphResize() {
    win.clearTimeout(resizeTimer);
    resizeTimer = win.setTimeout(() => {
      resizeTimer = null;
      win.dispatchEvent(new win.Event('resize'));
    }, 130);
  }

  function paint() {
    slider.value = String(scale);
    value.value = `${scale}%`;
    value.textContent = `${scale}%`;
    checkbox.checked = doc.body.classList.contains('big-font');
    for (const preset of dialog.querySelectorAll('[data-scale]')) {
      preset.setAttribute('aria-pressed', String(Number(preset.dataset.scale) === scale));
    }
    byId('display-scale-minus').disabled = !supported || scale === MIN_SCALE;
    byId('display-scale-plus').disabled = !supported || scale === MAX_SCALE;
  }

  function setScale(nextScale) {
    if (!supported) return false;
    const next = validScale(nextScale);
    if (next === scale) return false;
    scale = next;
    if (scale === 100) {
      doc.documentElement.style.removeProperty('zoom');
    } else {
      doc.documentElement.style.zoom = String(scale / 100);
    }
    doc.documentElement.style.setProperty('--display-scale', String(scale / 100));
    doc.documentElement.dataset.displayScale = String(scale);
    saveScale(win, scale);
    paint();
    queueGraphResize();
    return true;
  }

  function setBigFont(enabled) {
    if (doc.body.classList.contains('big-font') === enabled) return;
    if (typeof win.toggleBigFont === 'function') {
      try {
        win.toggleBigFont();
      } catch {
        // The legacy toggle changes the class before persisting; reflect its real result.
      }
    }
    paint();
    queueGraphResize();
  }

  function close() {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    focusBeforeOpen?.focus?.();
  }

  function open() {
    // Opening closes the dropdown, so its menu item cannot receive focus on return.
    focusBeforeOpen = doc.getElementById('settings-btn') || menuButton;
    if (typeof win.closeSettingsMenu === 'function') win.closeSettingsMenu();
    paint();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    slider.disabled = !supported;
    byId('display-zoom-unsupported').hidden = supported;
    byId('display-close').focus();
  }

  if (supported && scale !== 100) {
    doc.documentElement.style.zoom = String(scale / 100);
    queueGraphResize();
  }
  doc.documentElement.style.setProperty('--display-scale', String(scale / 100));
  doc.documentElement.dataset.displayScale = String(scale);
  scaleControls.forEach((item) => { item.disabled = !supported; });
  byId('display-zoom-unsupported').hidden = supported;
  paint();

  menuButton.addEventListener('click', open);
  slider.addEventListener('input', () => setScale(slider.value));
  byId('display-scale-minus').addEventListener('click', () => setScale(scale - STEP));
  byId('display-scale-plus').addEventListener('click', () => setScale(scale + STEP));
  for (const preset of dialog.querySelectorAll('[data-scale]')) {
    preset.addEventListener('click', () => setScale(Number(preset.dataset.scale)));
  }
  checkbox.addEventListener('change', () => setBigFont(checkbox.checked));
  byId('display-reset').addEventListener('click', () => {
    setScale(100);
    doc.documentElement.style.setProperty('--display-scale', '1');
    saveScale(win, 100);
    setBigFont(false);
    paint();
  });
  byId('display-close').addEventListener('click', close);
  byId('display-done').addEventListener('click', close);
  dialog.addEventListener('close', () => focusBeforeOpen?.focus?.());
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && typeof dialog.showModal !== 'function') {
      event.preventDefault();
      close();
    }
  });

  controller = {
    document: doc,
    open,
    close,
    getState: () => getDisplayPreferencesState(doc, win),
  };
  return controller;
}

// All inline app scripts and their legacy globals have loaded by the window load event.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'complete') initializeDisplayPreferences();
  else window.addEventListener('load', () => initializeDisplayPreferences(), { once: true });
}
