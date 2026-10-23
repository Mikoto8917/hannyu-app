// 本物のNotionには接続せず、偽のNotion（メモリ上）で中継役の動きを確かめる。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

let pages;
let calls;

function notionPage(id, props) {
  return {
    id,
    url: `https://www.notion.so/${id}`,
    properties: {
      件名: { title: props['件名'].title.map((t) => ({ plain_text: t.text.content })) },
      現場名: { select: props['現場名']?.select ?? null },
      搬入日: { date: props['搬入日']?.date ?? null },
      搬入口・経路: { select: props['搬入口・経路']?.select ?? null },
      ステータス: { status: props['ステータス']?.status ?? null },
      立会担当: { people: [] },
    },
  };
}

function fakeNotion(url, init) {
  calls.push({ url, method: init.method });
  const body = init.body ? JSON.parse(init.body) : {};
  const ok = (data) => new Response(JSON.stringify(data), { status: 200 });
  if (url.endsWith('/query')) return ok({ results: [...pages.values()], has_more: false });
  if (url.endsWith('/pages') && init.method === 'POST') {
    const id = `0000000000000000000000000000000${pages.size + 1}`;
    pages.set(id, notionPage(id, body.properties));
    return ok(pages.get(id));
  }
  const m = url.match(/\/pages\/(\w+)$/);
  if (m && init.method === 'GET') return ok(pages.get(m[1]));
  if (m && init.method === 'PATCH') {
    const page = pages.get(m[1]);
    if (body.properties['ステータス']) page.properties['ステータス'] = body.properties['ステータス'];
    if (body.properties['搬入日']) page.properties['搬入日'] = body.properties['搬入日'];
    return ok(page);
  }
  return new Response('{}', { status: 404 });
}

const kv = () => {
  const m = new Map();
  return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), put: async (k, v) => m.set(k, v) };
};
let env;

beforeEach(() => {
  pages = new Map();
  calls = [];
  globalThis.fetch = async (url, init) => fakeNotion(url, init);
  env = { NOTION_TOKEN: 'test', NOTION_DATA_SOURCE_ID: 'ds', SUBMISSIONS: kv() };
});

const req = (method, path, body) =>
  worker.fetch(
    new Request(`https://example.com${path}`, { method, body: body ? JSON.stringify(body) : undefined }),
    env,
  );

const entry = (extra = {}) => ({
  clientId: 'c1',
  title: '業者A／鉄筋',
  site: '○○ビル現場',
  gate: '北搬入口',
  start: '2026-10-24T08:30:00+09:00',
  ...extra,
});

test('新規登録できる（ステータスの初期値は予定）', async () => {
  const res = await req('POST', '/api/deliveries', entry());
  assert.equal(res.status, 201);
  const { delivery } = await res.json();
  assert.equal(delivery.status, '予定');
  assert.equal(pages.size, 1);
});

test('同じ送信IDの再送では二重登録しない', async () => {
  await req('POST', '/api/deliveries', entry());
  const res = await req('POST', '/api/deliveries', entry());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).replayed, true);
  assert.equal(pages.size, 1);
});

test('KVがなくても、同じ内容の再送は二重登録しない', async () => {
  delete env.SUBMISSIONS;
  await req('POST', '/api/deliveries', entry());
  const res = await req('POST', '/api/deliveries', entry());
  assert.equal(res.status, 200);
  assert.equal(pages.size, 1);
});

test('近い時間の搬入があれば409で知らせ、force で登録できる', async () => {
  await req('POST', '/api/deliveries', entry());
  const dup = await req('POST', '/api/deliveries', entry({ clientId: 'c2', start: '2026-10-24T08:40:00+09:00' }));
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).duplicates.length, 1);
  assert.equal(pages.size, 1);
  const forced = await req('POST', '/api/deliveries', entry({ clientId: 'c2', start: '2026-10-24T08:40:00+09:00', force: true }));
  assert.equal(forced.status, 201);
  assert.equal(pages.size, 2);
});

test('必須項目がなければ400', async () => {
  const res = await req('POST', '/api/deliveries', entry({ title: '' }));
  assert.equal(res.status, 400);
});

test('ステータスを変更できる', async () => {
  const created = await (await req('POST', '/api/deliveries', entry())).json();
  const res = await req('PATCH', `/api/deliveries/${created.delivery.id}`, { status: '確定' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).delivery.status, '確定');
});

test('不正なステータスは400', async () => {
  const created = await (await req('POST', '/api/deliveries', entry())).json();
  const res = await req('PATCH', `/api/deliveries/${created.delivery.id}`, { status: '削除' });
  assert.equal(res.status, 400);
});

test('削除の操作は受け付けない', async () => {
  const created = await (await req('POST', '/api/deliveries', entry())).json();
  const res = await req('DELETE', `/api/deliveries/${created.delivery.id}`);
  assert.equal(res.status, 405);
  assert.equal(pages.size, 1);
  assert.ok(!calls.some((c) => c.method === 'DELETE'));
});

test('一覧は期間が31日を超えると400', async () => {
  const res = await req('GET', '/api/deliveries?from=2026-10-01T00:00:00%2B09:00&to=2026-12-01T00:00:00%2B09:00');
  assert.equal(res.status, 400);
});

test('一覧を取得できる', async () => {
  await req('POST', '/api/deliveries', entry());
  const res = await req('GET', '/api/deliveries?from=2026-10-24T00:00:00%2B09:00&to=2026-10-24T23:59:59%2B09:00');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).deliveries.length, 1);
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});

test('アクセスが多すぎると429', async () => {
  env.RATE_LIMITER = { limit: async () => ({ success: false }) };
  const res = await req('GET', '/api/options');
  assert.equal(res.status, 429);
});

test('Notionが混雑(429)なら503と再送の合図を返す', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 429 });
  const res = await req('POST', '/api/deliveries', entry());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).retry, true);
});
