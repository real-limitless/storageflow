-- Upgrade a database that already applied migration 001.
-- Fresh databases apply schema.sql instead, which already includes this end state.

ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'user';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS version_retention integer NOT NULL DEFAULT 10;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE users ADD CONSTRAINT users_kind_check CHECK (kind IN ('user', 'service'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE tenants ADD CONSTRAINT tenants_version_retention_check CHECK (version_retention >= 1);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'member'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE project_members ADD CONSTRAINT project_members_role_check CHECK (role IN ('owner', 'member'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  scopes jsonb NOT NULL,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS file_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  version integer NOT NULL,
  storage_key text NOT NULL,
  size bigint,
  author_user_id uuid,
  created_at timestamptz NOT NULL,
  UNIQUE (node_id, version)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id uuid,
  action text NOT NULL,
  target_type text,
  target_id text,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS nodes_sort_idx ON nodes (drawer_id, parent_id, sort_order);
CREATE INDEX IF NOT EXISTS file_versions_node_idx ON file_versions (node_id, version);
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON api_keys (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS audit_log_tenant_idx ON audit_log (tenant_id, created_at);
