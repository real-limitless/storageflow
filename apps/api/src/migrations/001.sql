-- Historical empty-database schema for migration 001.
-- Fresh installs apply schema.sql and record 001, 002, and 003.
-- A database that already recorded 001 receives migrations/002.sql.
CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text,
  transfer_plan text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL
);

CREATE TABLE memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  description text NOT NULL DEFAULT '',
  color text,
  starred boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);

CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE portals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE drawers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  mode text NOT NULL,
  backend_kind text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  color text,
  starred boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  endpoint text,
  region text,
  bucket text,
  prefix text NOT NULL DEFAULT '',
  path_style boolean NOT NULL DEFAULT true,
  access_key text,
  secret_cipher text,
  health_ok boolean,
  health_message text,
  health_checked_at timestamptz,
  cache_listed_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE nodes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  drawer_id uuid NOT NULL REFERENCES drawers(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES nodes(id) ON DELETE CASCADE,
  backend_key text NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  size bigint,
  content_type text,
  modified_at timestamptz,
  etag text,
  starred boolean NOT NULL DEFAULT false,
  color text,
  incomplete boolean NOT NULL DEFAULT false,
  cached_at timestamptz NOT NULL,
  UNIQUE (drawer_id, backend_key)
);

CREATE TABLE grants (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  portal_id uuid REFERENCES portals(id) ON DELETE CASCADE,
  grantee_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  grantee_email text,
  anyone_with_link boolean NOT NULL DEFAULT false,
  password_hash text,
  token_hash text,
  token_cipher text,
  can_list boolean NOT NULL DEFAULT false,
  can_download boolean NOT NULL DEFAULT false,
  can_upload boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  can_reshare boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  download_cap integer,
  download_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  active_tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  kind text NOT NULL,
  portal_id uuid,
  guest_email text,
  link_grant_id uuid,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE activity (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid,
  node_id uuid,
  actor_user_id uuid,
  actor_email text,
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL
);

CREATE TABLE publications (
  id uuid PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  title text NOT NULL,
  visibility text NOT NULL,
  note text NOT NULL DEFAULT '',
  download_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  unpublished_at timestamptz
);

CREATE TABLE tickets (
  id uuid PRIMARY KEY,
  publication_id uuid NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  visitor_hash text NOT NULL,
  user_id uuid,
  plan text NOT NULL,
  created_at timestamptz NOT NULL,
  ready_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  bytes_sent bigint NOT NULL DEFAULT 0,
  active_connection boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open'
);

CREATE TABLE upload_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  drawer_id uuid NOT NULL,
  folder_id uuid NOT NULL,
  actor_user_id uuid,
  backend_key text NOT NULL,
  name text NOT NULL,
  size bigint NOT NULL,
  content_type text,
  transport text NOT NULL,
  multipart_upload_id text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  drawer_id uuid,
  project_id uuid,
  kind text NOT NULL,
  status text NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  message text,
  error text,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pane_sizes jsonb NOT NULL,
  view_mode text NOT NULL DEFAULT 'grid',
  zoom integer NOT NULL DEFAULT 2,
  last_project_id uuid,
  default_project_id uuid,
  location_tabs jsonb NOT NULL DEFAULT '[]',
  favorites_only boolean NOT NULL DEFAULT false,
  starred_first boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, tenant_id)
);

CREATE TABLE magic_links (
  token_hash text PRIMARY KEY,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE transfer_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  free_wait_seconds integer NOT NULL,
  free_bytes_per_second integer NOT NULL,
  free_daily_bytes bigint NOT NULL,
  free_cooldown_seconds integer NOT NULL,
  paid_bytes_per_second integer NOT NULL,
  paid_daily_bytes bigint NOT NULL,
  ticket_ttl_seconds integer NOT NULL
);

CREATE TABLE abuse_reports (
  id uuid PRIMARY KEY,
  publication_id uuid NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX nodes_parent_idx ON nodes (drawer_id, parent_id);
CREATE INDEX nodes_name_idx ON nodes (tenant_id, name);
CREATE INDEX activity_project_idx ON activity (project_id, created_at);
CREATE INDEX tickets_visitor_idx ON tickets (visitor_hash, created_at);
CREATE INDEX grants_portal_idx ON grants (portal_id);
