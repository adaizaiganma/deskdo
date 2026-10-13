/**
 * 手機上按返回（手勢或按鈕）時關掉最上面的一層，例如抽屜、底部面板、待辦詳情、子頁面。
 *
 * 每打開一層就在瀏覽紀錄加一筆；按返回時 WebView 會退回上一筆（WryActivity 的處理），收到 popstate 就關掉最上面那一層。
 * 用畫面上的按鈕關掉時，那一筆先留著給下一層用，過一下還沒用到才退掉：
 * 例如從抽屜點了「設定」，抽屜關掉、設定頁打開是同時發生的，直接沿用同一筆，不用先退再加（history.back() 是非同步的，
 * 退完之前又加了一筆會互相干擾）。紀錄只算筆數，不管是哪一層加的，所以關掉的順序不影響。
 */

interface Layer {
  id: number;
  close: () => void;
}

const layers: Layer[] = [];
/** 還在瀏覽紀錄裡、但那一層已經用按鈕關掉的筆數 */
let spare = 0;
/** 自己退掉紀錄造成的 popstate，不是使用者按返回 */
let ignore = 0;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

if (typeof window !== "undefined") {
  addEventListener("popstate", () => {
    if (ignore > 0) {
      ignore--;
      return;
    }
    const top = layers.pop();
    if (top) top.close();
    else if (spare > 0) spare--;
  });
}

function push(close: () => void): number {
  const id = ++seq;
  layers.push({ id, close });
  if (spare > 0) spare--;
  else history.pushState({ deskdo: id }, "");
  return id;
}

function release(id: number) {
  const i = layers.findIndex((l) => l.id === id);
  if (i < 0) return;
  layers.splice(i, 1);
  spare++;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!spare) return;
    ignore++;
    history.go(-spare);
    spare = 0;
  }, 150);
}

/** 在元件初始化時呼叫：isOpen() 變成 true 時加一層，按返回時呼叫 close() */
export function closeOnBack(_name: string, isOpen: () => boolean, close: () => void) {
  const open = $derived(isOpen());
  let id: number | null = null;

  $effect(() => {
    if (open) {
      if (id === null)
        id = push(() => {
          id = null;
          close();
        });
    } else if (id !== null) {
      release(id);
      id = null;
    }
  });

  // 元件拿掉時（例如換頁）也要把這一層收掉
  $effect(() => () => {
    if (id !== null) release(id);
    id = null;
  });
}
