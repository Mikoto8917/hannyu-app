// 変更・ステータス更新画面。削除はできない（取りやめは「中止」）。
import { $, hhmm, dayOf, startIso, toast, options, DEFAULT_STATUSES } from './common.js';
import { send } from './sender.js';
import { findCached, updateCached } from './list.js';

let current = null;
let status = '';
let timeTouched = false;

function showError(message) {
  $('edit-error').textContent = message;
  $('edit-error').hidden = !message;
}

function renderStatus() {
  const grid = $('edit-status');
  grid.replaceChildren();
  for (const s of options.statuses ?? DEFAULT_STATUSES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'st';
    b.dataset.status = s;
    b.textContent = s === '中止' ? '中止にする' : s;
    b.setAttribute('aria-pressed', String(s === status));
    b.addEventListener('click', () => {
      status = s;
      $('edit-hint').hidden = true;
      renderStatus();
    });
    grid.append(b);
  }
}

function onTimeChanged() {
  timeTouched = true;
  const moved = startIso($('edit-date').value, $('edit-time').value) !== startIso(dayOf(current.start), hhmm(current.start));
  if (moved && (status === '予定' || status === '確定')) {
    status = '変更';
    $('edit-hint').hidden = false;
    renderStatus();
  }
}

export function openEdit(id) {
  showError('');
  current = findCached(id);
  if (!current) {
    showError('この搬入が見つかりません。一覧から開き直してください');
    $('edit-save').disabled = true;
    return;
  }
  $('edit-save').disabled = false;
  status = current.status;
  timeTouched = false;
  $('edit-hint').hidden = true;
  $('edit-place').textContent = [current.site, current.gate].filter(Boolean).join(' · ');
  $('edit-title').textContent = current.title;
  const names = (current.attendees ?? []).map((a) => a.name).filter(Boolean);
  $('edit-detail').textContent = [current.vendor, current.vehicle, names.length ? `立会：${names.join('・')}` : ''].filter(Boolean).join(' · ');
  const call = $('edit-call');
  call.hidden = !current.phone;
  if (current.phone) {
    call.href = `tel:${current.phone.replace(/[^\d+]/g, '')}`;
    call.textContent = `${current.vendor || '連絡先'}に発信`;
  }
  $('edit-notion').hidden = !current.url;
  if (current.url) $('edit-notion').href = current.url;
  $('edit-date').value = dayOf(current.start);
  $('edit-time').value = hhmm(current.start);
  renderStatus();
}

function save() {
  if (!current) return;
  const changes = {};
  if (status !== current.status) changes.status = status;
  const start = startIso($('edit-date').value, $('edit-time').value);
  if (timeTouched && Date.parse(start) !== Date.parse(current.start)) changes.start = start;
  if (!Object.keys(changes).length) {
    toast('変更はありません');
    return;
  }
  const original = current;
  $('edit-save').disabled = true;
  send({ kind: 'update', payload: { clientId: crypto.randomUUID(), id: original.id, changes } }, {
    ok: (delivery) => {
      updateCached(delivery ?? { ...original, ...changes });
      location.hash = '#/';
    },
    queued: () => (location.hash = '#/'),
    invalid: (message) => showError(message),
    change: () => $('edit-time').focus(),
  }).finally(() => ($('edit-save').disabled = false));
}

export function initEdit() {
  $('edit-date').addEventListener('change', onTimeChanged);
  $('edit-time').addEventListener('change', onTimeChanged);
  for (const b of document.querySelectorAll('[data-target="edit-time"]')) b.addEventListener('click', onTimeChanged);
  $('edit-save').addEventListener('click', save);
}
