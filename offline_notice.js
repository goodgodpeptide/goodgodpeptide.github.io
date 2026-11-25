// 동기화 보호 상태와 독립된 표시기. 접기/펼치기는 기록이나 서버를 바꾸지 않는다.
export function createOfflineNotice({ document, storage, getUser, place }) {
  let current = null;
  const preferenceKey = uid => `jwbs_sync_notice_ui_v1:${encodeURIComponent(uid)}`;
  const identity = model => JSON.stringify([model.kind, Number(model.revision || 0), model.paths || []]);
  function remembered(model, signature) {
    try {
      const value = JSON.parse(storage?.getItem(preferenceKey(model.uid)) || 'null');
      if (value?.identity === signature) return value.collapsed !== false;
    } catch { /* UI 설정 실패는 기록의 동기화를 막지 않는다. */ }
    return true;
  }
  function clear() {
    current?.panel.remove();
    current = null;
  }
  function show(model) {
    if (!model.uid || getUser()?.uid !== model.uid) return;
    const signature = identity(model);
    if (current?.uid === model.uid && current.signature === signature) {
      current.model = model;
      place(current.panel);
      return; // 자동 재시도는 펼침 상태나 사용자의 포커스를 초기화하지 않는다.
    }
    clear();
    const panel = document.createElement('section');
    panel.id = 'jwbs-offline-conflict';
    panel.className = `jwbs-sync-notice jwbs-sync-notice--${model.kind}`;
    panel.setAttribute('aria-label', '동기화 상태');
    const row = document.createElement('div'); row.className = 'jwbs-sync-notice__row';
    const title = document.createElement('span'); title.textContent = model.title;
    const toggle = document.createElement('button'); toggle.type = 'button';
    toggle.className = 'jwbs-sync-notice__toggle';
    toggle.setAttribute('aria-controls', 'jwbs-sync-notice-details');
    row.appendChild(title); row.appendChild(toggle); panel.appendChild(row);
    const details = document.createElement('div');
    details.id = 'jwbs-sync-notice-details'; details.className = 'jwbs-sync-notice__details';
    const description = document.createElement('p'); description.textContent = model.description;
    details.appendChild(description);
    const actions = document.createElement('div'); actions.className = 'jwbs-sync-notice__actions';
    details.appendChild(actions);
    const feedback = document.createElement('p'); feedback.className = 'jwbs-sync-notice__feedback';
    feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    details.appendChild(feedback); panel.appendChild(details);
    const view = { uid: model.uid, signature, panel, model, collapsed: remembered(model, signature), busy: false };
    current = view;
    function reflect() {
      details.hidden = view.collapsed;
      toggle.textContent = view.collapsed ? '자세히' : '접기';
      toggle.setAttribute('aria-expanded', String(!view.collapsed));
    }
    toggle.onclick = () => {
      if (current !== view || getUser()?.uid !== view.uid) return;
      view.collapsed = !view.collapsed;
      reflect();
      try { storage?.setItem(preferenceKey(view.uid), JSON.stringify({ identity: signature, collapsed: view.collapsed })); } catch {}
    };
    const buttons = [];
    for (const [index, action] of (model.actions || []).entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = action.label;
      button.onclick = async () => {
        if (current !== view || getUser()?.uid !== view.uid || view.busy) return;
        view.busy = true; buttons.forEach(item => { item.disabled = true; });
        panel.setAttribute('aria-busy', 'true'); feedback.textContent = '';
        try {
          const result = await view.model.actions[index].run();
          if (current === view && getUser()?.uid === view.uid && result?.status === 'offline') {
            feedback.textContent = '연결과 계정 확인 후 다시 시도해 주세요. 기기 기록은 유지됩니다.';
          }
        } catch {
          if (current === view && getUser()?.uid === view.uid) feedback.textContent = '완료하지 못했습니다. 기기 기록은 유지됩니다. 다시 시도할 수 있습니다.';
        } finally {
          if (current === view) {
            view.busy = false; buttons.forEach(item => { item.disabled = false; });
            panel.setAttribute('aria-busy', 'false');
          }
        }
      };
      buttons.push(button); actions.appendChild(button);
    }
    reflect(); place(panel);
  }
  return { show, clear };
}
