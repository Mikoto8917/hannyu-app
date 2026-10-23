// 登録画面。中継役（/api/*）だけと通信し、Notion の秘密キーは一切持たない。
import { createOutbox, sendDelivery } from './outbox.js';

const $ = (id) => document.getElementById(id);
const OPTIONS_KEY = 'hannyu.options.v1';
const RECENT_KEY = 'hannyu.recent.v1';
const ATTENDEES_KEY = 'hannyu.attendees.v1';
const DEFAULT_STATUSES = ['予定', '確定', '変更', '完了', '中止'];

const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

let storage;
try {
  storage = window.localStorage;
} catch {
  storage = { getItem: () => null, setItem: () => {} };
}
const outbox = createOutbox(storage);

const state = {
  options: { sites: [], gates: [], statuses: DEFAULT_STATUSES, users: [] },
  site: '',
  gate: '',
  status: '予定',
  attendees: new Set(store.get(ATTENDEES_KEY, [])),
  autoTitle: '',
  conflict: null,
};

// ---- 日付と時刻（日本時間） ----
const jst = (iso, opts) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', ...opts }).format(new Date(iso));
const hhmm = (iso) => jst(iso, { hour: '2-digit', minute: '2-digit', hour12: false });
const mdw = (iso) => jst(iso, { month: 'numeric', day: 'numeric', weekday: 'short' });
const todayJst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const startIso = () => `${$('date').value}T${$('time').value}:00+09:00`;

