const ua = navigator.userAgent;

/** iPadOS 的 Safari 自稱是 Mac，用觸控點數分辨 */
export const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
export const iPhone = /iPhone|iPod/.test(ua);
export const iOS = iPhone || iPad;

/** 從主畫面打開（加到主畫面的網頁） */
export const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** 配對時記下的裝置名稱，例如「iPad（網頁版）」 */
export function deviceName(t: (zh: string, en: string) => string): string {
  const kind = iPhone ? "iPhone" : iPad ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "";
  if (!kind) return t("網頁版", "Web");
  return t(`${kind}（網頁版）`, `${kind} (web)`);
}
