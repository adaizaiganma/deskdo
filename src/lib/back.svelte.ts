/**
 * 手機上按返回（手勢或按鈕）時關掉這一層，例如展開的待辦、側邊抽屜。
 * 打開時在瀏覽紀錄加一筆；按返回時 WebView 會退回上一筆（WryActivity 的處理），收到 popstate 就關掉。
 * 用別的方式關掉時，把加的那一筆退掉，下次按返回才不會沒反應。要在元件初始化時呼叫。
 */
export function closeOnBack(layer: string, isOpen: () => boolean, close: () => void) {
  // 只在開、關之間切換時才重跑（例如換展開另一筆待辦時不算）
  const open = $derived(isOpen());
  /** 瀏覽紀錄裡有沒有這一層加的那一筆 */
  let pushed = false;
  /** 自己呼叫 history.back() 造成的 popstate，不是使用者按返回 */
  let ownBack = false;

  $effect(() => {
    const onPop = () => {
      if (ownBack) {
        ownBack = false;
        return;
      }
      if (pushed) {
        pushed = false;
        close();
      }
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  });

  $effect(() => {
    if (open) {
      if (!pushed) {
        history.pushState({ layer }, "");
        pushed = true;
      }
      return;
    }
    if (!pushed) return;
    // 稍等再退：點另一筆待辦時是先收起再展開，這時沿用同一筆紀錄。
    // history.back() 是非同步的，馬上退的話，退完時新的那一層已經打開，會被當成按了返回而關掉
    const timer = setTimeout(() => {
      if (isOpen() || !pushed) return;
      pushed = false;
      ownBack = true;
      history.back();
    }, 120);
    return () => clearTimeout(timer);
  });
}
