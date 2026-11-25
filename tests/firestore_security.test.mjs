import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, setDoc, getDoc, getDocs, updateDoc } from 'firebase/firestore';

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
let environment;
before(async () => {
  environment = await initializeTestEnvironment({ projectId: 'demo-weight-security', firestore: {
    host, port: Number(port), rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  } });
  await environment.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'config/admins'), { emails: ['admin@example.test'] });
    await setDoc(doc(db, 'config/approved_users'), { emails: ['admin@example.test', 'approved@example.test'] });
    await setDoc(doc(db, 'config/rejected_users'), { 'rejected@example.test': 123 });
    await setDoc(doc(db, 'config/future_private_config'), { privateValue: 'admin only' });
    await setDoc(doc(db, 'posts/another-user-post'), { uid: 'another', content: 'original', likes: ['another'] });
  });
});
after(async () => environment?.cleanup());
const dbFor = (uid, email, email_verified = true) => environment.authenticatedContext(uid, { email, email_verified }).firestore();

test('미승인 로그인은 현재 로그인에 필요한 권한 문서 두 개만 읽고 거절목록·기타설정·전체목록은 읽지 못한다', async () => {
  const db = dbFor('pending', 'pending@example.test');
  for (const name of ['admins', 'approved_users']) await assertSucceeds(getDoc(doc(db, 'config', name)));
  for (const name of ['rejected_users', 'future_private_config']) await assertFails(getDoc(doc(db, 'config', name)));
  await assertFails(getDocs(collection(db, 'config')));
});

test('검증된 관리자는 거절목록·기타설정·목록을 읽고 설정을 갱신할 수 있다', async () => {
  const db = dbFor('admin', 'admin@example.test');
  await assertSucceeds(getDoc(doc(db, 'config/rejected_users')));
  const snapshot = await assertSucceeds(getDocs(collection(db, 'config')));
  assert.equal(snapshot.size, 4);
  await assertSucceeds(updateDoc(doc(db, 'config/future_private_config'), { privateValue: 'updated' }));
});

test('이메일 문자열만 관리자와 같은 미검증 계정은 관리자 권한을 얻지 못한다', async () => {
  const db = dbFor('unverified-admin-email', 'admin@example.test', false);
  await assertFails(updateDoc(doc(db, 'config/admins'), { emails: ['admin@example.test', 'attacker@example.test'] }));
  await assertFails(getDoc(doc(db, 'config/rejected_users')));
  await assertFails(getDocs(collection(db, 'config')));
  await assertFails(getDoc(doc(db, 'posts/another-user-post')));
});

test('승인된 이메일이어도 검증 claim이 없으면 승인 권한을 얻지 못한다', async () => {
  const db = environment.authenticatedContext('missing-verification', { email: 'approved@example.test' }).firestore();
  await assertFails(getDoc(doc(db, 'posts/another-user-post')));
});

test('게시물 좋아요는 내 UID 추가·취소만 허용하고 중복 배열·타인 조작은 거부한다', async () => {
  const db = dbFor('approved', 'approved@example.test'), ref = doc(db, 'posts/another-user-post');
  await assertSucceeds(updateDoc(ref, { likes: ['another', 'approved'] }));
  await assertFails(updateDoc(ref, { likes: ['another', ...Array(10000).fill('approved')] }));
  await assertFails(updateDoc(ref, { likes: ['approved'] }));
  await assertFails(updateDoc(ref, { likes: ['another', 'approved', 'fake'] }));
  await assertFails(updateDoc(ref, { likes: 'approved' }));
  await assertSucceeds(updateDoc(ref, { likes: ['another'] }));
  assert.deepEqual((await getDoc(ref)).data().likes, ['another']);
});

test('새 게시물은 좋아요 없는 상태만 허용하여 작성 단계에서도 중복·타인 좋아요를 막는다', async () => {
  const db = dbFor('approved', 'approved@example.test');
  await assertSucceeds(setDoc(doc(db, 'posts/new-normal'), { uid: 'approved', content: 'normal', likes: [] }));
  await assertFails(setDoc(doc(db, 'posts/new-duplicate'), { uid: 'approved', content: 'forged', likes: ['approved', 'approved'] }));
  await assertFails(setDoc(doc(db, 'posts/new-forged'), { uid: 'approved', content: 'forged', likes: ['another'] }));
});

test('일반 승인 계정과 비로그인은 관리자 설정을 바꾸지 못한다', async () => {
  await assertFails(updateDoc(doc(dbFor('approved', 'approved@example.test'), 'config/admins'), { emails: ['approved@example.test'] }));
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'config/approved_users')));
});
