import { createOfflineSync } from './offline_sync.js';

const clone = value => JSON.parse(JSON.stringify(value));
// JSON 저장 의미와 배열 순서를 유지하고 객체 속성 순서는 무시한다.
const dataSignature = value => JSON.stringify(value, (_key, item) => {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  }
  return item;
});
export function createIndexedArchive(indexedDB) {
  let database;
  function open() {
    if (!indexedDB) return Promise.reject(new Error('IndexedDB 원본 보존 저장소가 필요합니다.'));
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('jwbs-offline-archive-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('원본 보존 저장소가 다른 창에서 차단되었습니다.'));
    });
    return database;
  }
  return {
    async list(prefix) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const rows = [];
        const transaction = db.transaction('snapshots', 'readonly');
        const request = transaction.objectStore('snapshots').openCursor();
        request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (String(cursor.key).startsWith(prefix)) rows.push({ key: cursor.key, value: cursor.value }); cursor.continue(); };
        transaction.oncomplete = () => resolve(rows);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    },
    async put(key, value) {
      const db = await open();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('snapshots', 'readwrite', { durability: 'strict' });
        transaction.objectStore('snapshots').add(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('원본 보존 실패'));
        transaction.onabort = () => reject(transaction.error || new Error('원본 보존 중단'));
      });
    },
  };
}

export function createApprovalCache(storage) {
  const key = uid => `jwbs_offline_approval_v1:${encodeURIComponent(uid)}`;
  return {
    record(user, approved) {
      if (!user?.uid || !user?.email) return;
      if (!approved) { storage.removeItem(key(user.uid)); return; }
      const value = JSON.stringify({ uid: user.uid, email: user.email, approved: true });
      storage.setItem(key(user.uid), value);
      if (storage.getItem(key(user.uid)) !== value) throw new Error('오프라인 승인 확인 기록을 저장하지 못했습니다.');
    },
    allows(user) {
      if (!user?.uid || !user?.email) return false;
      try {
        const value = JSON.parse(storage.getItem(key(user.uid)) || 'null');
        return value?.approved === true && value.uid === user.uid && value.email === user.email;
      } catch { return false; }
    },
  };
}

