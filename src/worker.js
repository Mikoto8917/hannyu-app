// 中継役（Cloudflare Worker）。画面ファイルの配信と /api/* の処理を受け持つ。
// Notion のデータを削除する処理は作らない（取りやめはステータス「中止」）。

import { createClient, toProperties, nearbyFilter, rangeFilter, STATUSES, NotionError } from './notion.js';
import { findDuplicates } from './duplicates.js';

const EDITABLE = ['title', 'site', 'start', 'item', 'vendor', 'vehicle', 'phone', 'gate', 'attendees', 'status', 'memo'];
const MAX_RANGE_DAYS = 31;
const SUBMISSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });

class BadRequest extends Error {}

function pick(body) {
  const out = {};
  for (const key of EDITABLE) if (key in body) out[key] = body[key];
  return out;
}

function validate(input, { creating }) {
  if (creating) {
    if (!input.title?.trim()) throw new BadRequest('件名を入れてください');
    if (!input.site?.trim()) throw new BadRequest('現場名を選んでください');
    if (!input.start) throw new BadRequest('搬入日時を入れてください');
  }
  if ('start' in input && Number.isNaN(Date.parse(input.start))) throw new BadRequest('搬入日時の形式が正しくありません');
  if ('status' in input && !STATUSES.includes(input.status)) throw new BadRequest('ステータスが正しくありません');
  if ('attendees' in input && !Array.isArray(input.attendees)) throw new BadRequest('立会担当の形式が正しくありません');
}

async function readBody(request) {
  try {
    const body = await request.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {}
  throw new BadRequest('送信内容を読み取れませんでした');
}

async function duplicatesFor(notion, candidate, ignoreId) {
  if (!candidate.site || !candidate.gate || !candidate.start) return [];
  const nearby = await notion.query(nearbyFilter(candidate.site, candidate.start));
  return findDuplicates(candidate, nearby, { ignoreId });
}

async function handleOptions(notion) {
  const [schema, users] = await Promise.all([notion.getSchema(), notion.listUsers().catch(() => ({ results: [] }))]);
  const props = schema.properties ?? {};
  const names = (prop) => (prop?.select?.options ?? []).map((o) => o.name);
  return json(200, {
    sites: names(props['現場名']),
    gates: names(props['搬入口・経路']),
    statuses: STATUSES,
    users: (users.results ?? []).filter((u) => u.type === 'person').map((u) => ({ id: u.id, name: u.name ?? '' })),
  });
}

async function handleList(notion, url) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) throw new BadRequest('期間の指定が正しくありません');
  if (b - a > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) throw new BadRequest(`期間は${MAX_RANGE_DAYS}日以内にしてください`);
  const deliveries = await notion.query(rangeFilter(from, to));
  return json(200, { deliveries, fetchedAt: new Date().toISOString() });
}

async function handleCreate(notion, env, request) {
  const body = await readBody(request);
  const clientId = typeof body.clientId === 'string' ? body.clientId.slice(0, 64) : '';
  if (!clientId) throw new BadRequest('送信IDがありません');

  // 再送で同じ登録が二重にできないよう、送信IDごとに結果を覚えておく
  const remembered = await env.SUBMISSIONS?.get(clientId, 'json');
  if (remembered) return json(200, { delivery: remembered, replayed: true });

  const input = pick(body);
  if (!('status' in input)) input.status = '予定';
  validate(input, { creating: true });

  // 送信IDの記録（KV）がない環境でも、まったく同じ内容が既にあれば再送とみなす
  if (!env.SUBMISSIONS) {
    const nearby = await notion.query(nearbyFilter(input.site, input.start));
    const same = nearby.find(
      (d) => d.title === input.title && d.site === input.site && Date.parse(d.start) === Date.parse(input.start),
    );
    if (same) return json(200, { delivery: same, replayed: true });
  }

  if (!body.force) {
    const duplicates = await duplicatesFor(notion, input);
    if (duplicates.length) return json(409, { duplicates });
  }

  const delivery = await notion.create(toProperties(input));
  await env.SUBMISSIONS?.put(clientId, JSON.stringify(delivery), { expirationTtl: SUBMISSION_TTL_SECONDS });
  return json(201, { delivery });
}

async function handleUpdate(notion, request, id) {
  const body = await readBody(request);
  const input = pick(body);
  if (!Object.keys(input).length) throw new BadRequest('変更する項目がありません');
  validate(input, { creating: false });

  if (!body.force && ('start' in input || 'site' in input || 'gate' in input)) {
    const current = await notion.getPage(id);
    const duplicates = await duplicatesFor(notion, { ...current, ...input }, id);
    if (duplicates.length) return json(409, { duplicates });
  }

  const delivery = await notion.update(id, toProperties(input));
  return json(200, { delivery });
}

async function handleApi(request, env, url) {
  if (env.RATE_LIMITER) {
    const key = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const { success } = await env.RATE_LIMITER.limit({ key });
    if (!success) return json(429, { error: 'アクセスが多すぎます。少し待ってからやり直してください' });
  }

  const notion = createClient(env);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const idMatch = path.match(/^\/api\/deliveries\/([0-9a-f-]{32,36})$/i);

  try {
    if (path === '/api/options' && method === 'GET') return await handleOptions(notion);
    if (path === '/api/deliveries' && method === 'GET') return await handleList(notion, url);
    if (path === '/api/deliveries' && method === 'POST') return await handleCreate(notion, env, request);
    if (idMatch && method === 'PATCH') return await handleUpdate(notion, request, idMatch[1]);
    if (path === '/api/deliveries' || idMatch) return json(405, { error: 'この操作はできません' });
    return json(404, { error: '見つかりません' });
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: err.message });
    if (err instanceof NotionError) {
      if (err.status === 429) return json(503, { error: 'Notionが混み合っています。少し待ってから再送します', retry: true });
      if (err.status === 404) return json(404, { error: '対象の搬入が見つかりません' });
      console.error('notion', err.status, err.body?.code);
      return json(502, { error: 'Notionとの通信に失敗しました', retry: err.status >= 500 });
    }
    console.error('unexpected', err?.message);
    return json(500, { error: '予期しないエラーが起きました', retry: true });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
