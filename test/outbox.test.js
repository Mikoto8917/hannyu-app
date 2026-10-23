import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox, sendDelivery, sendEntry } from '../public/outbox.js';

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};
const entry = (id, state = 'pending') => ({ payload: { clientId: id, title: id }, state });

test('同じ送信IDは上書きされ、1件のまま', () => {
  const box = createOutbox(memoryStorage());
  box.put(entry('a', 'sending'));
  box.put(entry('a', 'pending'));
  assert.equal(box.list().length, 1);
  assert.equal(box.list()[0].state, 'pending');
});

test('送れたものは消え、重複は確認待ちで残る', async () => {
  const box = createOutbox(memoryStorage());
  box.put(entry('ok'));
  box.put(entry('dup'));
  await box.flush(async (e) => (e.payload.clientId === 'ok' ? { kind: 'ok' } : { kind: 'duplicate', duplicates: [{ id: 'x' }] }));
  assert.deepEqual(box.list().map((e) => [e.payload.clientId, e.state]), [['dup', 'conflict']]);
});

test('まだつながらなければ、そこで止めて全部残す', async () => {
  const box = createOutbox(memoryStorage());
  box.put(entry('a'));
  box.put(entry('b'));
  let calls = 0;
  await box.flush(async () => {
    calls += 1;
    return { kind: 'retry' };
  });
  assert.equal(calls, 1);
  assert.equal(box.list().length, 2);
});

test('保存領域が壊れていても空として扱う', () => {
  const storage = memoryStorage();
  storage.setItem('hannyu.outbox.v1', '{壊れた');
  assert.deepEqual(createOutbox(storage).list(), []);
});

test('通信エラーは再送扱い', async () => {
  const r = await sendDelivery({}, async () => {
    throw new TypeError('offline');
  });
  assert.equal(r.kind, 'retry');
});

test('応答コードごとに結果を分ける', async () => {
  const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });
  assert.equal((await sendDelivery({}, reply(201, { delivery: {} }))).kind, 'ok');
  assert.equal((await sendDelivery({}, reply(200, { delivery: {}, replayed: true }))).kind, 'ok');
  assert.equal((await sendDelivery({}, reply(409, { duplicates: [] }))).kind, 'duplicate');
  assert.equal((await sendDelivery({}, reply(400, { error: 'x' }))).kind, 'invalid');
  assert.equal((await sendDelivery({}, reply(503, { retry: true }))).kind, 'retry');
  assert.equal((await sendDelivery({}, reply(429, {}))).kind, 'retry');
});

test('変更はPATCHで送り、見つからなければ再送しない', async () => {
  const seen = [];
  const fake = async (url, init) => {
    seen.push([url, init.method, JSON.parse(init.body)]);
    return new Response('{}', { status: 404 });
  };
  const r = await sendEntry({ kind: 'update', payload: { clientId: 'u', id: 'p1', changes: { status: '完了' } } }, fake);
  assert.equal(r.kind, 'invalid');
  assert.deepEqual(seen[0].slice(0, 2), ['/api/deliveries/p1', 'PATCH']);
  assert.equal(seen[0][2].status, '完了');
});

test('種類のない古い記録は新規登録として扱う', () => {
  const box = createOutbox(memoryStorage());
  box.put(entry('a'));
  assert.equal(box.list()[0].kind, 'create');
});
