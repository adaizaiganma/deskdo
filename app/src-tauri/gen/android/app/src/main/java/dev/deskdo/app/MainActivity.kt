package dev.deskdo.app

import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /**
   * Android 15 起 App 一定畫到狀態列和導覽列底下。這裡把網頁內容往內縮，
   * 讓出狀態列、導覽列和鍵盤的空間（露出來的部分是主題的背景色），網頁就不用處理這些邊距。
   */
  override fun onWebViewCreate(webView: WebView) {
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
}
