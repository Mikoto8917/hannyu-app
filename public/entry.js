// 新規登録画面。
import { $, store, hhmm, mdw, dayOf, todayJst, startIso, toast, renderChips, options, remember, DEFAULT_STATUSES } from './common.js';
import { send } from './sender.js';
import { cachedList, findCached } from './list.js';

const ATTENDEES_KEY = 'hannyu.attendees.v1';
const TEXT_FIELDS = ['vendor', 'item', 'title', 'vehicle', 'phone', 'memo'];

const state = {
  site: '',
  gate: '',
  status: '予定',
  attendees: new Set(store.get(ATTENDEES_KEY, [])),
  autoTitle: '',
};

function renderSite() {
  renderChips($('site-chips'), options.sites, state.site, (v, o) => {
    if (o?.added) remember(options.sites, v);
    state.site = v;
    renderSite();
  }, { allowNew: true });
}

function renderGate() {
  renderChips($('gate-chips'), options.gates, state.gate, (v, o) => {
    if (o?.added) remember(options.gates, v);
    state.gate = v;
    renderGate();
  }, { allowNew: true, allowNone: true });
}

function renderStatus() {
  renderChips($('status-chips'), options.statuses ?? DEFAULT_STATUSES, state.status, (v) => {
    state.status = v;
    renderStatus();
  });
}

function renderAttendees() {
  const box = $('attendee-chips');
  box.replaceChildren();
  if (!options.users.length) {
    const p = document.createElement('span');
    p.className = 'hint';
    p.textContent = '候補を読み込めませんでした（つながると表示されます）';
    box.append(p);
    return;
  }
  for (const u of options.users) {
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

export function renderEntry() {
  if (!state.site && options.sites.length === 1) state.site = options.sites[0];
  const known = new Set(options.users.map((u) => u.id));
  if (known.size) state.attendees = new Set([...state.attendees].filter((id) => known.has(id)));
  renderSite();
  renderGate();
  renderStatus();
  renderAttendees();
}

function updateAutoTitle() {
  const next = [$('vendor').value.trim(), $('item').value.trim()].filter(Boolean).join('／');
  const title = $('title');
  if (!title.value || title.value === state.autoTitle) title.value = next;
  state.autoTitle = next;
}

function showError(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = !message;
}

function collect() {
  return {
    clientId: crypto.randomUUID(),
    title: $('title').value.trim(),
    site: state.site,
    start: startIso($('date').value, $('time').value),
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

// 入力欄に内容を入れる。copy: true なら日付は今のまま・ステータスは「予定」
export function fillEntry(p, { copy = false } = {}) {
  state.site = p.site ?? '';
  state.gate = p.gate ?? '';
  state.status = !copy && p.status ? p.status : '予定';
  remember(options.sites, p.site);
  remember(options.gates, p.gate);
  const ids = (p.attendees ?? []).map((a) => (typeof a === 'string' ? a : a.id));
  if (ids.length) state.attendees = new Set(ids);
  for (const id of TEXT_FIELDS) $(id).value = p[id] ?? '';
  state.autoTitle = [p.vendor, p.item].filter(Boolean).join('／');
  if (p.start) {
    $('time').value = hhmm(p.start);
    if (!copy) $('date').value = dayOf(p.start);
  }
  renderEntry();
}

function resetForm() {
  for (const id of TEXT_FIELDS) $(id).value = '';
  state.autoTitle = '';
  state.status = '予定';
  renderStatus();
  showError('');
}

export function showEntryError(message) {
  showError(message);
}

// 一覧の「コピーして登録」から来たとき
export function openEntry({ copyId } = {}) {
  showError('');
  if (copyId) {
    const d = findCached(copyId);
    if (d) {
      fillEntry(d, { copy: true });
      toast('内容をコピーしました。日付を確認して登録してください');
    }
  }
  renderEntry();
}

function submit(payload) {
  $('submit').disabled = true;
  send({ kind: 'create', payload }, {
    ok: resetForm,
    queued: resetForm,
    invalid: (message) => {
      fillEntry(payload);
      showError(message);
    },
    change: (entry) => {
      fillEntry(entry.payload);
      $('time').focus();
    },
  }).finally(() => ($('submit').disabled = false));
}

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
      fillEntry(d, { copy: true });
      $('copy-dialog').close();
      toast('内容をコピーしました。日付を確認して登録してください');
      $('date').focus();
    });
    li.append(b);
    list.append(li);
  }
}

const RECENT_KEY = 'hannyu.recent.v1';
async function openCopy() {
  const byNewest = (xs) => xs.filter((d) => d.start).sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  const cached = store.get(RECENT_KEY, null) ?? byNewest(cachedList()).slice(0, 20);
  renderCopyList(cached);
  $('copy-status').textContent = cached.length ? '' : '読み込み中…';
  $('copy-dialog').showModal();
  const now = Date.now();
  const q = new URLSearchParams({ from: new Date(now - 30 * 864e5).toISOString(), to: new Date(now + 864e5).toISOString() });
  try {
    const res = await fetch(`/api/deliveries?${q}`);
    if (!res.ok) throw new Error();
    const recent = byNewest((await res.json()).deliveries).slice(0, 20);
    store.set(RECENT_KEY, recent);
    renderCopyList(recent);
    $('copy-status').textContent = recent.length ? '' : '最近30日の登録はありません';
  } catch {
    $('copy-status').textContent = cached.length ? 'つながらないため、前回読み込んだ一覧を表示しています' : 'つながらないため読み込めませんでした';
  }
}

export function initEntry() {
  $('date').value = todayJst();
  $('time').value = '08:00';
  $('vendor').addEventListener('input', updateAutoTitle);
  $('item').addEventListener('input', updateAutoTitle);
  $('copy-open').addEventListener('click', openCopy);
  $('copy-close').addEventListener('click', () => $('copy-dialog').close());
  $('entry').addEventListener('submit', (e) => {
    e.preventDefault();
    const payload = collect();
    const problem = validate(payload);
    showError(problem);
    if (!problem) submit(payload);
  });
}
