import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // Surfaced clearly rather than a cryptic network error deep in the app.
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example → .env.local and restart the dev server.');
}

// Fall back to harmless placeholders when env is absent so the app still renders
// the sign-in screen (with a console hint) instead of white-screening on boot.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anon || 'placeholder-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true } }
);
