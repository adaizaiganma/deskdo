package dev.deskdo.app

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * Rust（src/mobile.rs）每次資料變動時呼叫 update，把小工具要顯示的清單和連線設定整份交過來。
 * 存起來之後，就算 App 沒在執行（例如重新開機後），小工具也能顯示、勾選完成。
 */
@TauriPlugin
class WidgetPlugin(private val activity: Activity) : Plugin(activity) {
  /** Tauri 在主執行緒呼叫外掛：寫檔、重建小工具會讓畫面卡一下，所以交給背景執行緒 */
  private val worker = Executors.newSingleThreadExecutor()

  /** 還沒處理的最新一份；連續改了好幾次時只處理最後一份 */
  private val latest = AtomicReference<String?>(null)

  @Command
  fun update(invoke: Invoke) {
    if (latest.getAndSet(invoke.getRawArgs()) == null) {
      worker.execute {
        val json = latest.getAndSet(null) ?: return@execute
        WidgetStore.saveFromApp(activity, json)
        DeskdoWidget.refreshAll(activity)
      }
    }
    invoke.resolve()
  }

  /** 小工具上點了哪一筆待辦（App 打開後展開它）；拿過就清掉 */
  @Command
  fun takeOpen(invoke: Invoke) {
    val id = OpenRequest.todo
    OpenRequest.todo = null
    invoke.resolve(JSObject().put("id", id))
  }
}

/** 小工具（DeskdoWidget）和 App 在同一個 process，點了待辦就記在這裡，App 前端回到前景時來拿 */
object OpenRequest {
  @Volatile var todo: String? = null
}
