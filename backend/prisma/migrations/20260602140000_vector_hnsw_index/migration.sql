-- pgvector HNSW index for faster ANN (cosine distance)
CREATE INDEX IF NOT EXISTS "DocumentVector_embedding_hnsw_idx"
ON "DocumentVector"
USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
