// Notion API との変換・通信。トークンは env.NOTION_TOKEN（Cloudflare の秘密設定）からだけ読む。

const NOTION_VERSION = '2025-09-03';
const API = 'https://api.notion.com/v1';

export const STATUSES = ['予定', '確定', '変更', '完了', '中止'];

export class NotionError extends Error {
  constructor(status, body) {
    super(`Notion API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

export function createClient(env, fetchImpl = fetch) {
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new NotionError(res.status, data);
    return data;
  };
  const ds = env.NOTION_DATA_SOURCE_ID;

  return {
    getSchema: () => call('GET', `/data_sources/${ds}`),
    listUsers: () => call('GET', '/users?page_size=100'),
    async query(filter) {
      const results = [];
      let cursor;
      do {
        const page = await call('POST', `/data_sources/${ds}/query`, {
          filter,
          sorts: [{ property: '搬入日', direction: 'ascending' }],
          page_size: 100,
          start_cursor: cursor,
        });
        results.push(...page.results);
        cursor = page.has_more ? page.next_cursor : undefined;
      } while (cursor);
      return results.map(fromPage);
    },
    getPage: async (id) => fromPage(await call('GET', `/pages/${id}`)),
    create: async (props) =>
      fromPage(await call('POST', '/pages', { parent: { type: 'data_source_id', data_source_id: ds }, properties: props })),
    update: async (id, props) => fromPage(await call('PATCH', `/pages/${id}`, { properties: props })),
  };
}

const plain = (rich) => (rich ?? []).map((r) => r.plain_text ?? r.text?.content ?? '').join('');

// Notion のページ → アプリで使う形
export function fromPage(page) {
  const p = page.properties ?? {};
  return {
    id: page.id,
    url: page.url,
    title: plain(p['件名']?.title),
    site: p['現場名']?.select?.name ?? '',
    start: p['搬入日']?.date?.start ?? '',
    item: plain(p['搬入品目']?.rich_text),
    vendor: plain(p['業者名']?.rich_text),
    vehicle: plain(p['車両']?.rich_text),
    phone: p['連絡先']?.phone_number ?? '',
    gate: p['搬入口・経路']?.select?.name ?? '',
    attendees: (p['立会担当']?.people ?? []).map((u) => ({ id: u.id, name: u.name ?? '' })),
    status: p['ステータス']?.status?.name ?? '',
    memo: plain(p['備考']?.rich_text),
  };
}

const text = (s) => ({ rich_text: s ? [{ text: { content: String(s).slice(0, 2000) } }] : [] });
const select = (s) => ({ select: s ? { name: String(s).replaceAll(',', '、').slice(0, 100) } : null });

// アプリの入力 → Notion のプロパティ（渡された項目だけ変換。変更時に一部だけ送れる）
export function toProperties(input) {
  const props = {};
  if ('title' in input) props['件名'] = { title: [{ text: { content: String(input.title).slice(0, 2000) } }] };
  if ('site' in input) props['現場名'] = select(input.site);
  if ('start' in input) props['搬入日'] = { date: input.start ? { start: input.start } : null };
  if ('item' in input) props['搬入品目'] = text(input.item);
  if ('vendor' in input) props['業者名'] = text(input.vendor);
  if ('vehicle' in input) props['車両'] = text(input.vehicle);
  if ('phone' in input) props['連絡先'] = { phone_number: input.phone || null };
  if ('gate' in input) props['搬入口・経路'] = select(input.gate);
  if ('attendees' in input) props['立会担当'] = { people: (input.attendees ?? []).map((id) => ({ id })) };
  if ('status' in input) props['ステータス'] = { status: { name: input.status } };
  if ('memo' in input) props['備考'] = text(input.memo);
  return props;
}

// 重複チェック用：同じ現場で、開始時刻の前後1日以内の搬入を取ってくる（細かい判定は duplicates.js）
export function nearbyFilter(site, start) {
  const at = Date.parse(start);
  const day = 24 * 60 * 60 * 1000;
  return {
    and: [
      { property: '現場名', select: { equals: site } },
      { property: '搬入日', date: { on_or_after: new Date(at - day).toISOString() } },
      { property: '搬入日', date: { on_or_before: new Date(at + day).toISOString() } },
    ],
  };
}

export function rangeFilter(from, to) {
  return {
    and: [
      { property: '搬入日', date: { on_or_after: from } },
      { property: '搬入日', date: { on_or_before: to } },
    ],
  };
}
