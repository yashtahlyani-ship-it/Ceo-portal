// Supabase Edge Function: create-stakeholder
// Lets EA/CEO add a stakeholder from the app WITHOUT the service-role key ever
// reaching the browser. The caller's JWT is verified and their role checked
// server-side; only then does the service-role client create the account.
//
// Deploy:  supabase functions deploy create-stakeholder
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
//          for deployed functions; no manual secret needed.
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

    // 2) Create the account with the service-role client.
    const body = await req.json();
    const { name, email, title } = body || {};
    if (!name || !email) return json({ error: 'Name and email are required' }, 400);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const tempPassword = 'Gyftr@' + crypto.randomUUID().slice(0, 8) + '1!';
    // must_set_password holds them on the "choose your own password" step at
    // first sign-in (see hooks/useAuth.jsx). setPassword() clears it.
    const { data, error } = await admin.auth.admin.createUser({
      email, password: tempPassword, email_confirm: true,
      user_metadata: { name, role: 'stakeholder', title, must_set_password: true },
    });
    if (error) return json({ error: error.message }, 400);
    await admin.from('profiles').upsert({ id: data.user.id, email, name, title, role: 'stakeholder', active: true });

    return json({ id: data.user.id, email, tempPassword }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
