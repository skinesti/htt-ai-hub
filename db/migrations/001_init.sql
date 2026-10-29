-- 001_init: shared storage for the HTT AI Hub Team Tree.
-- Plain PostgreSQL. Works on Neon or any Postgres 14+.

-- Approved app users (application access only; grants no hosting, database or Drive access).
CREATE TABLE app_users (
  email        text PRIMARY KEY CHECK (email = lower(email) AND position('@' in email) > 1),
  display_name text NOT NULL DEFAULT '',
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Server-side sessions. Only a SHA-256 hash of the cookie token is stored.
CREATE TABLE sessions (
  token_hash  bytea PRIMARY KEY,
  email       text NOT NULL REFERENCES app_users(email) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- The one current tree document.
CREATE TABLE tree_current (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version     integer NOT NULL CHECK (version >= 1),
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL
);

-- Append-only history. Every saved version, including seed, undo, import and restore.
CREATE TABLE tree_revisions (
  version        integer PRIMARY KEY CHECK (version >= 1),
  data           jsonb NOT NULL,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  reason         text NOT NULL CHECK (reason IN ('seed', 'save', 'undo', 'import', 'restore')),
  restored_from  integer REFERENCES tree_revisions(version),
  CHECK ((reason = 'restore') = (restored_from IS NOT NULL))
);

CREATE FUNCTION tree_revisions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'tree_revisions is append-only';
END;
$$;
CREATE TRIGGER tree_revisions_no_update BEFORE UPDATE OR DELETE ON tree_revisions
  FOR EACH ROW EXECUTE FUNCTION tree_revisions_append_only();
CREATE TRIGGER tree_revisions_no_truncate BEFORE TRUNCATE ON tree_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION tree_revisions_append_only();
