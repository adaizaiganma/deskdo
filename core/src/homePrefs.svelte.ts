/** 主頁的顯示偏好：只存在這台裝置（localStorage） */

export type ClockStyle = "analog" | "digital";

const CLOCK_KEY = "home.clock";

function readClock(): ClockStyle {
  try {
    return localStorage.getItem(CLOCK_KEY) === "digital" ? "digital" : "analog";
  } catch {
    return "analog";
  }
}

class HomePrefs {
  /** 指針時鐘（下面加一行小的數位時間）或只有大字的數位時鐘 */
  clock = $state<ClockStyle>(readClock());

  setClock(style: ClockStyle) {
    this.clock = style;
    try {
      localStorage.setItem(CLOCK_KEY, style);
    } catch {}
  }
}

export const homePrefs = new HomePrefs();
