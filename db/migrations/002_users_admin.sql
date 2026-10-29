-- 002_users_admin: admin flag, required display names, user audit trail, last-admin and no-delete rules.

-- Every user needs a display name (History shows it). Fill any empty one from the email before the @.
UPDATE app_users SET display_name = split_part(email, '@', 1) WHERE length(trim(display_name)) = 0;

ALTER TABLE app_users
  ADD COLUMN is_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN added_by text,
  ADD CONSTRAINT app_users_display_name_check CHECK (length(trim(display_name)) BETWEEN 1 AND 100),
  ADD CONSTRAINT app_users_email_length_check CHECK (length(email) <= 254);

-- Who added, switched or changed whom, and when. Append-only.
CREATE TABLE user_audit (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor         text NOT NULL,
  target_email  text NOT NULL,
  action        text NOT NULL CHECK (action IN ('add', 'activate', 'deactivate', 'grant_admin', 'revoke_admin', 'rename')),
  detail        text NOT NULL DEFAULT '' CHECK (length(detail) <= 300),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_audit_created_at_idx ON user_audit (created_at DESC, id DESC);

CREATE FUNCTION append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER user_audit_no_update BEFORE UPDATE OR DELETE ON user_audit
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER user_audit_no_truncate BEFORE TRUNCATE ON user_audit
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

-- Users are never deleted, only switched off.
CREATE FUNCTION app_users_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app users are never deleted; switch them off instead';
END;
$$;
CREATE TRIGGER app_users_no_delete BEFORE DELETE ON app_users
  FOR EACH ROW EXECUTE FUNCTION app_users_no_delete();
CREATE TRIGGER app_users_no_truncate BEFORE TRUNCATE ON app_users
  FOR EACH STATEMENT EXECUTE FUNCTION app_users_no_delete();

-- Backstop for every path (app, scripts, direct SQL): a change may not remove the last active admin.
-- The advisory lock (shared with the app) makes simultaneous changes take turns; the check then
-- sees the other change once it is committed.
CREATE FUNCTION app_users_keep_an_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(727001);
  IF EXISTS (SELECT 1 FROM old_rows WHERE active AND is_admin)
     AND NOT EXISTS (SELECT 1 FROM app_users WHERE active AND is_admin) THEN
    RAISE EXCEPTION 'At least one active admin is required' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER app_users_keep_an_admin AFTER UPDATE ON app_users
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app_users_keep_an_admin();
