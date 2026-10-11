-- 接續的待辦：afterId 指向「前一步」。前一步還沒完成時，這一筆先不顯示。
-- 每筆最多一個前一步、一個下一步（一條直線），由 Worker 維護。
ALTER TABLE todos ADD COLUMN afterId TEXT;
CREATE INDEX idx_todos_afterId ON todos (afterId) WHERE afterId IS NOT NULL;
