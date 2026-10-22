ALTER TABLE study_memories
ADD COLUMN conversation_id TEXT;

CREATE INDEX IF NOT EXISTS study_memories_conversation_idx
ON study_memories(conversation_id);
