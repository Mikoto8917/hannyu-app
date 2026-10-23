// 画面どうしで共有する小さな道具。

export const $ = (id) => document.getElementById(id);

export const store = {
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

export function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {} };
  }
}

// ---- 日付と時刻（日本時間） ----
const fmt = (iso, opts) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', ...opts }).format(new Date(iso));
export const hhmm = (iso) => fmt(iso, { hour: '2-digit', minute: '2-digit', hour12: false });
export const mdw = (iso) => fmt(iso, { month: 'numeric', day: 'numeric', weekday: 'short' });
export const dayOf = (iso) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
export const todayJst = () => dayOf(new Date().toISOString());
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00+09:00`) + n * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
export const mondayOf = (day) => addDays(day, -((new Date(`${day}T12:00:00+09:00`).getUTCDay() + 6) % 7));
export const startIso = (day, time) => `${day}T${time}:00+09:00`;

export function stepTime(input, minutes) {
  const [h, m] = (input.value || '08:00').split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  const rounded = (Math.round(total / 15) * 15) % 1440;
  input.value = `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
}

// ---- お知らせ ----
export function toast(text, tone = '', link) {
  const t = $('toast');
  t.className = `toast ${tone}`;
  t.replaceChildren(text);
  if (link) {
    const a = document.createElement('a');
    a.href = link;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Notionで見る';
    t.append('　', a);
  }
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 6000);
}

// ---- 選択ボタン ----
export function renderChips(container, values, selected, onPick, { allowNew = false, allowNone = false } = {}) {
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

// ---- 重複の警告 ----
let dupHandlers = null;
export function openDuplicate(duplicates, { onForce, onChange }) {
  const list = $('dup-list');
  list.replaceChildren();
  for (const d of duplicates) {
    const li = document.createElement('li');
    li.textContent = `${d.site}・${d.gate} の ${hhmm(d.start)}「${d.title}」（${d.status}）`;
    list.append(li);
  }
  dupHandlers = { onForce, onChange };
  $('dup-dialog').showModal();
}
export function initDuplicateDialog() {
  $('dup-force').addEventListener('click', () => {
    $('dup-dialog').close();
    dupHandlers?.onForce();
    dupHandlers = null;
  });
  $('dup-change').addEventListener('click', () => {
    $('dup-dialog').close();
    dupHandlers?.onChange();
    dupHandlers = null;
  });
}

// ---- 選択肢（現場名・搬入口・立会担当）----
const OPTIONS_KEY = 'hannyu.options.v1';
export const DEFAULT_STATUSES = ['予定', '確定', '変更', '完了', '中止'];
export const options = store.get(OPTIONS_KEY, { sites: [], gates: [], statuses: DEFAULT_STATUSES, users: [] });

export async function refreshOptions() {
  try {
    const res = await fetch('/api/options');
    if (!res.ok) return false;
    Object.assign(options, await res.json());
    store.set(OPTIONS_KEY, options);
    return true;
  } catch {
    return false;
  }
}

export function remember(list, value) {
  if (value && !list.includes(value)) list.push(value);
}
