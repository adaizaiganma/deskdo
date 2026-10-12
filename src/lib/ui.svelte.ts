/** 整個 App 共用的畫面狀態：打開的待辦詳情、新增待辦的底部面板 */
class Ui {
  /** 正在看的待辦（全螢幕的詳情頁） */
  detail = $state<string | null>(null);
  /** 新增待辦的底部面板；值是預設的標籤和期限（標籤頁、日曆上選的那天） */
  adding = $state<{ tag: string | null; due: string | null } | null>(null);

  openTodo(id: string) {
    // 還在送出中的那一筆沒有真的 id
    if (!id.startsWith("tmp-")) this.detail = id;
  }

  add(defaults: { tag?: string | null; due?: string | null } = {}) {
    this.adding = { tag: defaults.tag ?? null, due: defaults.due ?? null };
  }
}

export const ui = new Ui();
