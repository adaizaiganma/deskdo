-- 新增低優先度 'low'。SQLite 不能修改 CHECK 條件，只能重建資料表。
-- 設定精靈和 wrangler 都會把整個檔案放在同一批執行，任何一句失敗都會整批復原，不會只做一半。
CREATE TABLE todos_new (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  doneAt     TEXT,
  due        TEXT,                                  -- YYYY-MM-DD 或 NULL
  tag        TEXT,
  priority   TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
  note       TEXT,
  createdAt  TEXT NOT NULL,                         -- ISO 8601 (UTC)
  updatedAt  TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'claude', 'email')),
  sourceRef  TEXT                                   -- 例如 Gmail message id，用來防止重複新增
);

INSERT INTO todos_new (id, title, done, doneAt, due, tag, priority, note, createdAt, updatedAt, source, sourceRef)
  SELECT id, title, done, doneAt, due, tag, priority, note, createdAt, updatedAt, source, sourceRef FROM todos;

DROP TABLE todos;
ALTER TABLE todos_new RENAME TO todos;

CREATE UNIQUE INDEX idx_todos_sourceRef ON todos (sourceRef) WHERE sourceRef IS NOT NULL;
CREATE INDEX idx_todos_done_due ON todos (done, due);
