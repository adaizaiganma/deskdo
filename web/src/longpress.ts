/**
 * iPhone、iPad 的 Safari 長按不會觸發 contextmenu（Android 的 Chrome 會），
 * 電腦版介面的右鍵選單（主頁版面、整理標籤）在 iPad 上就打不開。這裡把長按轉成 contextmenu 事件。
 */
const HOLD_MS = 500;
/** 手指移動超過這個距離就是捲動，不是長按 */
const SLOP_PX = 10;

export function longPressAsContextMenu(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number; target: EventTarget } | null = null;
  let fired = false;
  /** 長按放開時那一下不要再算成點擊 */
  let swallowUntil = 0;

  const cancel = () => {
    clearTimeout(timer);
    start = null;
  };

  const fire = () => {
    if (!start) return;
    const { x, y, target } = start;
    start = null;
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
    target.dispatchEvent(e);
    fired = e.defaultPrevented;
  };

  const down = (e: TouchEvent) => {
    cancel();
    fired = false;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, target: e.target! };
    timer = setTimeout(fire, HOLD_MS);
  };

  const move = (e: TouchEvent) => {
    const t = e.touches[0];
    if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > SLOP_PX) cancel();
  };

  const up = () => {
    cancel();
    if (fired) swallowUntil = Date.now() + 400;
    fired = false;
  };

  const click = (e: MouseEvent) => {
    if (Date.now() > swallowUntil) return;
    swallowUntil = 0;
    e.preventDefault();
    e.stopPropagation();
  };

  const opts = { capture: true, passive: true };
  addEventListener("touchstart", down, opts);
  addEventListener("touchmove", move, opts);
  addEventListener("touchend", up, opts);
  addEventListener("touchcancel", cancel, opts);
  addEventListener("click", click, true);
  return () => {
    cancel();
    removeEventListener("touchstart", down, opts);
    removeEventListener("touchmove", move, opts);
    removeEventListener("touchend", up, opts);
    removeEventListener("touchcancel", cancel, opts);
    removeEventListener("click", click, true);
  };
}
