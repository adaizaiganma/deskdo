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
import java.text.Collator
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.concurrent.thread

/**
 * 主畫面小工具，排版和電腦版的桌面小工具一樣：
 * 上面可以依資料夾、標籤篩選，清單依期限分組，點圓圈直接完成，點標題打開 App。
 * 完成時直接呼叫雲端的 PATCH /api/todos/:id，不需要 App 在執行；App 回到前景時會再同步。
 * App 沒在執行時，系統每 30 分鐘叫一次 onUpdate（deskdo_widget_info.xml），這時自己向雲端抓清單。
 */
class DeskdoWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) update(context, manager, id)
    fetchAsync(context)
  }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: android.os.Bundle) {
    update(context, manager, id) // 改了大小：篩選標籤要重新換行
  }

  override fun onDeleted(context: Context, ids: IntArray) {
    val e = prefs(context).edit()
    for (id in ids) e.remove("$id.folder").remove("$id.tag")
    e.apply()
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    when (intent.action) {
      ACTION_ITEM -> {
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        if (intent.getStringExtra(EXTRA_KIND) == "complete") complete(context, id) else openApp(context, id)
      }
      ACTION_FILTER -> {
        val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1)
        if (widgetId < 0) return
        pickFilter(context, widgetId, intent.getStringExtra(EXTRA_KIND), intent.getStringExtra(EXTRA_VALUE))
        update(context, AppWidgetManager.getInstance(context), widgetId)
        // 有人在用小工具，順便看看雲端有沒有新的；一直切換篩選時不要每次都抓
        fetchAsync(context, FILTER_FETCH_AGE_MS)
      }
    }
  }

  /** 在背景向雲端抓清單，有變就重畫 */
  private fun fetchAsync(context: Context, minAgeMs: Long = 0) {
    val pending = goAsync()
    thread {
      try {
        if (WidgetStore.fetch(context, minAgeMs)) refreshAll(context)
      } finally {
        pending.finish()
      }
    }
  }

  private fun complete(context: Context, id: String) {
    val data = WidgetStore.load(context) ?: return
    if (data.items.find { it.id == id }?.completing != false) return // 不在清單上，或已經在處理
    // 先打勾、把標題劃掉；送出成功後再從清單拿掉（至少停留一下，看得到勾了哪一筆）
    WidgetStore.setCompleting(context, id, true)
    refreshAll(context)
    val started = System.currentTimeMillis()
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
      if (ok) {
        val wait = COMPLETE_SHOW_MS - (System.currentTimeMillis() - started)
        if (wait > 0) Thread.sleep(wait)
        WidgetStore.remove(context, id)
        refreshAll(context)
        // 完成的可能是某一步，下一步要接著出現
        WidgetStore.fetch(context)
      } else {
        WidgetStore.setCompleting(context, id, false)
        Handler(Looper.getMainLooper()).post {
          Toast.makeText(context, tr("無法連線，沒有完成", "Offline, not completed"), Toast.LENGTH_SHORT).show()
        }
      }
      refreshAll(context)
      pending.finish()
    }
  }

  /** 每個小工具各自記住篩選；規則和電腦版一樣：再點一次選中的就取消 */
  private fun pickFilter(context: Context, widgetId: Int, kind: String?, value: String?) {
    val p = prefs(context)
    var folder = p.getString("$widgetId.folder", null)
    var tag = p.getString("$widgetId.tag", null)
    when (kind) {
      "folder" -> {
        folder = if (folder == value && tag == null) null else value
        tag = null
      }
      "tag" -> tag = if (tag == value) null else value
      "loose" -> {
        folder = null
        tag = if (tag == value) null else value
      }
      else -> {
        folder = null
        tag = null
      }
    }
    p.edit().putString("$widgetId.folder", folder).putString("$widgetId.tag", tag).apply()
  }

  /** 清單裡的一列：分組標題或一筆待辦 */
  sealed class Row {
    abstract val stableId: Long

    data class Header(val key: String, val label: String, val sub: String, val tone: Int, val count: Int) : Row() {
      override val stableId get() = ("group:$key").hashCode().toLong()
    }

    data class Item(val item: WidgetStore.Item, val waitingFor: String?) : Row() {
      override val stableId get() = item.id.hashCode().toLong()
    }
  }

  data class Chip(
    val kind: String,
    val value: String?,
    val label: String,
    val count: Int,
    val on: Boolean,
    /** 資料夾展開、但選的是裡面的某個標籤 */
    val open: Boolean = false,
    /** 資料夾裡還沒有待辦的標籤 */
    val idle: Boolean = false,
  )

  /** 一個小工具要顯示的全部內容（依它的篩選算好） */
  class Model(
    val today: String,
    /** 算的時候的時間 HH:mm：今天有時間的待辦過了就算逾期 */
    val now: String,
    val openCount: Int,
    val overdue: Int,
    val chips: List<Chip>,
    val subChips: List<Chip>,
    val rows: List<Row>,
    val empty: String,
  )

  companion object {
    const val ACTION_ITEM = "dev.deskdo.app.WIDGET_ITEM"
    const val ACTION_FILTER = "dev.deskdo.app.WIDGET_FILTER"
    const val EXTRA_ID = "id"
    const val EXTRA_KIND = "kind"
    const val EXTRA_VALUE = "value"

    /** 打勾後至少停留多久才從清單拿掉 */
    private const val COMPLETE_SHOW_MS = 650L

    /** 點篩選時，資料比這個舊才向雲端抓 */
    private const val FILTER_FETCH_AGE_MS = 60_000L

    private fun prefs(context: Context) = context.getSharedPreferences("widget_filter", Context.MODE_PRIVATE)

    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, DeskdoWidget::class.java))
      for (id in ids) update(context, manager, id)
    }

    private fun update(context: Context, manager: AppWidgetManager, widgetId: Int) {
      manager.updateAppWidget(widgetId, build(context, widgetId))
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        @Suppress("DEPRECATION")
        manager.notifyAppWidgetViewDataChanged(widgetId, R.id.list)
      }
    }

    /** 打開 App 並展開這一筆（App 前端回到前景時透過 WidgetPlugin.takeOpen 拿） */
    private fun openApp(context: Context, todoId: String) {
      OpenRequest.todo = todoId
      context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun openAppIntent(context: Context): PendingIntent =
      PendingIntent.getActivity(
        context, 0, Intent(context, MainActivity::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    /** 依這個小工具的篩選，算出要顯示的內容（規則和電腦版的 Widget.svelte 一樣） */
    fun model(context: Context, widgetId: Int, data: WidgetStore.Data?): Model {
      val today = today(data)
      if (data == null || !data.configured) {
        return Model(today, "", 0, 0, emptyList(), emptyList(), emptyList(), tr("打開 Deskdo 完成設定", "Open Deskdo to finish setup"))
      }
      val all = data.items
      val ids = all.map { it.id }.toHashSet()
      val titles = all.associate { it.id to it.title }
      // 前一步還沒完成的步驟：平常不顯示，依標籤、資料夾篩選時淡色顯示
      val waiting = all.filter { it.after != null && it.after in ids }.map { it.id }.toHashSet()
      val open = all.filter { it.id !in waiting }

      val countOf = all.flatMap { it.tags }.groupingBy { it }.eachCount()
      val groups = data.folders.filter { it.tags.isNotEmpty() }
      val inFolders = groups.flatMap { it.tags }.toHashSet()
      val collator = Collator.getInstance(if (WidgetStore.en) Locale.ENGLISH else Locale.TRADITIONAL_CHINESE)
      val loose = all.flatMap { it.tags }.distinct().filter { it !in inFolders }.sortedWith(collator)

      // 篩選的資料夾或標籤已經不在了就往上一層退
      val p = prefs(context)
      val current = groups.find { it.name == p.getString("$widgetId.folder", null) }
      val pool = current?.tags ?: loose
      val tag = p.getString("$widgetId.tag", null)?.takeIf { it in pool }

      val chips = buildList {
        add(Chip("all", null, tr("全部", "All"), open.size, on = current == null && tag == null))
        for (g in groups) {
          // 有好幾個標籤在同一個資料夾的待辦只算一次
          val n = all.count { t -> t.tags.any { it in g.tags } }
          add(Chip("folder", g.name, g.name, n, on = current == g && tag == null, open = current == g))
        }
        for (t in loose) add(Chip("loose", t, "#$t", countOf[t] ?: 0, on = current == null && tag == t))
      }
      val subChips = current?.tags?.map { t ->
        val n = countOf[t] ?: 0
        Chip("tag", t, "#$t", n, on = tag == t, idle = n == 0)
      } ?: emptyList()

      val shown = when {
        tag != null -> all.filter { tag in it.tags }
        current != null -> all.filter { t -> t.tags.any { it in current.tags } }
        else -> open
      }
      val now = SimpleDateFormat("HH:mm", Locale.US).format(Date())
      val rows = groupRows(shown, today, now) { if (it.id in waiting) titles[it.after] else null }
      val empty = when {
        tag != null -> tr("這個標籤沒有待辦", "No to-dos with this tag")
        current != null -> tr("這個資料夾沒有待辦", "No to-dos in this folder")
        else -> tr("沒有待辦事項\n享受一下空白吧", "No to-dos\nEnjoy the empty space")
      }
      val overdue = open.count { isOverdue(it, today, now) }
      return Model(today, now, open.size, overdue, chips, subChips, rows, empty)
    }

    /** App 交來的「今天」可能是好幾天前的（App 很久沒開），這時以手機的日期為準 */
    private fun today(data: WidgetStore.Data?): String {
      val local = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
      val given = data?.today.orEmpty()
      return if (given > local) given else local
    }

    /** 依期限分組，和 App 的 groupTodos 一樣；項目已經排好了 */
    private fun groupRows(items: List<WidgetStore.Item>, today: String, now: String, waitingFor: (WidgetStore.Item) -> String?): List<Row> {
      val keys = listOf("overdue", "today", "tomorrow", "week", "later", "none")
      val buckets = items.groupBy { if (isOverdue(it, today, now)) "overdue" else groupOf(it.due, today) }
      val tomorrow = addDays(today, 1)
      return keys.flatMap { key ->
        val list = buckets[key] ?: return@flatMap emptyList()
        val (label, sub, tone) = when (key) {
          "overdue" -> Triple(tr("逾期", "Overdue"), "", R.color.widget_warn)
          "today" -> Triple(tr("今天", "Today"), longDate(today), R.color.widget_accent)
          "tomorrow" -> Triple(tr("明天", "Tomorrow"), "${weekday(tomorrow)} ${monthDay(tomorrow, today)}", R.color.widget_sub)
          "week" -> Triple(tr("接下來 7 天", "Next 7 days"), "", R.color.widget_sub)
          "later" -> Triple(tr("之後", "Later"), "", R.color.widget_sub)
          else -> Triple(tr("沒有期限", "No due date"), "", R.color.widget_sub)
        }
        listOf(Row.Header(key, label, sub, tone, list.size)) + list.map { Row.Item(it, waitingFor(it)) }
      }
    }

    fun build(context: Context, widgetId: Int): RemoteViews {
      val data = WidgetStore.load(context)
      val m = model(context, widgetId, data)
      val views = RemoteViews(context.packageName, R.layout.widget)
      views.setOnClickPendingIntent(R.id.header, openAppIntent(context))
      views.setTextViewText(R.id.app_title, tr("待辦事項", "Deskdo"))
      val count = tr("${m.openCount} 項待辦", "${m.openCount} to-dos")
      views.setTextViewText(R.id.sub, if (data?.configured == true) "${longDate(m.today)} · $count" else longDate(m.today))
      if (m.overdue > 0) {
        views.setViewVisibility(R.id.overdue, View.VISIBLE)
        views.setTextViewText(R.id.overdue, tr(" · ${m.overdue} 逾期", " · ${m.overdue} overdue"))
      } else {
        views.setViewVisibility(R.id.overdue, View.GONE)
      }

      // 只有「全部」時不顯示篩選列
      fillChips(context, views, R.id.chips, widgetId, if (m.chips.size > 1) m.chips else emptyList(), 0, maxRows = 3)
      fillChips(context, views, R.id.subchips, widgetId, m.subChips, 500, maxRows = 2)

      views.setTextViewText(R.id.empty, m.empty)
      views.setEmptyView(R.id.list, R.id.empty)

      // 列表裡每一列的點擊：共用同一個 PendingIntent，再由每一列補上 id 和動作
      val template = PendingIntent.getBroadcast(
        context, widgetId,
        Intent(context, DeskdoWidget::class.java).setAction(ACTION_ITEM),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
      )
      views.setPendingIntentTemplate(R.id.list, template)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val b = RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(2)
        for (row in m.rows) b.addItem(row.stableId, rowView(context, m.today, m.now, row))
        views.setRemoteAdapter(R.id.list, b.build())
      } else {
        val svc = Intent(context, WidgetService::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
        svc.data = Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME))
        @Suppress("DEPRECATION")
        views.setRemoteAdapter(R.id.list, svc)
      }
      return views
    }

    /** 小工具目前的寬度（dp）；直向時用 MIN_WIDTH */
    private fun widthDp(context: Context, widgetId: Int): Float {
      val w = AppWidgetManager.getInstance(context).getAppWidgetOptions(widgetId)
        .getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
      return if (w > 0) w.toFloat() else 280f
    }

    /** 估計一個篩選標籤的寬度（dp），用來換行；小工具裡量不到實際寬度 */
    private fun chipWidth(context: Context, c: Chip): Float {
      val scale = context.resources.configuration.fontScale
      fun text(s: String, sp: Float) = s.sumOf { ch -> if (ch.code >= 0x2E80) 1.0 else 0.56 }.toFloat() * sp * scale
      val name = minOf(text(c.label, 12.5f), 132f)
      val icon = if (c.kind == "folder") 18f else 0f
      return 22f + icon + name + 5f + text(c.count.toString(), 11f) + 6f
    }

    private fun fillChips(context: Context, views: RemoteViews, container: Int, widgetId: Int, chips: List<Chip>, base: Int, maxRows: Int) {
      views.removeAllViews(container)
      views.setViewVisibility(container, if (chips.isEmpty()) View.GONE else View.VISIBLE)
      // 自己排成好幾排（RemoteViews 沒有會自動換行的排版）；超過 maxRows 排的就不顯示了
      val room = widthDp(context, widgetId) - 28f
      val rows = mutableListOf<MutableList<Int>>()
      var used = room
      chips.indices.forEach { i ->
        val w = chipWidth(context, chips[i])
        if (used + w > room) {
          if (rows.size == maxRows) return@forEach
          rows.add(mutableListOf())
          used = 0f
        }
        rows.last().add(i)
        used += w
      }
      for (row in rows) {
        val line = RemoteViews(context.packageName, R.layout.widget_chip_row)
        for (i in row) line.addView(R.id.row, chipView(context, widgetId, chips[i], base + i))
        views.addView(container, line)
      }
    }

    private fun chipView(context: Context, widgetId: Int, c: Chip, requestCode: Int): RemoteViews {
      val v = RemoteViews(context.packageName, R.layout.widget_chip)
      v.setTextViewText(R.id.name, c.label)
      v.setTextViewText(R.id.n, c.count.toString())
      v.setInt(
        R.id.chip, "setBackgroundResource",
        when {
          c.on -> R.drawable.widget_chip_on
          c.open -> R.drawable.widget_chip_open
          else -> R.drawable.widget_chip
        },
      )
      textColor(
        context, v, R.id.name,
        when {
          c.on -> R.color.widget_on_text
          c.open -> R.color.widget_text
          c.idle -> R.color.widget_faint
          else -> R.color.widget_sub
        },
      )
      textColor(context, v, R.id.n, if (c.on) R.color.widget_on_text else R.color.widget_faint)
      if (c.kind == "folder") {
        v.setViewVisibility(R.id.icon, View.VISIBLE)
        v.setImageViewResource(R.id.icon, if (c.on) R.drawable.widget_ic_folder_on else R.drawable.widget_ic_folder)
      }
      // 每個標籤要有自己的 PendingIntent：用不同的 requestCode 和 data 區分
      val intent = Intent(context, DeskdoWidget::class.java)
        .setAction(ACTION_FILTER)
        .setData(Uri.parse("deskdo-widget://$widgetId/${c.kind}/${Uri.encode(c.value ?: "")}"))
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
        .putExtra(EXTRA_KIND, c.kind)
        .putExtra(EXTRA_VALUE, c.value)
      val pi = PendingIntent.getBroadcast(
        context, widgetId * 1000 + requestCode, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      v.setOnClickPendingIntent(R.id.chip, pi)
      return v
    }

    fun rowView(context: Context, today: String, now: String, row: Row): RemoteViews = when (row) {
      is Row.Header -> {
        val v = RemoteViews(context.packageName, R.layout.widget_group)
        v.setTextViewText(R.id.label, row.label)
        textColor(context, v, R.id.label, row.tone)
        v.setTextViewText(R.id.gsub, row.sub)
        v.setTextViewText(R.id.gcount, row.count.toString())
        v
      }
      is Row.Item -> itemView(context, today, now, row.item, row.waitingFor)
    }

    private fun itemView(context: Context, today: String, now: String, item: WidgetStore.Item, waitingFor: String?): RemoteViews {
      val v = RemoteViews(context.packageName, R.layout.widget_item)
      val high = item.priority == "high"
      val low = item.priority == "low"
      v.setTextViewText(R.id.title, item.title)
      val faint = low || waitingFor != null || item.completing
      textColor(context, v, R.id.title, if (faint) R.color.widget_faint else R.color.widget_text)
      v.setInt(R.id.title, "setPaintFlags", Paint.ANTI_ALIAS_FLAG or (if (item.completing) Paint.STRIKE_THRU_TEXT_FLAG else 0))
      v.setImageViewResource(R.id.check, if (item.completing) R.drawable.widget_check_done else R.drawable.widget_check)

      fun meta(id: Int, show: Boolean, text: String? = null) {
        v.setViewVisibility(id, if (show) View.VISIBLE else View.GONE)
        if (show && text != null) v.setTextViewText(id, text)
      }
      v.setContentDescription(R.id.check, tr("完成", "Complete"))
      meta(R.id.waiting, waitingFor != null, tr("等「$waitingFor」完成", "After \"$waitingFor\""))
      meta(R.id.high, high, tr("高優先", "High"))
      meta(R.id.low, low, tr("低優先", "Low"))
      meta(R.id.tag, item.tags.isNotEmpty(), item.tags.joinToString(" ") { "#$it" })
      meta(R.id.mail, item.mail)
      meta(R.id.note, item.note, tr("備註", "Note"))
      val hasMeta = waitingFor != null || high || low || item.tags.isNotEmpty() || item.mail || item.note
      v.setViewVisibility(R.id.meta, if (hasMeta) View.VISIBLE else View.GONE)

      val due = item.due?.let { rowDue(it, today, item.dueTime, now) }
      if (due == null) {
        v.setViewVisibility(R.id.due, View.GONE)
      } else {
        v.setViewVisibility(R.id.due, View.VISIBLE)
        v.setTextViewText(R.id.count, due.first)
        textColor(context, v, R.id.count, due.third)
        v.setViewVisibility(R.id.date, if (due.second.isEmpty()) View.GONE else View.VISIBLE)
        v.setTextViewText(R.id.date, due.second)
      }
      v.setOnClickFillInIntent(R.id.check, Intent().putExtra(EXTRA_KIND, "complete").putExtra(EXTRA_ID, item.id))
      v.setOnClickFillInIntent(R.id.body, Intent().putExtra(EXTRA_KIND, "open").putExtra(EXTRA_ID, item.id))
      return v
    }

    /** Android 12 起交給系統在顯示時解析顏色，切換深淺色時小工具才會跟著變 */
    private fun textColor(context: Context, v: RemoteViews, id: Int, color: Int) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) v.setColorStateList(id, "setTextColor", color)
      else v.setTextColor(id, context.getColor(color))
    }

    // ── 日期，和 App 的 dates.ts 一樣 ──

    private const val WEEKDAYS = "日一二三四五六"
    private val WEEKDAYS_EN = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
    private val MONTHS_EN = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    /** 依 App 的介面語言選一個 */
    private fun tr(zh: String, en: String) = if (WidgetStore.en) en else zh

    private fun plural(n: Int, one: String) = "$n ${if (n == 1) one else one + "s"}"

    private fun utc() = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

    private fun cal(iso: String): Calendar? = try {
      Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { time = utc().parse(iso)!! }
    } catch (e: Exception) {
      null
    }

    private fun addDays(iso: String, n: Int): String {
      val c = cal(iso) ?: return iso
      c.add(Calendar.DAY_OF_MONTH, n)
      return utc().format(c.time)
    }

    /** b - a，單位為天 */
    private fun diffDays(a: String, b: String): Int? {
      val x = cal(a) ?: return null
      val y = cal(b) ?: return null
      return Math.round((y.timeInMillis - x.timeInMillis) / 86_400_000.0).toInt()
    }

    private fun weekday(iso: String): String {
      val c = cal(iso) ?: return ""
      val d = c.get(Calendar.DAY_OF_WEEK) - 1
      return if (WidgetStore.en) WEEKDAYS_EN[d] else "週" + WEEKDAYS[d]
    }

    private fun monthDay(iso: String, today: String): String {
      val c = cal(iso) ?: return iso
      val md = "${c.get(Calendar.MONTH) + 1}/${c.get(Calendar.DAY_OF_MONTH)}"
      return if (iso.take(4) == today.take(4)) md else "${c.get(Calendar.YEAR)}/$md"
    }

    private fun longDate(iso: String): String {
      val c = cal(iso) ?: return iso
      if (WidgetStore.en) return "${weekday(iso)}, ${MONTHS_EN[c.get(Calendar.MONTH)]} ${c.get(Calendar.DAY_OF_MONTH)}"
      return "${c.get(Calendar.MONTH) + 1}月${c.get(Calendar.DAY_OF_MONTH)}日 ${weekday(iso)}"
    }

    private fun groupOf(due: String?, today: String): String {
      if (due == null) return "none"
      val n = diffDays(today, due) ?: return "none"
      return when {
        n < 0 -> "overdue"
        n == 0 -> "today"
        n == 1 -> "tomorrow"
        n <= 7 -> "week"
        else -> "later"
      }
    }

    /** 過期了沒：期限在今天以前，或今天到期而且時間已經過了 */
    private fun isOverdue(item: WidgetStore.Item, today: String, now: String): Boolean {
      val due = item.due ?: return false
      return due < today || (due == today && item.dueTime != null && item.dueTime < now)
    }

    /** 右側的期限：倒數（逾期 2 天／今天到期／今天 15:00／還有 3 天）、日期（加上時間）、顏色 */
    private fun rowDue(due: String, today: String, time: String?, now: String): Triple<String, String, Int>? {
      val n = diffDays(today, due) ?: return null
      val at = if (time != null) " $time" else ""
      val date = (if (n in 0..7) "${weekday(due)} ${monthDay(due, today)}" else monthDay(due, today)) + at
      return when {
        n < 0 -> Triple(tr("逾期 ${-n} 天", "${plural(-n, "day")} overdue"), date, R.color.widget_warn)
        n == 0 && time == null -> Triple(tr("今天到期", "Due today"), "", R.color.widget_warn)
        n == 0 && time != null && time < now -> Triple(tr("已逾期", "Overdue"), tr("今天", "Today") + at, R.color.widget_warn)
        n == 0 -> Triple(tr("今天", "Today") + at, "", R.color.widget_warn)
        else -> Triple(tr("還有 $n 天", "${plural(n, "day")} left"), date, if (n <= 3) R.color.widget_accent else R.color.widget_sub)
      }
    }
  }
}

/** Android 12 以前的列表要透過這個 Service 提供每一列 */
class WidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
    Factory(applicationContext, intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1))

  private class Factory(private val context: Context, private val widgetId: Int) : RemoteViewsFactory {
    private var model: DeskdoWidget.Model? = null
    override fun onCreate() {}
    override fun onDataSetChanged() {
      model = DeskdoWidget.model(context, widgetId, WidgetStore.load(context))
    }
    override fun onDestroy() {}
    override fun getCount() = model?.rows?.size ?: 0
    override fun getViewAt(position: Int): RemoteViews {
      val m = model ?: return RemoteViews(context.packageName, R.layout.widget_item)
      return DeskdoWidget.rowView(context, m.today, m.now, m.rows[position])
    }
    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount() = 2
    override fun getItemId(position: Int) = model?.rows?.getOrNull(position)?.stableId ?: position.toLong()
    override fun hasStableIds() = true
  }
}