export function createOfflineApp({ storage, archive, locks, readRemote, commitRemote, getUser, getData, applyData, isOnline, onStatus = () => {}, onConflict = () => {}, onReviewed = () => {}, onNoticeCleared = () => {}, onError = () => {}, events = null }) {
  const engine = createOfflineSync({ storage, archive, locks, readRemote, commitRemote });
  const approvals = createApprovalCache(storage);
  let view = null;
  let activeUid = null;
  let authorized = false;
  let serverAuthorized = false;
  let staged = Promise.resolve();
  let stageFailed = false;
  function applyChanged(state) {
    if (!state) return;
    const changed = dataSignature(view) !== dataSignature(state.data);
    view = clone(state.data);
    if (changed) applyData(clone(state.data), state);
  }
  function updateNotice(state) {
    if (state?.conflicts?.length) onConflict(state.conflicts, state);
    else if (state?.reviewedHold) onReviewed(state);
    else onNoticeCleared(state);
  }
  function activate(user) {
    const nextUid = user?.uid || null;
    if (nextUid !== activeUid) onNoticeCleared({ uid: nextUid, reason: 'account-change' });
    activeUid = nextUid;
    authorized = false;
    serverAuthorized = false;
    view = null;
    staged = Promise.resolve();
    stageFailed = false;
  }
  function current(uid) { return authorized && activeUid === uid && getUser()?.uid === uid; }
  function authorize(user) {
    if (activeUid !== user?.uid || !approvals.allows(user)) return false;
    authorized = true;
    serverAuthorized = true;
    return true;
  }
  function restore(user, { offline = false } = {}) {
    if (!user?.uid || getUser()?.uid !== user.uid || !approvals.allows(user)) return false;
    const state = engine.load(user.uid);
    if (!state) return false;
    const confirmed = !offline && serverAuthorized && activeUid === user.uid;
    activate(user);
    authorized = true;
    serverAuthorized = confirmed;
    view = clone(state.data);
    applyData(clone(state.data), state);
    onStatus(state.conflicts?.length ? 'conflict' : state.pending ? 'local' : offline ? 'offline' : 'saved');
    updateNotice(state);
    return true;
  }
  function stage({ base, resetBase = false } = {}) {
    const user = getUser();
    if (!user?.uid || !current(user.uid)) throw new Error('현재 계정을 먼저 확인해야 합니다.');
    const data = clone(getData());
    if (!resetBase && !stageFailed && view !== null && engine.load(user.uid)
        && dataSignature(data) === dataSignature(view)) {
      // 앞선 원본 보존 실패는 성공으로 바꾸지 않는다. 진행 중 stage도 먼저 기다린다.
      return staged.then(() => engine.load(user.uid));
    }
    const promise = engine.stage(user.uid, data, { base, editBase: view ?? base, resetBase });
    view = clone(data);
    staged = Promise.all([staged.catch(() => {}), promise]).then(() => { stageFailed = false; }, error => { stageFailed = true; throw error; });
    promise.then(() => { if (current(user.uid)) onStatus('local'); }, error => { if (current(user.uid)) { onStatus('error'); onError(error); } });
    return promise;
  }
  async function seed(user, data, base) {
    if (getUser()?.uid !== user?.uid) throw new Error('계정이 변경되어 이전 계정의 로드를 중지했습니다.');
    if (!approvals.allows(user)) throw new Error('서버 승인 확인이 필요합니다.');
    activate(user);
    authorized = true;
    serverAuthorized = true;
    view = clone(base);
    applyData(clone(data), { base, data, pending: true, revision: Number(base.syncRevision || 0) });
    await stage({ base, resetBase: true });
    return isOnline() ? flush() : { status: 'pending', state: engine.load(user.uid) };
  }
  async function flush(options) {
    const user = getUser();
    if (!user?.uid || !current(user.uid) || !serverAuthorized || !isOnline()) return { status: 'offline' };
    await staged;
    if (!current(user.uid) || !serverAuthorized || !isOnline()) return { status: 'offline' };
    const start = engine.load(user.uid);
    if (!start?.pending) { applyChanged(start); updateNotice(start); return { status: 'idle', state: start }; }
    if (start.conflicts?.length || (start.reviewedHold && !options?.confirmReviewed)) {
      applyChanged(start);
      onStatus(start.conflicts?.length ? 'conflict' : 'local');
      updateNotice(start);
      return { status: start.conflicts?.length ? 'conflict' : 'reviewed', state: start, conflicts: start.conflicts };
    }
    onStatus('saving');
    try {
      const result = await engine.flush(user.uid, options);
      if (current(user.uid)) {
        const latest = engine.load(user.uid);
        applyChanged(latest);
        onStatus(result.status === 'conflict' ? 'conflict' : latest?.pending ? 'local' : 'saved');
        updateNotice(latest);
      }
      return result;
    } catch (error) {
      if (current(user.uid)) { onStatus('error'); onError(error); }
      throw error;
    }
  }
  const retry = () => { if (isOnline()) flush().catch(() => {}); };
  events?.addEventListener('storage', event => {
    if (event.key?.startsWith(`jwbs_offline_v1:${encodeURIComponent(activeUid || '')}`)) {
      const user = getUser();
      if (!user?.uid || !current(user.uid)) return;
      const state = engine.load(user.uid);
      if (state) {
        applyChanged(state);
        onStatus(state.conflicts?.length ? 'conflict' : state.pending ? 'local' : 'saved');
        updateNotice(state);
      }
    }
  });
  async function exportBundle() {
    const user = getUser();
    if (!user?.uid || !current(user.uid)) throw new Error('현재 계정 확인이 필요합니다.');
    return { schema: 'jwbs-offline-recovery-v1', uid: user.uid, exportedAt: Date.now(), state: engine.load(user.uid), archives: await archive.list(`jwbs_offline_v1:${encodeURIComponent(user.uid)}:`) };
  }
  async function recheckConflicts() {
    const uid = getUser()?.uid;
    const assertCurrent = () => {
      if (!uid || !current(uid) || !serverAuthorized || !isOnline()) throw new Error('현재 계정의 온라인 승인 확인이 필요합니다.');
    };
    assertCurrent();
    await staged;
    assertCurrent();
    const result = await engine.recheck(uid, { assertCurrent });
    assertCurrent();
    applyChanged(result.state);
    onStatus(result.state?.conflicts?.length ? 'conflict' : 'local');
    updateNotice(result.state);
    return result;
  }
  return { engine, approvals, activate, authorize, restore, stage, seed, flush, retry, exportBundle, recheckConflicts };
}
