-- 每台電腦各有一把 token（只存 SHA-256），可以個別撤銷
CREATE TABLE devices (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  tokenHash   TEXT NOT NULL UNIQUE,
  createdAt   TEXT NOT NULL,                        -- ISO 8601 (UTC)
  lastSeenAt  TEXT                                  -- 最多每小時更新一次
);

-- 文字型設定，例如 mcp_secret（claude.ai 連接器網址裡的密鑰）
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
