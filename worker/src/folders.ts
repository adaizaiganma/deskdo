import { z } from "zod";
import { BUMP_VERSION } from "./todos";

/**
 * 標籤資料夾：把標籤分組，只影響顯示（每筆待辦仍然只有一個標籤）。
 * 整份清單以 JSON 存在 settings 的 tag_folders，順序就是顯示順序。
 */
export interface Folder {
  name: string;
  tags: string[];
}

const KEY = "tag_folders";

export const foldersSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1, "資料夾名稱不能是空的").max(40),
      tags: z
        .array(
          z
            .string()
            .transform((s) => s.trim().replace(/^[#＃]/, "").trim())
            .pipe(z.string().min(1).max(100)),
        )
        .max(500),
    }),
  )
  .max(100)
  .superRefine((folders, ctx) => {
    const names = new Set<string>();
    for (const [i, f] of folders.entries()) {
      if (names.has(f.name)) ctx.addIssue({ code: "custom", path: [i, "name"], message: `資料夾「${f.name}」重複了` });
      names.add(f.name);
    }
  })
  // 一個標籤只能在一個資料夾裡：重複的保留第一次出現的位置
  .transform((folders) => {
    const seen = new Set<string>();
    return folders.map((f) => ({
      name: f.name,
      tags: f.tags.filter((t) => !seen.has(t) && !!seen.add(t)),
    }));
  });

export async function getFolders(db: D1Database): Promise<Folder[]> {
  try {
    const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(KEY).first<{ value: string }>();
    if (!row) return [];
    const parsed = foldersSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : [];
  } catch {
    // 舊部署可能還沒有 settings 表
    return [];
  }
}

/** 儲存並遞增資料版本號，讓各台電腦下一次輪詢時拿到新的資料夾 */
export async function setFolders(db: D1Database, folders: Folder[]): Promise<void> {
  await db.batch([
    db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .bind(KEY, JSON.stringify(folders)),
    db.prepare(BUMP_VERSION),
  ]);
}
