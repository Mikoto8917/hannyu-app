// 送信待ちの登録を端末に保存し、つながったら送り直す。
// 1件ごとに送信ID（clientId）を持つので、何度送り直しても Notion には1件しか入らない。

const KEY = 'hannyu.outbox.v1';

export function createOutbox(storage) {
  const read = () => {
    try {
      return JSON.parse(storage.getItem(KEY) ?? '[]');
    } catch {
      return [];
    }
  };
  const write = (items) => {
    try {
      storage.setItem(KEY, JSON.stringify(items));
    } catch {}
  };

  return {
    list: read,
    put(entry) {
      const items = read().filter((e) => e.payload.clientId !== entry.payload.clientId);
      items.push(entry);
      write(items);
    },
    remove(clientId) {
      write(read().filter((e) => e.payload.clientId !== clientId));
    },
    // 送信待ち（state: 'pending'）を順に送る。重複の確認が必要なものは 'conflict' にして残す。
    async flush(send) {
      const results = [];
      for (const entry of read()) {
        if (entry.state !== 'pending') continue;
        const result = await send(entry.payload);
        results.push({ entry, result });
        if (result.kind === 'ok' || result.kind === 'invalid') this.remove(entry.payload.clientId);
        else if (result.kind === 'duplicate') this.put({ ...entry, state: 'conflict', duplicates: result.duplicates });
        else break; // まだつながらない：残りは次の機会に
      }
      return results;
    },
  };
}

// 中継役への送信。結果を4種類に分ける。
export async function sendDelivery(payload, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl('/api/deliveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { kind: 'retry', message: '通信できませんでした' };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 200 || res.status === 201) return { kind: 'ok', delivery: data.delivery };
  if (res.status === 409) return { kind: 'duplicate', duplicates: data.duplicates ?? [] };
  if (res.status === 400) return { kind: 'invalid', message: data.error ?? '入力内容を確認してください' };
  return { kind: 'retry', message: data.error ?? '送信に失敗しました' };
}
