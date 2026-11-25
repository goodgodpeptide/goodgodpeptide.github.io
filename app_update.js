// 공개 앱 파일의 설치 상태만 검사한다. 개인 기록 저장소에는 접근하지 않는다.
function bounded(promise, milliseconds) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('응답 대기 시간이 지났습니다.')), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

export function readWorkerStatus(worker, timeoutMs = 1000, Channel = globalThis.MessageChannel) {
  return new Promise((resolve, reject) => {
    const channel = new Channel();
    let timer;
    const finish = (error, value) => {
      clearTimeout(timer); channel.port1.close(); channel.port2.close();
      if (error) reject(error); else resolve(value);
    };
    timer = setTimeout(() => finish(new Error('앱 파일 상태 응답이 없습니다.')), timeoutMs);
    channel.port1.onmessage = event => finish(null, event.data);
    try { worker.postMessage({ type: 'OFFLINE_CACHE_STATUS' }, [channel.port2]); }
    catch (error) { finish(error); }
  });
}

export async function recoverApp({
  serviceWorker = globalThis.navigator?.serviceWorker,
  fetchImpl = globalThis.fetch,
  onProgress = () => {},
  redirect = url => globalThis.location.replace(url),
  requestStatus = readWorkerStatus,
  now = () => Date.now(),
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  timeoutMs = 25000,
  pollMs = 200,
} = {}) {
  const started = now();
  const remaining = () => Math.max(0, timeoutMs - (now() - started));
  const checked = promise => bounded(promise, Math.max(1, remaining()));
  try {
    if (!serviceWorker?.register || !fetchImpl) throw new Error('이 브라우저에서 앱 업데이트를 확인할 수 없습니다.');
    onProgress('최신 앱 파일 정보를 확인하고 있습니다.');
    const response = await checked(fetchImpl(`./offline_build.json?check=${now()}`, { cache: 'no-store' }));
    if (!response.ok) throw new Error('최신 앱 파일 정보를 받지 못했습니다.');
    const manifest = await checked(response.json());
    const expectedHash = manifest?.assets?.['./index.html']?.sha256;
    if (typeof manifest?.version !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(manifest.version)
        || typeof expectedHash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(expectedHash)) {
      throw new Error('앱 파일 확인 정보의 형식이 올바르지 않습니다.');
    }
    onProgress('최신 앱 파일을 설치하고 확인하고 있습니다. 기록 원본은 유지됩니다.');
    const registration = await checked(serviceWorker.register(`./sw.js?build=${encodeURIComponent(manifest.version)}`, { updateViaCache: 'none' }));
    await checked(registration.update());
    while (remaining() > 0) {
      // active여도 clients.claim 전에는 현재 페이지가 옛 worker에 제어될 수 있다.
      // 실제 navigation을 처리할 현재 controller가 검증된 경우에만 이동한다.
      const workers = [serviceWorker.controller].filter(Boolean);
      for (const worker of workers) {
        if (remaining() <= 0) break;
        let status;
        try { status = await checked(requestStatus(worker, Math.min(1000, remaining()))); }
        catch { continue; }
        if (remaining() <= 0) break;
        if (serviceWorker.controller === worker && status?.ready === true && status.version === manifest.version
            && typeof status.indexSha256 === 'string'
            && status.indexSha256.toLowerCase() === expectedHash.toLowerCase()) {
          const url = `./?updated=${encodeURIComponent(manifest.version)}`;
          onProgress('최신 앱 파일을 확인했습니다. 앱을 엽니다.');
          redirect(url);
          return { ok: true, version: manifest.version, url };
        }
      }
      if (remaining() > 0) await wait(Math.min(pollMs, remaining()));
    }
    throw new Error('최신 앱 파일 설치를 아직 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  } catch (error) {
    const message = error instanceof Error ? error.message : '업데이트를 확인하지 못했습니다.';
    onProgress(message);
    return { ok: false, error: message };
  }
}
