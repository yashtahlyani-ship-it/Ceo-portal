-- ════════════════════════════════════════════════════════════════════════════
--  CEO OFFICE PORTAL · dba-setup.sql
--
--  RUN THIS ONCE, AS THE RDS MASTER USER, BEFORE THE BACKEND FIRST STARTS.
--
--  Everything in this file needs privileges an application user does not have.
--  Everything the application user CAN do is in backend/sql/, applied
--  automatically on every boot. This is the dividing line, and it exists so the
--  DBA has exactly one thing to run rather than a trickle of permission errors
--  discovered one deploy at a time.
--
--  ── How to run ──────────────────────────────────────────────────────────────
--
--    psql "host=<rds-endpoint> dbname=<ceo-db> user=<master> sslmode=require" \
--         -v app_user=gyftr_admin \
--         -f infra/dba-setup.sql
--
--  Replace `gyftr_admin` with the user the BACKEND connects as — the one in
--  Secrets Manager, or DB_USER on the ECS task. If you omit -v it defaults to
--  gyftr_admin.
--
--  Safe to re-run. Every statement is idempotent.
--
--  ── Why the app user needs to own the tables ────────────────────────────────
--
--  This portal enforces authorization in PostgreSQL Row-Level Security, and
--  `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` plus all 19 `CREATE POLICY`
--  statements can only be run by a table's OWNER. The backend re-applies its
--  migrations on every boot, so this is a standing requirement, not a one-off.
--
--  Owning the tables does NOT let the application see everything. Owners bypass
--  RLS, which is exactly why every request runs `SET LOCAL ROLE authenticated`
--  first, switching to a non-owning role for that transaction. The owner
--  connection maintains the schema; the `authenticated` role serves the
--  requests. See backend/sql/00_compat.sql.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- Default the app user if -v was not supplied.
select coalesce(:'app_user', 'gyftr_admin') as app_user \gset

\echo ''
\echo '=== CEO Office portal — DBA setup ==='
\echo 'Database :' :DBNAME
\echo 'App user :' :app_user
\echo ''

-- ── 1. pgcrypto ─────────────────────────────────────────────────────────────
-- gen_random_uuid() for profile ids. Installing an extension needs
-- rds_superuser, which is why it cannot live in the app's own migrations.
create extension if not exists "pgcrypto";
\echo '  [1/5] pgcrypto ready'

-- ── 2. The `authenticated` role ─────────────────────────────────────────────
-- NOLOGIN: nothing ever connects as this role. It is reached only via
-- SET LOCAL ROLE from an already-authenticated backend request.
--
-- Roles are CLUSTER-wide, so on a shared RDS instance this may already exist
-- from another portal. That is harmless — privileges are granted per database,
-- so two databases sharing the name share no access.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;
\echo '  [2/5] role "authenticated" ready'

-- ── 3. Let the app user SET ROLE to it ──────────────────────────────────────
do $$
begin
  if not pg_has_role(:'app_user', 'authenticated', 'member') then
    execute format('grant authenticated to %I', :'app_user');
  end if;
end $$;
\echo '  [3/5] app user can SET ROLE authenticated'

-- ── 4. Let the app user create and own schema objects ───────────────────────
-- CREATE on the database so it can create the `auth` schema; ownership of
-- `public` so it can create tables, enable RLS and define policies there.
do $$
begin
  execute format('grant create, connect on database %I to %I', current_database(), :'app_user');
  execute format('alter schema public owner to %I', :'app_user');
exception
  when others then
    raise notice 'Could not fully grant schema rights: %', sqlerrm;
    raise notice 'If the backend later fails on CREATE POLICY, this is why.';
end $$;
\echo '  [4/5] schema rights granted'

-- ── 5. Hand over any objects created earlier by someone else ────────────────
-- If the tables were created by hand, or by a different user during an earlier
-- attempt, the app user is not their owner and every ENABLE ROW LEVEL SECURITY
-- and CREATE POLICY will fail. Reassign the ones this product owns.
--
-- Deliberately NOT `REASSIGN OWNED BY`: on a shared instance that would move
-- every object the old role owns, including other portals'. This names only
-- this product's objects.
do $$
declare
  obj record;
  n int := 0;
begin
  for obj in
    select c.relname, c.relkind
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relkind in ('r','S','v')          -- tables, sequences, views
       and c.relname in (
             'profiles','tasks','task_assignments','task_comments',
             'task_attachments','audit_log','notifications',
             'tasks_id_seq','task_assignments_id_seq','task_comments_id_seq',
             'task_attachments_id_seq','audit_log_id_seq','notifications_id_seq'
           )
       and pg_get_userbyid(c.relowner) <> :'app_user'
  loop
    execute format('alter %s public.%I owner to %I',
                   case obj.relkind when 'S' then 'sequence'
                                    when 'v' then 'view'
                                    else 'table' end,
                   obj.relname, :'app_user');
    n := n + 1;
  end loop;

  -- Same for the auth schema and its function, if an earlier run created them.
  if exists (select 1 from pg_namespace where nspname = 'auth') then
    execute format('alter schema auth owner to %I', :'app_user');
  end if;

  if n > 0 then
    raise notice 'Reassigned % existing object(s) to %', n, :'app_user';
  else
    raise notice 'No existing objects needed reassigning.';
  end if;
end $$;
\echo '  [5/5] existing objects reassigned'

\echo ''
\echo 'Done. Restart the CEO API service — it applies the rest itself on boot.'
\echo 'Then verify with:  cd scripts && node doctor.mjs'
\echo ''
