-- ════════════════════════════════════════════════════════════════════════════
--  CEO OFFICE TASK PLATFORM · 00_compat.sql
--  The keystone of the Supabase → RDS migration. Run FIRST, before 01_schema.
--
--  ── Why this file exists ────────────────────────────────────────────────────
--
--  Every access decision in this product is made by Postgres Row-Level
--  Security, not by application code. That was a deliberate choice (see
--  PROJECT_PLAN.md#stack-decision): the central requirement is that one
--  stakeholder can never see a co-assignee's status, promised date or
--  comments, and expressing that as a row predicate means it holds on every
--  query path — including ones nobody has written yet.
--
--  RLS is a PostgreSQL feature, not a Supabase feature. It moves to RDS
--  untouched. What does NOT move is the two Supabase-specific things the
--  policies lean on:
--
--    1. `auth.uid()`   — the current user's id
--    2. `authenticated` — the role the policies are granted `TO`
--
--  Rather than rewrite 19 policies and 25 functions (and re-audit all 41
--  security tests), this file recreates both under RDS. The result is that
--  01–07 are the SAME policy text that was reviewed and tested against
--  Supabase, which is the whole point: a migration that rewrites the security
--  boundary is a migration that has to re-prove it.
--
--  ── How a request works now ─────────────────────────────────────────────────
--
--  The Express backend (see db.js `withUser`) wraps every request in:
--
--      BEGIN;
--        SELECT set_config('app.user_id', '<uuid from the Cognito token>', true);
--        SET LOCAL ROLE authenticated;
--        ...the request's queries...
--      COMMIT;                          -- role and setting both reset here
--
--  This is the same mechanism PostgREST used on Supabase. Two properties make
--  it safe, and both matter:
--
--   • `SET LOCAL ROLE authenticated` means queries run as a NON-OWNER role.
--     Table owners bypass RLS in Postgres, so connecting as the RDS master
--     user and querying directly would silently disable every policy in this
--     schema. Switching role is what keeps them switched on.
--
--   • `set_config(..., true)` and `SET LOCAL` are both transaction-scoped, so
--     they cannot leak to the next request that borrows the same pooled
--     connection. A connection returned to the pool mid-transaction is rolled
--     back by pg, which resets them too.
--
--  SECURITY DEFINER functions still run as their owner and still bypass RLS
--  after checking their own rule — unchanged from Supabase. This is why we do
--  NOT use `FORCE ROW LEVEL SECURITY` here: forcing it would apply RLS to the
--  definer functions as well and break every controlled mutation.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ── The `authenticated` role ─────────────────────────────────────────────────
-- NOLOGIN: nothing ever connects as this role directly. It is only ever
-- reached via SET LOCAL ROLE from an already-authenticated backend request,
-- so it needs no password and must not be able to open a connection of its own.
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;

-- The connecting user must be a member of `authenticated` to SET ROLE to it.
-- On RDS the master user is not a superuser, so this grant is required — and
-- it is granted to whoever is applying the schema, which is by definition the
-- account the backend connects as.
do $$
begin
  execute format('grant authenticated to %I', current_user);
exception
  -- Already a member, or current_user IS authenticated somehow. Both fine.
  when duplicate_object then null;
  when others then raise notice 'Could not grant authenticated to %: %', current_user, sqlerrm;
end $$;

-- ── `auth.uid()` ─────────────────────────────────────────────────────────────
-- Supabase provided this from the verified JWT. Here it reads the GUC that
-- db.js sets from the verified Cognito token — same value, same trust chain
-- (a signature the backend checked), same call signature, so every policy and
-- function that calls `auth.uid()` works with no edit at all.
--
-- The `true` in current_setting means "return null if unset" rather than
-- raising. An unset GUC therefore yields NULL, and since every policy compares
-- `= auth.uid()`, NULL fails every comparison and the caller sees nothing.
-- Forgetting to set the identity fails CLOSED, which is the direction a
-- mistake here has to go.
create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

-- Let the role reach the application schema at all. Table-level grants are in
-- 08_grants.sql (they have to run after the tables exist); this is only the
-- schema-level permission to look inside `public`.
grant usage on schema public to authenticated;
