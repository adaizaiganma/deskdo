package dev.deskdo.app

import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  /** 系統導覽列的高度（CSS px）；鍵盤打開時是 0 */
  @Volatile private var navInset = 0f

  /** 網頁啟動時用 window.DeskdoInsets.navInset() 拿目前的值，之後有變化由 pushInset() 通知 */
  inner class Insets {
    @JavascriptInterface
    fun navInset(): Float = this@MainActivity.navInset
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /**
   * Android 15 起 App 一定畫到狀態列和導覽列底下。這裡把網頁內容往內縮，讓出狀態列和鍵盤的空間
   * （露出來的部分是主題的背景色）。導覽列不縮：網頁畫到它底下，底部導覽列和面板自己讓開這段高度（CSS 的 --nav-inset），
   * 顏色才會和網頁底部連在一起。
   */
  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(Insets(), "DeskdoInsets")
    val content = findViewById<View>(android.R.id.content)
    content.setBackgroundColor(getColor(R.color.app_bg))
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val keyboard = ime.bottom > bars.bottom
      v.setPadding(bars.left, bars.top, bars.right, if (keyboard) ime.bottom else 0)
      val inset = if (keyboard) 0f else bars.bottom / resources.displayMetrics.density
      if (inset != navInset) {
        navInset = inset
        pushInset()
      }
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)
  }

  private fun pushInset() {
    webView?.evaluateJavascript("document.documentElement.style.setProperty('--nav-inset','${navInset}px')", null)
  }

  /**
   * 從主畫面小工具點了某一筆、App 原本就在背景時：通知網頁去拿（Main.svelte 的 deskdo-open），
   * 網頁會打開那一筆。App 剛啟動、網頁還沒載入時，網頁載入後自己會拿。
   */
  override fun onResume() {
    super.onResume()
    pushInset()
    if (OpenRequest.todo != null) {
      webView?.evaluateJavascript("window.dispatchEvent(new Event('deskdo-open'))", null)
    }
  }
}
