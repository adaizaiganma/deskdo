-- 一筆待辦可以有好幾個標籤：tags 存 JSON 陣列。tag 留著放第一個標籤，舊版 App 還讀得到。
-- 期限可以帶時間：dueTime 是 HH:MM（當地時間），沒有時間就是一整天的待辦。
ALTER TABLE todos ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE todos ADD COLUMN dueTime TEXT;
UPDATE todos SET tags = json_array(tag) WHERE tag IS NOT NULL;
