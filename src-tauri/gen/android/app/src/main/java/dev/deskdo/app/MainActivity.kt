package dev.deskdo.app

import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /**
   * Android 15 起 App 一定畫到狀態列和導覽列底下。這裡把網頁內容往內縮，
   * 讓出狀態列、導覽列和鍵盤的空間（露出來的部分是主題的背景色），網頁就不用處理這些邊距。
   */
  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    val content = findViewById<View>(android.R.id.content)
    content.setBackgroundColor(getColor(R.color.app_bg))
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)
  }

  /**
   * 從主畫面小工具點了某一筆、App 原本就在背景時：通知網頁去拿（Main.svelte 的 deskdo-open），
   * 網頁會展開那一筆。App 剛啟動、網頁還沒載入時，網頁載入後自己會拿。
   */
  override fun onResume() {
    super.onResume()
    if (OpenRequest.todo != null) {
      webView?.evaluateJavascript("window.dispatchEvent(new Event('deskdo-open'))", null)
    }
  }
}
