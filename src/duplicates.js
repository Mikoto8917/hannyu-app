// 重複チェック：同じ現場・同じ搬入口で、開始時刻が前後 windowMinutes 分以内の搬入を探す。
// 「中止」は対象外。自分自身（変更時）は ignoreId で除外する。

export const DUPLICATE_WINDOW_MINUTES = 15;

export function findDuplicates(candidate, existing, { windowMinutes = DUPLICATE_WINDOW_MINUTES, ignoreId } = {}) {
  if (!candidate.site || !candidate.gate || !candidate.start) return [];
  const at = Date.parse(candidate.start);
  if (Number.isNaN(at)) return [];
  const windowMs = windowMinutes * 60 * 1000;

  return existing.filter((d) => {
    if (d.id === ignoreId) return false;
    if (d.status === '中止') return false;
    if (d.site !== candidate.site || d.gate !== candidate.gate) return false;
    const other = Date.parse(d.start);
    if (Number.isNaN(other)) return false;
    return Math.abs(other - at) <= windowMs;
  });
}
