// 登録・変更の送信と、その結果への対応をまとめる。
// 送る前に必ず端末へ保存するので、「送れたか分からない」状態にならない。
import { createOutbox, sendEntry } from './outbox.js';
import { safeStorage, toast, openDuplicate } from './common.js';

export const outbox = createOutbox(safeStorage());
const listeners = new Set();
export const onOutboxChange = (fn) => listeners.add(fn);
const changed = () => listeners.forEach((fn) => fn());

// callbacks: ok(delivery), queued(), invalid(message), change()
export async function send(entry, callbacks = {}) {
  outbox.put({ ...entry, state: 'sending', savedAt: new Date().toISOString() });
  changed();
  const result = await sendEntry(entry);
  handle(entry, result, callbacks);
  return result;
}

export function handle(entry, result, callbacks = {}) {
  const id = entry.payload.clientId;
  if (result.kind === 'ok') {
    outbox.remove(id);
    const label = entry.kind === 'update' ? '変更を保存しました' : `登録しました：${entry.payload.title}`;
    toast(label, '', result.delivery?.url);
    callbacks.ok?.(result.delivery);
  } else if (result.kind === 'duplicate') {
    outbox.put({ ...entry, state: 'conflict', duplicates: result.duplicates });
    showConflict({ ...entry, duplicates: result.duplicates }, callbacks);
  } else if (result.kind === 'invalid') {
    outbox.remove(id);
    callbacks.invalid?.(result.message);
  } else {
    outbox.put({ ...entry, state: 'pending' });
    toast('送信待ちに保存しました。電波が戻ると自動で送ります', 'wait');
    callbacks.queued?.();
  }
  changed();
}

export function showConflict(entry, callbacks = {}) {
  openDuplicate(entry.duplicates ?? [], {
    onForce: () => send({ kind: entry.kind, payload: { ...entry.payload, force: true } }, callbacks),
    onChange: () => {
      outbox.remove(entry.payload.clientId);
      changed();
      callbacks.change?.(entry);
    },
  });
}

let flushing = false;
export async function flush(callbacks = {}) {
  if (flushing) return [];
  flushing = true;
  try {
    // 前回の送信中に画面が閉じられたものも、送信待ちとして送り直す
    for (const e of outbox.list()) if (e.state === 'sending') outbox.put({ ...e, state: 'pending' });
    const results = await outbox.flush(sendEntry);
    const sent = results.filter((r) => r.result.kind === 'ok').length;
    if (sent) toast(`送信待ちの ${sent}件 を送りました`);
    const invalid = results.find((r) => r.result.kind === 'invalid');
    if (invalid) callbacks.invalid?.(invalid.entry, invalid.result.message);
    if (sent) callbacks.sent?.();
    return results;
  } finally {
    flushing = false;
    changed();
  }
}
