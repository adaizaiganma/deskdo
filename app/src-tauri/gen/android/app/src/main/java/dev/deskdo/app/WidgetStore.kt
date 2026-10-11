package dev.deskdo.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** 小工具的資料：App 最後一次交過來的清單（widget.json，放在 App 自己的資料夾） */
object WidgetStore {
  data class Item(
    val id: String,
    val title: String,
    val due: String?,
    val tag: String?,
    val priority: String,
    /** 還沒完成的前一步；有的話這一步還沒輪到 */
    val after: String?,
    val mail: Boolean,
    val note: Boolean,
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

  @Synchronized
  fun save(context: Context, json: String) {
    val f = file(context)
    val tmp = File(f.path + ".tmp")
    tmp.writeText(json)
    tmp.renameTo(f)
  }

  @Synchronized
  fun raw(context: Context): String? = file(context).takeIf { it.exists() }?.readText()

  private fun str(o: JSONObject, key: String): String? =
    if (o.isNull(key)) null else o.optString(key).takeIf { it.isNotEmpty() }

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
        tag = str(it, "tag"),
        priority = it.optString("priority", "normal"),
        after = str(it, "after"),
        mail = it.optBoolean("mail"),
        note = it.optBoolean("note"),
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

  /** 在小工具上勾了完成：先從清單拿掉，回傳原本的內容；送出失敗時用 save 放回去 */
  @Synchronized
  fun remove(context: Context, id: String): String? {
    val before = raw(context) ?: return null
    val o = JSONObject(before)
    val arr = o.optJSONArray("items") ?: return before
    val next = JSONArray()
    for (i in 0 until arr.length()) {
      val it = arr.getJSONObject(i)
      if (it.getString("id") != id) next.put(it)
    }
    o.put("items", next)
    save(context, o.toString())
    return before
  }
}
