package dev.deskdo.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

/** 小工具的資料：App 最後一次交過來的清單（widget.json，放在 App 自己的資料夾） */
object WidgetStore {
  data class Item(
    val id: String,
    val title: String,
    val due: String?,
    /** 期限的時間 HH:mm；null 是一整天 */
    val dueTime: String?,
    val tags: List<String>,
    val priority: String,
    /** 還沒完成的前一步；有的話這一步還沒輪到 */
    val after: String?,
    val mail: Boolean,
    val note: Boolean,
    /** 在小工具上勾了完成、正在顯示打勾（只有小工具自己用，App 不會送這個） */
    val completing: Boolean = false,
  )

  data class Folder(val name: String, val tags: List<String>)

  data class Data(
    val apiBase: String,
    val apiToken: String,
    val today: String,
    val configured: Boolean,
    val folders: List<Folder>,
    /** 所有還沒完成的，已經依期限排好 */
    val items: List<Item>,
  )

  private fun file(context: Context) = File(context.filesDir, "widget.json")

  /** 每存一次就加一：自己抓資料的途中 App 交來了新的、或勾了完成，抓回來的就不要蓋掉 */
  private var version = 0L

  /** 上次拿到雲端資料的時間（自己抓的，或 App 交來的） */
  @Volatile private var fetchedAt = 0L

  private val fetching = AtomicBoolean(false)

  @Synchronized
  fun save(context: Context, json: String) {
    val f = file(context)
    val tmp = File(f.path + ".tmp")
    tmp.writeText(json)
    tmp.renameTo(f)
    version++
  }

  /** App 交來的整份資料（WidgetPlugin.update） */
  fun saveFromApp(context: Context, json: String) {
    save(context, json)
    fetchedAt = System.currentTimeMillis()
  }

  @Synchronized
  fun raw(context: Context): String? = file(context).takeIf { it.exists() }?.readText()

  private fun str(o: JSONObject, key: String): String? =
    if (o.isNull(key)) null else o.optString(key).takeIf { it.isNotEmpty() }

  /** 標籤：雲端版本 6 起是 tags 陣列，舊版只有一個 tag */
  private fun tagsOf(o: JSONObject): List<String> {
    val arr = o.optJSONArray("tags")
    val tags = if (arr == null) emptyList() else (0 until arr.length()).mapNotNull { arr.optString(it).takeIf { s -> s.isNotEmpty() } }
    return tags.ifEmpty { listOfNotNull(str(o, "tag")) }
  }

  fun load(context: Context): Data? {
    val o = try {
      JSONObject(raw(context) ?: return null)
    } catch (e: Exception) {
      return null
    }
    val arr = o.optJSONArray("items") ?: JSONArray()
    val items = (0 until arr.length()).map { i ->
      val it = arr.getJSONObject(i)
      Item(
        id = it.getString("id"),
        title = it.optString("title"),
        due = str(it, "due"),
        dueTime = str(it, "dueTime"),
        tags = tagsOf(it),
        priority = it.optString("priority", "normal"),
        after = str(it, "after"),
        mail = it.optBoolean("mail"),
        note = it.optBoolean("note"),
        completing = it.optBoolean("completing"),
      )
    }
    val fa = o.optJSONArray("folders") ?: JSONArray()
    val folders = (0 until fa.length()).map { i ->
      val f = fa.getJSONObject(i)
      val tags = f.optJSONArray("tags") ?: JSONArray()
      Folder(f.optString("name"), (0 until tags.length()).map { tags.getString(it) })
    }
    return Data(
      apiBase = o.optString("apiBase"),
      apiToken = o.optString("apiToken"),
      today = o.optString("today"),
      configured = o.optBoolean("configured"),
      folders = folders,
      items = items,
    )
  }

  /** 在小工具上勾了完成：先標成打勾，送出成功再 remove，失敗就取消標記 */
  @Synchronized
  fun setCompleting(context: Context, id: String, on: Boolean) = edit(context) { arr ->
    for (i in 0 until arr.length()) {
      val it = arr.getJSONObject(i)
      if (it.getString("id") == id) it.put("completing", on)
    }
    arr
  }

  @Synchronized
  fun remove(context: Context, id: String) = edit(context) { arr ->
    val next = JSONArray()
    for (i in 0 until arr.length()) {
      val it = arr.getJSONObject(i)
      if (it.getString("id") != id) next.put(it)
    }
    next
  }

