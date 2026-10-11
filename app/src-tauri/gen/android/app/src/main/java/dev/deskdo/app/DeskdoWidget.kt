package dev.deskdo.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Paint
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import android.widget.Toast
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.concurrent.thread

/**
 * 主畫面小工具：列出目前可以做的待辦（依期限排），點圓圈直接完成，點標題打開 App。
 * 完成時直接呼叫雲端的 PATCH /api/todos/:id，不需要 App 在執行；App 回到前景時會再同步。
 */
class DeskdoWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, build(context, id))
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action != ACTION_ITEM) return
    val id = intent.getStringExtra(EXTRA_ID) ?: return
    when (intent.getStringExtra(EXTRA_KIND)) {
      "complete" -> complete(context, id)
      else -> openApp(context)
    }
  }

  private fun complete(context: Context, id: String) {
    val data = WidgetStore.load(context) ?: return
    val before = WidgetStore.remove(context, id)
    refreshAll(context)
    val pending = goAsync()
    thread {
      val ok = try {
        val conn = URL(data.apiBase.trimEnd('/') + "/api/todos/" + Uri.encode(id)).openConnection() as HttpURLConnection
        conn.requestMethod = "PATCH"
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        conn.doOutput = true
        conn.setRequestProperty("Authorization", "Bearer " + data.apiToken)
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write("{\"done\":true}".toByteArray()) }
        val code = conn.responseCode
        conn.disconnect()
        // 404：已經被刪掉了，從小工具拿掉就好
        code in 200..299 || code == 404
      } catch (e: Exception) {
        false
      }
      if (!ok && before != null) {
        WidgetStore.save(context, before)
        refreshAll(context)
        Handler(Looper.getMainLooper()).post {
          Toast.makeText(context, "無法連線，沒有完成", Toast.LENGTH_SHORT).show()
        }
      }
      pending.finish()
    }
  }

  companion object {
    const val ACTION_ITEM = "dev.deskdo.app.WIDGET_ITEM"
    const val EXTRA_ID = "id"
    const val EXTRA_KIND = "kind"

    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, DeskdoWidget::class.java))
      if (ids.isEmpty()) return
      for (id in ids) manager.updateAppWidget(id, build(context, id))
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        @Suppress("DEPRECATION")
        manager.notifyAppWidgetViewDataChanged(ids, R.id.list)
      }
    }

    private fun openApp(context: Context) {
      context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun openAppIntent(context: Context): PendingIntent =
      PendingIntent.getActivity(
        context, 0, Intent(context, MainActivity::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    fun build(context: Context, widgetId: Int): RemoteViews {
      val data = WidgetStore.load(context)
      val views = RemoteViews(context.packageName, R.layout.widget)
      val count = data?.items?.size ?: 0
      views.setTextViewText(R.id.count, if (count > 0) count.toString() else "")
      views.setOnClickPendingIntent(R.id.header, openAppIntent(context))
      views.setTextViewText(
        R.id.empty,
        if (data == null || !data.configured) "打開 Deskdo 完成設定" else "沒有待辦事項",
      )
      views.setEmptyView(R.id.list, R.id.empty)

      // 列表裡每一列的點擊：共用同一個 PendingIntent，再由每一列補上 id 和動作
      val template = PendingIntent.getBroadcast(
        context, widgetId,
        Intent(context, DeskdoWidget::class.java).setAction(ACTION_ITEM),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
      )
      views.setPendingIntentTemplate(R.id.list, template)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val b = RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(1)
        data?.items?.forEach { b.addItem(it.id.hashCode().toLong(), itemView(context, data, it)) }
        views.setRemoteAdapter(R.id.list, b.build())
      } else {
        val svc = Intent(context, WidgetService::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
        svc.data = Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME))
        @Suppress("DEPRECATION")
        views.setRemoteAdapter(R.id.list, svc)
      }
      return views
    }

    fun itemView(context: Context, data: WidgetStore.Data, item: WidgetStore.Item): RemoteViews {
      val v = RemoteViews(context.packageName, R.layout.widget_item)
      v.setTextViewText(R.id.title, item.title)
      v.setTextColor(R.id.title, context.getColor(if (item.priority == "low") R.color.widget_faint else R.color.widget_text))
      val flags = Paint.ANTI_ALIAS_FLAG or (if (item.priority == "high") Paint.FAKE_BOLD_TEXT_FLAG else 0)
      v.setInt(R.id.title, "setPaintFlags", flags)
      val (label, tone) = dueLabel(item.due, data.today)
      if (label == null) {
        v.setViewVisibility(R.id.due, View.GONE)
      } else {
        v.setViewVisibility(R.id.due, View.VISIBLE)
        v.setTextViewText(R.id.due, label)
        v.setTextColor(R.id.due, context.getColor(tone))
      }
      if (item.tag != null) {
        v.setViewVisibility(R.id.tag, View.VISIBLE)
        v.setTextViewText(R.id.tag, "#" + item.tag)
      } else {
        v.setViewVisibility(R.id.tag, View.GONE)
      }
      v.setOnClickFillInIntent(R.id.check, Intent().putExtra(EXTRA_KIND, "complete").putExtra(EXTRA_ID, item.id))
      v.setOnClickFillInIntent(R.id.body, Intent().putExtra(EXTRA_KIND, "open").putExtra(EXTRA_ID, item.id))
      return v
    }

    private val WEEKDAYS = arrayOf("週日", "週一", "週二", "週三", "週四", "週五", "週六")

    /** 期限顯示成「逾期」「今天」「明天」「週五」或「10/15」，和 App 一樣 */
    fun dueLabel(due: String?, today: String): Pair<String?, Int> {
      if (due == null) return null to R.color.widget_faint
      val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
      return try {
        val d = fmt.parse(due)!!
        val t = fmt.parse(today.ifEmpty { fmt.format(Date()) })!!
        val days = ((d.time - t.time) / 86_400_000L).toInt()
        val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { time = d }
        when {
          days < 0 -> "逾期" to R.color.widget_warn
          days == 0 -> "今天" to R.color.widget_accent
          days == 1 -> "明天" to R.color.widget_sub
          days < 7 -> WEEKDAYS[cal.get(Calendar.DAY_OF_WEEK) - 1] to R.color.widget_sub
          else -> "${cal.get(Calendar.MONTH) + 1}/${cal.get(Calendar.DAY_OF_MONTH)}" to R.color.widget_faint
        }
      } catch (e: Exception) {
        due to R.color.widget_faint
      }
    }
  }
}

/** Android 12 以前的列表要透過這個 Service 提供每一列 */
class WidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Factory(applicationContext)

  private class Factory(private val context: Context) : RemoteViewsFactory {
    private var data: WidgetStore.Data? = null
    override fun onCreate() {}
    override fun onDataSetChanged() {
      data = WidgetStore.load(context)
    }
    override fun onDestroy() {}
    override fun getCount() = data?.items?.size ?: 0
    override fun getViewAt(position: Int): RemoteViews {
      val d = data ?: return RemoteViews(context.packageName, R.layout.widget_item)
      return DeskdoWidget.itemView(context, d, d.items[position])
    }
    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount() = 1
    override fun getItemId(position: Int) = data?.items?.getOrNull(position)?.id?.hashCode()?.toLong() ?: position.toLong()
    override fun hasStableIds() = true
  }
}
