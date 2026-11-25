// UI/Firebase 독립: 원본 보존과 서버 버전 검사는 어댑터 경계에서도 유지한다.
const copy = value => JSON.parse(JSON.stringify(value));
// 저장 가능한 JSON 값으로 비교하되 객체의 속성 삽입 순서는 변경으로 보지 않는다.
// 배열 순서와 JSON 직렬화의 undefined/NaN/toJSON 처리는 기존 기준을 유지한다.
const equal = (a, b) => {
  const left = JSON.stringify(a), right = JSON.stringify(b);
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  const same = (x, y) => {
    if (x === y) return true;
    if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') return false;
    if (Array.isArray(x) !== Array.isArray(y)) return false;
    if (Array.isArray(x)) return x.length === y.length && x.every((value, i) => same(value, y[i]));
    const keys = Object.keys(x);
    return keys.length === Object.keys(y).length
      && keys.every(key => Object.prototype.hasOwnProperty.call(y, key) && same(x[key], y[key]));
  };
  return same(JSON.parse(left), JSON.parse(right));
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const managed = key => key === 'updatedAt' || key === 'syncRevision';
const keyOf = row => {
  if (!object(row)) return null;
  if (row.id !== undefined && row.id !== null && row.id !== '') return JSON.stringify(['id', String(row.drug ?? ''), String(row.id)]);
  for (const key of ['date', 'dateKey', 'time', 'timestamp']) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return JSON.stringify([key, row[key]]);
  }
  return null;
};

