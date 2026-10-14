-- Embeddings for semantic search. Migration 003 is owned by the MFA pull request.
-- Stored width matches EMBEDDING_DIMENSIONS in embed.ts.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS embeddings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  embedding vector(64) NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (node_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS embeddings_project_idx ON embeddings (project_id, tenant_id);
CREATE INDEX IF NOT EXISTS embeddings_cosine_idx ON embeddings USING hnsw (embedding vector_cosine_ops);
