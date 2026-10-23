// 画面の切り替え（一覧・新規登録・変更）と、送信待ちの見守り。
// 画面は中継役（/api/*）とだけ通信し、Notion の秘密キーは一切持たない。
import { $, stepTime, refreshOptions, initDuplicateDialog } from './common.js';
import { outbox, flush, showConflict, onOutboxChange } from './sender.js';
import { initList, loadList, renderList } from './list.js';
import { initEntry, openEntry, renderEntry, fillEntry, showEntryError } from './entry.js';
import { initEdit, openEdit } from './edit.js';

const views = { list: $('view-list'), new: $('view-new'), edit: $('view-edit') };

function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query ?? '');
  const edit = path.match(/^\/edit\/([\w-]+)$/);
  const name = path === '/new' ? 'new' : edit ? 'edit' : 'list';
  for (const [key, view] of Object.entries(views)) view.hidden = key !== name;
  window.scrollTo(0, 0);
  if (name === 'list') loadList();
  if (name === 'new') openEntry({ copyId: params.get('copy') });
  if (name === 'edit') openEdit(edit[1]);
}

// ---- 送信待ちのお知らせ ----
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
  if (!views.list.hidden) renderList();
}

const flushCallbacks = {
  sent: () => !views.list.hidden && loadList(),
  invalid: (entry, message) => {
    if (entry.kind !== 'create') return;
    fillEntry(entry.payload);
    location.hash = '#/new';
    showEntryError(`送信待ちの登録が受け付けられませんでした：${message}`);
  },
};

$('outbox-retry').addEventListener('click', () => {
  const conflict = outbox.list().find((e) => e.state === 'conflict');
  if (!conflict) return flush(flushCallbacks);
  showConflict(conflict, {
    ok: () => !views.list.hidden && loadList(),
    change: (entry) => {
      if (entry.kind === 'update') location.hash = `#/edit/${entry.payload.id}`;
      else {
        fillEntry(entry.payload);
        location.hash = '#/new';
      }
    },
  });
});

// ---- 起動 ----
for (const b of document.querySelectorAll('[data-step]')) {
  b.addEventListener('click', () => stepTime($(b.dataset.target), Number(b.dataset.step)));
}
for (const id of ['time', 'edit-time']) $(id).addEventListener('change', () => stepTime($(id), 0));

initDuplicateDialog();
initList();
initEntry();
initEdit();
onOutboxChange(renderOutbox);

window.addEventListener('hashchange', route);
window.addEventListener('online', () => flush(flushCallbacks));
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && flush(flushCallbacks));
setInterval(() => flush(flushCallbacks), 60 * 1000);

route();
renderOutbox();
refreshOptions().then((ok) => {
  if (!ok) return;
  renderEntry();
  if (!views.list.hidden) renderList();
});
flush(flushCallbacks);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
