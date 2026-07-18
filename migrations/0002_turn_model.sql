-- 混合路由：記錄模型回合實際使用的模型（scripted/deterministic 回合為 NULL）
ALTER TABLE turn_events ADD COLUMN model TEXT;