  private fun edit(context: Context, change: (JSONArray) -> JSONArray) {
    val o = JSONObject(raw(context) ?: return)
    o.put("items", change(o.optJSONArray("items") ?: return))
    save(context, o.toString())
  }

  /**
   * 不靠 App，自己向雲端抓一次清單（GET /api/todos），換掉小工具的待辦和資料夾；
   * 在別的裝置、電腦版或 Claude 改過的，App 沒開也看得到。
   * 要在背景執行緒呼叫；[minAgeMs] 內已經拿過新資料就不抓。有換掉內容時回傳 true。
   */
  fun fetch(context: Context, minAgeMs: Long = 0): Boolean {
    if (System.currentTimeMillis() - fetchedAt < minAgeMs) return false
    if (!fetching.compareAndSet(false, true)) return false
    try {
      val (base, token, started) = synchronized(this) {
        val o = try {
          JSONObject(raw(context) ?: return false)
        } catch (e: Exception) {
          return false
        }
        if (!o.optBoolean("configured")) return false
        Triple(o.optString("apiBase"), o.optString("apiToken"), version)
      }
      val body = try {
        val conn = URL(base.trim().trimEnd('/') + "/api/todos?status=open").openConnection() as HttpURLConnection
        conn.connectTimeout = 8_000
        conn.readTimeout = 10_000
        conn.setRequestProperty("Authorization", "Bearer " + token.trim())
        try {
          if (conn.responseCode != 200) return false
          conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
          conn.disconnect()
        }
      } catch (e: Exception) {
        return false
      }
      val data = try {
        JSONObject(body)
      } catch (e: Exception) {
        return false
      }
      synchronized(this) {
        if (version != started) return false
        val o = JSONObject(raw(context) ?: return false)
        val old = o.optJSONArray("items") ?: JSONArray()
        val completing = (0 until old.length()).map { old.getJSONObject(it) }
          .filter { it.optBoolean("completing") }.map { it.getString("id") }.toHashSet()
        o.put("today", data.optString("today", o.optString("today")))
        // 雲端版本 4 起才有資料夾；舊版沒有這個欄位就當作沒有資料夾
        o.put("folders", data.optJSONArray("folders") ?: JSONArray())
        o.put("items", items(data.optJSONArray("todos") ?: JSONArray(), completing))
        val json = o.toString()
        fetchedAt = System.currentTimeMillis()
        if (json == raw(context)) return false
        save(context, json)
        return true
      }
    } finally {
      fetching.set(false)
    }
  }

  /** 雲端的待辦換成小工具的格式，排法和 src/mobile.rs 的 widget_items 一樣 */
  private fun items(todos: JSONArray, completing: Set<String>): JSONArray {
    val open = (0 until todos.length()).map { todos.getJSONObject(it) }.filter { !it.optBoolean("done") }
    val ids = open.map { it.getString("id") }.toHashSet()
    fun rank(p: String) = when (p) {
      "high" -> 0
      "low" -> 2
      else -> 1
    }
    val sorted = open.sortedWith(
      compareBy<JSONObject>({ str(it, "due") == null }, { str(it, "due") })
        // 同一天：有時間的照時間排在前面，一整天的在後面
        .thenBy { str(it, "dueTime") == null }
        .thenBy { str(it, "dueTime") }
        .thenBy { rank(it.optString("priority", "normal")) }
        .thenBy { it.optString("createdAt") },
    ).take(WIDGET_LIMIT)
    val out = JSONArray()
    for (t in sorted) {
      val id = t.getString("id")
      out.put(
        JSONObject()
          .put("id", id)
          .put("title", t.optString("title"))
          .put("due", str(t, "due") ?: JSONObject.NULL)
          .put("dueTime", str(t, "due")?.let { str(t, "dueTime") } ?: JSONObject.NULL)
          .put("tags", JSONArray(tagsOf(t)))
          .put("priority", t.optString("priority", "normal"))
          .put("after", str(t, "afterId")?.takeIf { it in ids } ?: JSONObject.NULL)
          .put("mail", t.optString("source") == "email")
          .put("note", str(t, "note")?.isNotBlank() == true)
          .apply { if (id in completing) put("completing", true) },
      )
    }
    return out
  }

  /** 和 src/mobile.rs 的 WIDGET_LIMIT 一樣 */
  private const val WIDGET_LIMIT = 300
}
