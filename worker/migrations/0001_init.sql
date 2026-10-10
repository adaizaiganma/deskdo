-- 待辦事項主表
CREATE TABLE todos (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  doneAt     TEXT,
  due        TEXT,                                  -- YYYY-MM-DD 或 NULL
  tag        TEXT,
  priority   TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal')),
  note       TEXT,
  createdAt  TEXT NOT NULL,                         -- ISO 8601 (UTC)
  updatedAt  TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'claude', 'email')),
  sourceRef  TEXT                                   -- 例如 Gmail message id，用來防止重複新增
);

CREATE UNIQUE INDEX idx_todos_sourceRef ON todos (sourceRef) WHERE sourceRef IS NOT NULL;
CREATE INDEX idx_todos_done_due ON todos (done, due);

-- 資料版本號：每次寫入 +1，桌面端用 ETag 判斷是否需要重新下載
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO meta (key, value) VALUES ('version', 0);
