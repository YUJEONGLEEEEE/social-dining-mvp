// Dates are stored in UTC and shown in Korean time.
const KST = 9 * 3600 * 1000;
const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

function kst(iso: string) {
  return new Date(new Date(iso).getTime() + KST);
}

export function dateLabel(iso: string) {
  const d = kst(iso);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${DAYS[d.getUTCDay()]})`;
}

export function timeLabel(iso: string) {
  const d = kst(iso);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  if (h === 0 && m === 0) return "밤 12시";
  const period = h < 12 ? "오전" : h < 18 ? "오후" : "저녁";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${hour}시${m ? ` ${m}분` : ""}`;
}

export function dateTimeLabel(iso: string) {
  return `${dateLabel(iso)} ${timeLabel(iso)}`;
}

/** "1일 14시간" between two instants (virtual clock to deadline). */
export function durationLabel(fromIso: string, toIso: string) {
  const minutes = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return [days ? `${days}일` : "", hours ? `${hours}시간` : "", !days && !hours ? `${minutes % 60}분` : ""].filter(Boolean).join(" ");
}

export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
