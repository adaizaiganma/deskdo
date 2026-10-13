import desktopCss from "deskdo/app.css?url";
import mobileCss from "@deskdo/mobile/app.css?url";

/** wide：電腦版介面（電腦、平板）；narrow：手機版介面 */
export type Layout = "wide" | "narrow";

/**
 * 夠寬就用電腦版介面（電腦版視窗最窄 640px，加上側欄還要再寬一點；iPad 直拿是 768px 起）。
 * 手機橫拿雖然夠寬但太矮，還是用手機版。
 */
export const WIDE_QUERY = "(min-width: 768px) and (min-height: 500px)";

const SHEETS: Record<Layout, string> = { wide: desktopCss, narrow: mobileCss };
const loading = new Map<Layout, Promise<HTMLLinkElement>>();

function load(layout: Layout): Promise<HTMLLinkElement> {
  let p = loading.get(layout);
  if (!p) {
    p = new Promise((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = SHEETS[layout];
      link.onload = link.onerror = () => resolve(link);
      document.head.append(link);
    });
    loading.set(layout, p);
  }
  return p;
}

/**
 * 換成這個版面的全域樣式。兩個 app.css 的顏色變數、按鈕樣式不一樣，不能同時生效，
 * 所以由這裡載入、切換，而不是在 main.ts 直接 import。載入好才 resolve，換版面時不會閃出沒有樣式的畫面。
 */
export async function useSheet(layout: Layout): Promise<void> {
  const active = await load(layout);
  for (const p of loading.values()) {
    const link = await p;
    link.disabled = link !== active;
  }
  document.documentElement.dataset.layout = layout;
}