export function mergeOfflineData(base, local, remote) {
  const conflicts = [];
  function merge(b, l, r, path) {
    if (equal(l, r)) return l;
    if (equal(l, b)) return r;
    if (equal(r, b)) return l;
    if (object(l) && object(r) && (object(b) || b === undefined)) {
      const result = {};
      for (const key of new Set([...Object.keys(b || {}), ...Object.keys(l), ...Object.keys(r)])) {
        if (path === '' && managed(key)) continue;
        const value = merge(b?.[key], l[key], r[key], path ? `${path}.${key}` : key);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    if (Array.isArray(l) && Array.isArray(r) && (Array.isArray(b) || b === undefined)) {
      const arrays = [b || [], l, r];
      const maps = arrays.map(rows => new Map(rows.map(row => [keyOf(row), row])));
      if (arrays.every((rows, i) => rows.every(row => keyOf(row) !== null) && maps[i].size === rows.length)) {
        const result = [];
        for (const key of new Set([...maps[2].keys(), ...maps[1].keys(), ...maps[0].keys()])) {
          const [bv, lv, rv] = maps.map(map => map.get(key));
          if (!equal(lv, bv) && !equal(rv, bv) && !equal(lv, rv)) {
            conflicts.push({ path: `${path}[${key}]`, base: bv, local: lv, remote: rv });
            if (lv !== undefined) result.push(lv);
            continue;
          }
          const value = merge(maps[0].get(key), maps[1].get(key), maps[2].get(key), `${path}[${key}]`);
          if (value !== undefined) result.push(value);
        }
        return result;
      }
    }
    conflicts.push({ path, base: b, local: l, remote: r });
    return l;
  }
  const strip = value => Object.fromEntries(Object.entries(value || {}).filter(([key]) => !managed(key)));
  return { data: copy(merge(strip(base), strip(local), strip(remote), '')), conflicts: copy(conflicts) };
}

export function createOfflineSync({ storage, readRemote, commitRemote, archive, locks, now = () => Date.now(), writerId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) }) {
  const flights = new Map();
  let sequence = 0;
  const key = uid => `jwbs_offline_v1:${encodeURIComponent(uid)}`;
  function checkUid(uid) { if (typeof uid !== 'string' || !uid) throw new Error('로그인 UID가 필요합니다.'); }
  function write(name, value) {
    const serialized = JSON.stringify(value);
    storage.setItem(name, serialized);
    if (storage.getItem(name) !== serialized) throw new Error('로컬 저장 확인에 실패했습니다.');
  }
  async function snapshot(uid, reason, value) {
    const name = `${key(uid)}:snapshot:${now()}:${writerId}:${sequence++}:${reason}`;
    if (!archive?.put) throw new Error('원본 보존 저장소를 사용할 수 없습니다.');
    await archive.put(name, copy(value));
  }
  function rawLoad(uid) {
    const raw = storage.getItem(key(uid));
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (value.uid !== uid || value.version !== 1 || !object(value.data) || !object(value.base)) throw new Error('로컬 동기화 데이터가 올바르지 않습니다.');
    return value;
  }
  function journals(uid) {
    const names = [];
    for (let i = 0; i < storage.length; i++) { const name = storage.key(i); if (name?.startsWith(`${key(uid)}:journal:`)) names.push(name); }
    names.sort((left, right) => {
      const a = left.split(':'), b = right.split(':');
      return Number(a.at(-3)) - Number(b.at(-3)) || a.at(-2).localeCompare(b.at(-2)) || Number(a.at(-1)) - Number(b.at(-1));
    });
    return names.map(name => ({ name, value: JSON.parse(storage.getItem(name)) }));
  }
  function load(uid, entries = journals(uid)) {
    checkUid(uid);
    let state = rawLoad(uid);
    for (const { value: entry } of entries) {
      if (entry.resetBase && state && !state.pending) state = null;
      if (!state) state = { version: 1, uid, base: entry.base, data: entry.editBase, revision: Number(entry.base.syncRevision || 0), generation: 0, conflicts: [], pending: false };
      const merged = mergeOfflineData(entry.editBase, entry.data, state.data);
      state = { ...state, data: merged.data, generation: state.generation + 1, pending: true, conflicts: [...(entry.resolveConflicts ? [] : state.conflicts || []), ...merged.conflicts] };
    }
    return state ? copy(state) : null;
  }
  async function locked(uid, callback) {
    if (!locks?.request) throw new Error('안전한 다중 창 저장 잠금을 사용할 수 없습니다.');
    return locks.request(key(uid), { mode: 'exclusive' }, callback);
  }
  async function persist(uid, state, entries = journals(uid)) {
    for (const entry of entries) await snapshot(uid, 'local-journal', entry.value);
    write(key(uid), state);
    for (const entry of entries) storage.removeItem(entry.name);
    return copy(state);
  }
  function stage(uid, data, { base, editBase, resolveConflicts = false, resetBase = false } = {}) {
    checkUid(uid);
    if (!object(data)) throw new Error('전체 앱 데이터가 필요합니다.');
    const previous = load(uid);
    if (!previous && !object(base)) throw new Error('서버에서 확인한 기준 데이터가 필요합니다.');
    const entry = { uid, base: copy(resetBase && !previous?.pending ? base : previous?.base ?? base), editBase: copy(editBase ?? previous?.data ?? base), data: copy(data), resolveConflicts, resetBase };
    // 잠금/IndexedDB 대기 전에 종료 복원 가능한 전체 payload를 동기로 보존한다.
    const name = `${key(uid)}:journal:${now()}:${writerId}:${sequence++}`;
    write(name, entry);
    return locked(uid, async () => {
      const before = rawLoad(uid);
      if (before) await snapshot(uid, 'before-stage', before);
      return persist(uid, load(uid));
    });
  }
  async function performFlush(uid, { confirmReviewed = false } = {}) {
    const start = load(uid);
    if (!start?.pending) return { status: 'idle', state: start };
    await persist(uid, start);
    if (start.conflicts?.length) return { status: 'conflict', conflicts: start.conflicts, state: start };
    if (start.reviewedHold && !confirmReviewed) return { status: 'reviewed', state: start };
    const remoteResult = await readRemote(uid);
    const remote = remoteResult?.data ?? remoteResult ?? {};
    const revision = remoteResult?.revision ?? Number(remote.syncRevision || 0);
    await snapshot(uid, 'remote-before-commit', remote);
    const merged = mergeOfflineData(start.base, start.data, remote);
    if (merged.conflicts.length) {
      await snapshot(uid, 'conflict', { base: start.base, local: start.data, remote, conflicts: merged.conflicts });
      const latest = load(uid);
      await persist(uid, { ...latest, conflicts: [...latest.conflicts || [], ...merged.conflicts] });
      return { status: 'conflict', conflicts: merged.conflicts, state: load(uid) };
    }
    const response = await commitRemote(uid, merged.data, revision);
    const committed = response?.data;
    const nextRevision = response?.revision ?? committed?.syncRevision;
    if (!object(committed) || !Number.isSafeInteger(nextRevision) || nextRevision <= revision) throw new Error('서버 저장 성공 응답이 올바르지 않습니다.');
    await snapshot(uid, 'committed', committed);
    const latestEntries = journals(uid);
    const latest = load(uid, latestEntries);
    if (latest.generation !== start.generation) {
      const rebased = mergeOfflineData(start.data, latest.data, committed);
      await snapshot(uid, 'during-commit', latest);
      if (rebased.conflicts.length) await snapshot(uid, 'during-commit-conflict', { local: latest.data, remote: committed, conflicts: rebased.conflicts });
      const state = { ...latest, base: copy(committed), revision: nextRevision, data: rebased.data, pending: true, conflicts: [...latest.conflicts || [], ...rebased.conflicts] };
      await persist(uid, state, latestEntries);
      return { status: state.conflicts.length ? 'conflict' : 'pending', conflicts: state.conflicts, state: copy(state) };
    }
    const state = { ...latest, base: copy(committed), data: copy(committed), revision: nextRevision, pending: false, conflicts: [], reviewedHold: false };
    await persist(uid, state, latestEntries);
    return { status: 'synced', state: copy(state) };
  }
  function flush(uid, options) {
    checkUid(uid);
    if (flights.has(uid)) return flights.get(uid);
    const flight = locked(uid, () => performFlush(uid, options)).finally(() => flights.delete(uid));
    flights.set(uid, flight);
    return flight;
  }
  function recheck(uid, { assertCurrent = () => {} } = {}) {
    checkUid(uid);
    return locked(uid, async () => {
      assertCurrent();
      const start = load(uid);
      if (!start?.conflicts?.length) return { status: 'idle', state: start, cleared: 0 };
      // 삭제/출처 불명은 추정하지 않는다. 세 원본이 모두 남은 값의 동등성만 재검토한다.
      const falseConflict = item => ['base', 'local', 'remote'].every(name => Object.prototype.hasOwnProperty.call(item, name))
        && keyOf(item.base) !== null && keyOf(item.base) === keyOf(item.local) && keyOf(item.base) === keyOf(item.remote)
        && typeof item.path === 'string' && item.path.endsWith(`[${keyOf(item.base)}]`)
        && (equal(item.local, item.remote) || equal(item.local, item.base) || equal(item.remote, item.base));
      await snapshot(uid, 'before-conflict-recheck', start);
      assertCurrent();
      const response = await readRemote(uid);
      assertCurrent();
      const remote = response?.data ?? response ?? {};
      const revision = response?.revision ?? Number(remote.syncRevision || 0);
      if (!object(remote) || !Number.isSafeInteger(revision) || revision < 0) throw new Error('재대조할 서버 기준이 올바르지 않습니다.');
      await snapshot(uid, 'conflict-recheck-remote', remote);
      assertCurrent();
      const latest = load(uid);
      if (latest.generation !== start.generation || !equal(latest, start)) return { status: 'changed', state: latest, cleared: 0 };
      const remaining = start.conflicts.filter(item => !falseConflict(item));
      const merged = mergeOfflineData(start.base, start.data, remote);
      const conflicts = [...remaining];
      for (const item of merged.conflicts) if (!conflicts.some(old => equal(old, item))) conflicts.push(item);
      const state = { ...start, base: copy(remote), revision, data: merged.data, pending: true, generation: start.generation + 1, conflicts, reviewedHold: true };
      await snapshot(uid, 'conflict-recheck-result', state);
      assertCurrent();
      // await 중 생긴 새 저널은 덮거나 지우지 않고 다시 대조하도록 남긴다.
      const final = load(uid);
      if (final.generation !== start.generation || !equal(final, start)) return { status: 'changed', state: final, cleared: 0 };
      if (journals(uid).length) return { status: 'changed', state: final, cleared: 0 };
      write(key(uid), state);
      return { status: conflicts.length ? 'conflict' : 'reviewed', state: copy(state), conflicts: copy(conflicts), cleared: start.conflicts.filter(falseConflict).length };
    });
  }
  return { load, stage, flush, recheck };
}
