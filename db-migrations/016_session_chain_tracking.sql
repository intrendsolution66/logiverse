-- 016_session_chain_tracking.sql
--
-- Fixes a real accuracy problem before it becomes "研判学生程度" data: every
-- refresh-token rotation (see auth.controller.ts#refreshToken) revokes the
-- old auth.user_sessions row and INSERTs a brand new one. That's correct
-- security practice (each refresh token used exactly once), but it means
-- what the STUDENT experiences as "one login session" is actually many
-- short-lived rows chained together — roughly one new row every access-
-- token lifetime. Computing study time from a single row's
-- created_at→revoked_at would only capture the gap between two consecutive
-- refreshes, not the real session length.
--
-- session_chain_id fixes this: every row in one continuous login (the
-- original login + every rotation that followed it) shares the same
-- chain_id. A NEW login sets chain_id = its own id (chain root); a
-- ROTATED refresh copies the PREVIOUS row's chain_id forward. Reconstructing
-- "how long was this student actually logged in" is then just
-- GROUP BY session_chain_id, MIN(created_at) → MAX(last activity).
--
-- Existing rows (before this migration) can't have their real chain
-- relationships reconstructed retroactively, so they're backfilled as their
-- own standalone chain root (chain_id = id) — fine for this dev/test
-- dataset; going forward every new login/rotation chains correctly.

BEGIN;

ALTER TABLE auth.user_sessions ADD COLUMN IF NOT EXISTS session_chain_id uuid;
UPDATE auth.user_sessions SET session_chain_id = id WHERE session_chain_id IS NULL;
ALTER TABLE auth.user_sessions ALTER COLUMN session_chain_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_chain ON auth.user_sessions(session_chain_id);

COMMIT;
