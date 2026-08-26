-- ════════════════════════════════════════════════════════════════════════════
--  CEO OFFICE TASK PLATFORM · 08_grants.sql
--  Table-level privileges for the `authenticated` role. Runs LAST, because
--  every object it names has to exist first.
--
--  ── Read this before changing anything here ─────────────────────────────────
--
--  A GRANT here does NOT grant access to any row. Postgres checks privileges
--  and RLS as two separate gates, and a caller must pass BOTH:
--
--      GRANT  →  "may this role touch this table at all?"
--      POLICY →  "which rows, specifically?"
--
--  With no policy for an operation, RLS denies every row regardless of the
--  grant. That is exactly how three of this schema's guarantees are enforced,
--  and it is why the blanket grants below are safe:
--
--    • task_comments has no INSERT/UPDATE/DELETE policy → comments can be
--      written only by add_comment() and can never be edited or removed.
--    • audit_log has no INSERT/UPDATE/DELETE policy → rows can be written only
--      by _audit() and can never be altered by anyone.
--    • tasks has no DELETE policy → a direct `delete from tasks` is refused
--      even for the CEO; deletion goes through the RPCs in 06_cr01_delete.sql.
--
--  This mirrors how Supabase grants privileges to `authenticated` and leaves
--  the real decision to RLS — same shape, same guarantees, so the 41 security
--  tests mean the same thing here as they did there.
--
--  The danger to watch for is the inverse of the usual one: adding a POLICY is
--  what widens access, not adding a grant. Grep for `create policy` when
--  reviewing a change to this schema.
-- ════════════════════════════════════════════════════════════════════════════

grant select, insert, update, delete on
  profiles,
  tasks,
  task_assignments,
  task_comments,
  task_attachments,
  audit_log,
  notifications
to authenticated;

-- Identity columns (`generated always as identity`) draw from sequences, and
-- inserting without this fails with a bare permission error on the sequence
-- rather than on the table — which is a confusing thing to debug at 2am.
grant usage, select on all sequences in schema public to authenticated;

-- Objects created by a LATER migration would otherwise land ungranted, and the
-- failure shows up only when someone exercises the new table. Default
-- privileges make the grant automatic for anything this same role creates from
-- here on.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
