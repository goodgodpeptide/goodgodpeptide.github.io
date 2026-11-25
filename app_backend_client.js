// 비밀키 없이 현재 Firebase 사용자 토큰만 요청에 사용한다. 토큰은 저장하지 않는다.
export function createAppBackendClient({ baseUrl, getUser, getOwner, isCurrent, fetchImpl = globalThis.fetch }) {
  async function analyze(payload, { signal } = {}) {
    const owner = getOwner(), user = getUser();
    const check = () => {
      if (signal?.aborted) throw new DOMException('요청을 취소했습니다.', 'AbortError');
      if (!user?.uid || getUser()?.uid !== user.uid || !isCurrent(owner)) throw new Error('계정이 변경되어 이전 분석을 중단했습니다.');
    };
    check();
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await user.getIdToken(attempt === 1);
      check();
      const response = await fetchImpl(baseUrl + '/weight_analysis', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: typeof payload === 'string' ? payload : JSON.stringify(payload), signal,
      });
      check();
      // 401은 분석 실행 전 거부다. 유료 분석의 네트워크 오류/5xx는 자동 재시도하지 않는다.
      if (response.status === 401 && attempt === 0) continue;
      const result = await response.json();
      check();
      return response.status < 200 || response.status >= 300 ? { ...result, ok: false } : result;
    }
  }
  return { analyze };
}
