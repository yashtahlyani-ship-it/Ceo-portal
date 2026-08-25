// Supabase Edge Function: create-stakeholder
//
// CR-02 #6 turns onboarding into an INVITE flow: the EA/CEO enters Name, Email
// and Designation, and the person receives an email link to set their own
// password. This replaces the "no invite link" decision in PRD §9.
//
// It still exists so the service-role key never reaches a browser: the caller's
// JWT is verified and their role checked server-side before anything is created.
//
// Deploy:  supabase functions deploy create-stakeholder
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';

    // 1) Who is calling? Verify their JWT and load their role.
    const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uErr } = await asCaller.auth.getUser();
    if (uErr || !user) return json({ error: 'Not authenticated' }, 401);
    const { data: me } = await asCaller.from('profiles').select('role').eq('id', user.id).single();
    if (!me || (me.role !== 'ea' && me.role !== 'ceo')) {
      return json({ error: 'Only the EA or CEO may add stakeholders' }, 403);
    }

    const body = await req.json();
    const name = (body?.name ?? '').trim();
    const email = (body?.email ?? '').trim().toLowerCase();
    const title = (body?.title ?? '').trim();      // Designation (CR-02 #6)
    const redirectTo = (body?.redirectTo ?? '').trim() || undefined;
    if (!name || !email) return json({ error: 'Name and email are required' }, 400);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const meta = { name, role: 'stakeholder', title };

    // 2) Preferred path: email them an invite link so they set their own
    //    password and no shared secret is ever transmitted.
    const invite = await admin.auth.admin.inviteUserByEmail(email, {
      data: meta,
      redirectTo,
    });

    if (!invite.error && invite.data?.user) {
      await admin.from('profiles').upsert({
        id: invite.data.user.id, email, name, title, role: 'stakeholder', active: true,
      });
      return json({ id: invite.data.user.id, email, method: 'invite' }, 200);
    }

    // 3) Fallback. Sending mail can fail for reasons that have nothing to do
    //    with this request — no SMTP configured, or the built-in service's very
    //    low rate limit. Onboarding should not be blocked by that, so create the
    //    account with a temporary password and hand it back for the EA to pass
    //    on. The account is stamped must_set_password either way, so the person
    //    still chooses their own password before reaching the board.
    const reason = invite.error?.message ?? 'invite email could not be sent';
    const tempPassword = 'Gyftr@' + crypto.randomUUID().slice(0, 8) + '1!';
    const created = await admin.auth.admin.createUser({
      email, password: tempPassword, email_confirm: true,
      user_metadata: { ...meta, must_set_password: true },
    });
    if (created.error) return json({ error: created.error.message }, 400);

    await admin.from('profiles').upsert({
      id: created.data.user.id, email, name, title, role: 'stakeholder', active: true,
    });
    return json({
      id: created.data.user.id, email, method: 'temp_password', tempPassword, reason,
    }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