function stepTime(minutes) {
  const [h, m] = ($('time').value || '08:00').split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  const rounded = Math.round(total / 15) * 15 % 1440;
  $('time').value = `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
}

// ---- 選択ボタン ----
function renderChips(container, values, selected, onPick, { allowNew = false, allowNone = false } = {}) {
  container.replaceChildren();
  for (const value of values) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = value;
    b.setAttribute('aria-pressed', String(value === selected));
    b.addEventListener('click', () => onPick(allowNone && value === selected ? '' : value));
    container.append(b);
  }
  if (!allowNew) return;
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'chip';
  add.textContent = '＋ 新規';
  add.addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'chip-new';
    const input = document.createElement('input');
    input.className = 'inp';
    input.placeholder = '名前を入力';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn-outline';
    ok.textContent = '追加';
    const commit = () => {
      const name = input.value.trim();
      if (name) onPick(name, { added: true });
    };
    ok.addEventListener('click', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
    });
    row.append(input, ok);
    add.replaceWith(row);
    input.focus();
  });
  container.append(add);
}

function renderSite() {
  renderChips($('site-chips'), state.options.sites, state.site, (v, o) => {
    if (o?.added && !state.options.sites.includes(v)) state.options.sites.push(v);
    state.site = v;
    renderSite();
  }, { allowNew: true });
}

function renderGate() {
  renderChips($('gate-chips'), state.options.gates, state.gate, (v, o) => {
    if (o?.added && !state.options.gates.includes(v)) state.options.gates.push(v);
    state.gate = v;
    renderGate();
  }, { allowNew: true, allowNone: true });
}

function renderStatus() {
  renderChips($('status-chips'), state.options.statuses, state.status, (v) => {
    state.status = v;
    renderStatus();
  });
}

function renderAttendees() {
  const box = $('attendee-chips');
  box.replaceChildren();
  if (!state.options.users.length) {
    const p = document.createElement('span');
    p.className = 'hint';
    p.textContent = '候補を読み込めませんでした（つながると表示されます）';
    box.append(p);
    return;
  }
  for (const u of state.options.users) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = u.name || '（名前なし）';
    b.setAttribute('aria-pressed', String(state.attendees.has(u.id)));
    b.addEventListener('click', () => {
      if (state.attendees.has(u.id)) state.attendees.delete(u.id);
      else state.attendees.add(u.id);
      store.set(ATTENDEES_KEY, [...state.attendees]);
      renderAttendees();
    });
    box.append(b);
  }
}

function renderAll() {
  renderSite();
  renderGate();
  renderStatus();
  renderAttendees();
}

async function loadOptions() {
  const cached = store.get(OPTIONS_KEY, null);
  if (cached) state.options = cached;
  if (!state.site && state.options.sites.length === 1) state.site = state.options.sites[0];
  renderAll();
  try {
    const res = await fetch('/api/options');
    if (!res.ok) return;
    const fresh = await res.json();
    state.options = fresh;
    store.set(OPTIONS_KEY, fresh);
    const known = new Set(fresh.users.map((u) => u.id));
    state.attendees = new Set([...state.attendees].filter((id) => known.has(id)));
    if (!state.site && fresh.sites.length === 1) state.site = fresh.sites[0];
    renderAll();
  } catch {}
}

// ---- 件名の自動入力 ----
function updateAutoTitle() {
  const next = [$('vendor').value.trim(), $('item').value.trim()].filter(Boolean).join('／');
  const title = $('title');
  if (!title.value || title.value === state.autoTitle) title.value = next;
  state.autoTitle = next;
}

// ---- 送信 ----
function toast(html, tone = '') {
  const t = $('toast');
  t.className = `toast ${tone}`;
  t.innerHTML = html;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 6000);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function showError(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = !message;
}

function collect() {
  return {
    clientId: crypto.randomUUID(),
    title: $('title').value.trim(),
    site: state.site,
    start: startIso(),
    item: $('item').value.trim(),
    vendor: $('vendor').value.trim(),
    vehicle: $('vehicle').value.trim(),
    phone: $('phone').value.trim(),
    gate: state.gate,
    attendees: [...state.attendees],
    status: state.status,
    memo: $('memo').value.trim(),
  };
}

function validate(p) {
  if (!p.site) return '現場名を選んでください';
  if (!$('date').value || !$('time').value) return '搬入日時を入れてください';
  if (!p.title) return '件名を入れてください';
  return '';
}

function fill(p, { keepDate = false } = {}) {
  state.site = p.site ?? '';
  state.gate = p.gate ?? '';
  state.status = p.status && !keepDate ? p.status : '予定';
  if (p.site && !state.options.sites.includes(p.site)) state.options.sites.push(p.site);
  if (p.gate && !state.options.gates.includes(p.gate)) state.options.gates.push(p.gate);
  const ids = (p.attendees ?? []).map((a) => (typeof a === 'string' ? a : a.id));
  if (ids.length) state.attendees = new Set(ids);
  for (const id of ['vendor', 'item', 'title', 'vehicle', 'phone', 'memo']) $(id).value = p[id] ?? '';
  state.autoTitle = [p.vendor, p.item].filter(Boolean).join('／');
  if (p.start) {
    $('time').value = hhmm(p.start);
    if (!keepDate) $('date').value = new Date(p.start).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  }
  renderAll();
}

function resetForm() {
  for (const id of ['vendor', 'item', 'title', 'vehicle', 'phone', 'memo']) $(id).value = '';
  state.autoTitle = '';
  state.status = '予定';
  renderStatus();
  showError('');
}

async function submit(payload) {
  $('submit').disabled = true;
  outbox.put({ payload, state: 'sending', savedAt: new Date().toISOString() });
  const result = await sendDelivery(payload);
  $('submit').disabled = false;
  handleResult(payload, result, { fromForm: true });
}

function handleResult(payload, result, { fromForm }) {
  if (result.kind === 'ok') {
    outbox.remove(payload.clientId);
    const link = result.delivery?.url ? `<a href="${escapeHtml(result.delivery.url)}" target="_blank" rel="noopener">Notionで見る</a>` : '';
    toast(`登録しました：${escapeHtml(payload.title)}　${link}`);
    if (fromForm) resetForm();
  } else if (result.kind === 'duplicate') {
    outbox.put({ payload, state: 'conflict', duplicates: result.duplicates, savedAt: new Date().toISOString() });
    openDuplicate(payload, result.duplicates);
  } else if (result.kind === 'invalid') {
    outbox.remove(payload.clientId);
    if (!fromForm) fill(payload, { keepDate: false });
    showError(result.message);
  } else {
    outbox.put({ payload, state: 'pending', savedAt: new Date().toISOString() });
    toast('送信待ちに保存しました。電波が戻ると自動で送ります', 'wait');
    if (fromForm) resetForm();
  }
  renderOutbox();
}

// ---- 重複の警告 ----
function openDuplicate(payload, duplicates) {
  state.conflict = payload;
  const list = $('dup-list');
  list.replaceChildren();
  for (const d of duplicates) {
    const li = document.createElement('li');
    li.textContent = `${d.site}・${d.gate} の ${hhmm(d.start)}「${d.title}」（${d.status}）`;
    list.append(li);
  }
  $('dup-dialog').showModal();
}

$('dup-force').addEventListener('click', async () => {
  const payload = state.conflict;
  $('dup-dialog').close();
  if (!payload) return;
  state.conflict = null;
  const forced = { ...payload, force: true };
  outbox.put({ payload: forced, state: 'sending', savedAt: new Date().toISOString() });
  const result = await sendDelivery(forced);
  handleResult(forced, result, { fromForm: true });
});

$('dup-change').addEventListener('click', () => {
  const payload = state.conflict;
  $('dup-dialog').close();
  if (!payload) return;
  state.conflict = null;
  outbox.remove(payload.clientId);
  fill(payload);
  renderOutbox();
  $('time').focus();
});

// ---- 送信待ち ----
function renderOutbox() {
  const items = outbox.list();
  const pending = items.filter((e) => e.state !== 'conflict').length;
  const conflicts = items.filter((e) => e.state === 'conflict').length;
  const parts = [];
  if (pending) parts.push(`送信待ち ${pending}件：電波が戻ると自動で送ります`);
  if (conflicts) parts.push(`確認が必要 ${conflicts}件：近い時間に別の搬入があります`);
  $('outbox').hidden = !parts.length;
  $('outbox-text').textContent = parts.join(' / ');
  $('outbox-retry').textContent = conflicts ? '確認する' : '今すぐ再送';
}

let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    // 前回の送信中に画面が閉じられたものも、送信待ちとして送り直す
    for (const e of outbox.list()) if (e.state === 'sending') outbox.put({ ...e, state: 'pending' });
    const results = await outbox.flush(sendDelivery);
    const sent = results.filter((r) => r.result.kind === 'ok').length;
    if (sent) toast(`送信待ちの ${sent}件 を登録しました`);
    const invalid = results.find((r) => r.result.kind === 'invalid');
    if (invalid) {
      fill(invalid.entry.payload);
      showError(`送信待ちの登録が受け付けられませんでした：${invalid.result.message}`);
    }
  } finally {
    flushing = false;
    renderOutbox();
  }
}

$('outbox-retry').addEventListener('click', () => {
  const conflict = outbox.list().find((e) => e.state === 'conflict');
  if (conflict) openDuplicate(conflict.payload, conflict.duplicates ?? []);
  else flush();
});

// ---- 前回をコピー ----
function renderCopyList(items) {
  const list = $('copy-list');
  list.replaceChildren();
  for (const d of items) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const strong = document.createElement('strong');
    strong.textContent = d.title || '（件名なし）';
    const span = document.createElement('span');
    span.textContent = `${mdw(d.start)} ${hhmm(d.start)} · ${d.site}${d.gate ? ` · ${d.gate}` : ''}`;
    b.append(strong, span);
    b.addEventListener('click', () => {
      fill(d, { keepDate: true });
      $('copy-dialog').close();
      toast('内容をコピーしました。日付を確認して登録してください');
      $('date').focus();
    });
    li.append(b);
    list.append(li);
  }
}

$('copy-open').addEventListener('click', async () => {
  const cached = store.get(RECENT_KEY, []);
  renderCopyList(cached);
  $('copy-status').textContent = cached.length ? '' : '読み込み中…';
  $('copy-dialog').showModal();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const q = new URLSearchParams({ from: new Date(now - 30 * day).toISOString(), to: new Date(now + day).toISOString() });
  try {
    const res = await fetch(`/api/deliveries?${q}`);
    if (!res.ok) throw new Error();
    const { deliveries } = await res.json();
    const recent = deliveries.filter((d) => d.start).sort((a, b) => Date.parse(b.start) - Date.parse(a.start)).slice(0, 20);
    store.set(RECENT_KEY, recent);
    renderCopyList(recent);
    $('copy-status').textContent = recent.length ? '' : '最近30日の登録はありません';
  } catch {
    $('copy-status').textContent = cached.length ? 'つながらないため、前回読み込んだ一覧を表示しています' : 'つながらないため読み込めませんでした';
  }
});
$('copy-close').addEventListener('click', () => $('copy-dialog').close());

// ---- 起動 ----
$('date').value = todayJst();
$('time').value = '08:00';
for (const b of document.querySelectorAll('[data-step]')) b.addEventListener('click', () => stepTime(Number(b.dataset.step)));
$('time').addEventListener('change', () => stepTime(0));
$('vendor').addEventListener('input', updateAutoTitle);
$('item').addEventListener('input', updateAutoTitle);
$('entry').addEventListener('submit', (e) => {
  e.preventDefault();
  const payload = collect();
  const problem = validate(payload);
  showError(problem);
  if (!problem) submit(payload);
});

window.addEventListener('online', flush);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && flush());
setInterval(flush, 60 * 1000);

loadOptions();
renderOutbox();
flush();
