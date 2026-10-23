// 一覧画面（今日・明日・今週を現場別に表示）。電波がないときは前回読み込んだ一覧を見せる。
import { $, store, hhmm, mdw, dayOf, todayJst, addDays, mondayOf, options } from './common.js';
import { outbox } from './sender.js';

const LIST_KEY = 'hannyu.list.v1';
const TAB_KEY = 'hannyu.tab.v1';
let cache = store.get(LIST_KEY, { deliveries: [], fetchedAt: null });
let range = store.get(TAB_KEY, 'today');

export const cachedList = () => cache.deliveries;
export const findCached = (id) => cache.deliveries.find((d) => d.id === id);

export function updateCached(delivery) {
  if (!delivery?.id) return;
  const i = cache.deliveries.findIndex((d) => d.id === delivery.id);
  if (i >= 0) cache.deliveries[i] = delivery;
  else cache.deliveries.push(delivery);
  store.set(LIST_KEY, cache);
}

function days() {
  const today = todayJst();
  const tomorrow = addDays(today, 1);
  const monday = mondayOf(today);
  return { today, tomorrow, monday, sunday: addDays(monday, 6) };
}

// 送信待ちの変更は画面に先に反映し、送信待ちの新規登録も一覧に出す
function withOutbox(list) {
  const pending = outbox.list();
  const byId = new Map(list.map((d) => [d.id, { ...d }]));
  for (const e of pending) {
    if (e.kind === 'update' && byId.has(e.payload.id)) Object.assign(byId.get(e.payload.id), e.payload.changes, { waiting: true });
  }
  const created = pending
    .filter((e) => e.kind === 'create')
    .map((e) => ({ ...e.payload, id: `local-${e.payload.clientId}`, waiting: true, local: true }));
  return [...byId.values(), ...created];
}

function inRange(d, { today, tomorrow, monday, sunday }) {
  const day = dayOf(d.start);
  if (range === 'today') return day === today;
  if (range === 'tomorrow') return day === tomorrow;
  return day >= monday && day <= sunday;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function card(d) {
  const article = el('article', `card${d.status === '中止' ? ' cancelled' : ''}`);
  const main = d.local ? el('div', 'card-main') : el('a', 'card-main');
  if (!d.local) main.href = `#/edit/${d.id}`;
  const top = el('div', 'card-top');
  const time = el('span', 'card-time', range === 'week' ? `${mdw(d.start)} ${hhmm(d.start)}` : hhmm(d.start));
  const pill = el('span', 'pill', d.status);
  pill.dataset.status = d.status;
  top.append(time, pill);
  main.append(top, el('div', 'card-title', d.title));
  const names = (d.attendees ?? []).map((a) => (typeof a === 'string' ? options.users.find((u) => u.id === a)?.name : a.name)).filter(Boolean);
  const meta = [d.gate, d.vehicle, names.length ? `立会：${names.join('・')}` : ''].filter(Boolean).join(' · ');
  if (meta) main.append(el('div', 'card-meta', meta));
  if (d.waiting) main.append(el('div', 'card-wait', '送信待ち'));
  article.append(main);

  const actions = el('div', 'card-actions');
  if (d.phone) {
    const call = el('a', 'btn-outline call', '発信');
    call.href = `tel:${d.phone.replace(/[^\d+]/g, '')}`;
    call.setAttribute('aria-label', `${d.vendor || d.title}に発信`);
    actions.append(call);
  }
  if (!d.local) {
    const copy = el('a', 'btn-outline', 'コピーして登録');
    copy.href = `#/new?copy=${d.id}`;
    actions.append(copy);
  }
  if (actions.childElementCount) article.append(actions);
  return article;
}

export function renderList() {
  for (const tab of document.querySelectorAll('[data-range]')) tab.setAttribute('aria-selected', String(tab.dataset.range === range));
  $('list-when').textContent = cache.fetchedAt ? `${hhmm(cache.fetchedAt)} 時点` : '';

  const d = days();
  const items = withOutbox(cache.deliveries)
    .filter((x) => x.start && inRange(x, d))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  const body = $('list-body');
  body.replaceChildren();
  if (!items.length) {
    body.append(el('p', 'empty', cache.fetchedAt ? '予定はありません' : '読み込み中…'));
    return;
  }
  const bySite = new Map();
  for (const x of items) {
    const key = x.site || '（現場名なし）';
    if (!bySite.has(key)) bySite.set(key, []);
    bySite.get(key).push(x);
  }
  for (const [site, list] of bySite) {
    body.append(el('h2', 'site', `${site}（${list.length}件）`));
    for (const x of list) body.append(card(x));
  }
}

export async function loadList() {
  const { tomorrow, monday, sunday } = days();
  const from = `${monday}T00:00:00+09:00`;
  const to = `${sunday > tomorrow ? sunday : tomorrow}T23:59:59+09:00`;
  renderList();
  try {
    const res = await fetch(`/api/deliveries?${new URLSearchParams({ from, to })}`);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    cache = { deliveries: data.deliveries, fetchedAt: data.fetchedAt ?? new Date().toISOString() };
    store.set(LIST_KEY, cache);
    $('list-offline').hidden = true;
  } catch {
    $('list-offline').textContent = cache.fetchedAt
      ? `つながらないため、${mdw(cache.fetchedAt)} ${hhmm(cache.fetchedAt)} 時点の一覧を表示しています`
      : 'つながらないため一覧を読み込めませんでした';
    $('list-offline').hidden = false;
  }
  renderList();
}

export function initList() {
  for (const tab of document.querySelectorAll('[data-range]')) {
    tab.addEventListener('click', () => {
      range = tab.dataset.range;
      store.set(TAB_KEY, range);
      renderList();
    });
  }
}
