/**
 * 停用 WebView 預設的右鍵選單（包括輸入框：WebView2 的選單混有「匯入密碼」「更多工具」等瀏覽器項目）。
 * 剪下／複製／貼上用 Ctrl+X／C／V。需要右鍵行為的元件自己處理 contextmenu 事件。
 */
export function disableContextMenu() {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}
