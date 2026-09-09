/* Job Triage — deployment config.
   Fill these in to turn on accounts, login and cloud sync. Leave them as they
   are and the app runs exactly as it always has: no account, no server, data
   in this browser only. That fallback is deliberate — an unconfigured copy of
   this file must never break the app.

   Both values below are PUBLISHABLE. Supabase's anon key is designed to sit in
   a browser; every table is protected by row-level security, so the key alone
   grants nothing without a logged-in session. Your service_role key is a
   different thing entirely: it bypasses row-level security, and it must never
   appear in this file, in this repository, or anywhere a browser can read it. */
window.TRIAGE_CONFIG = {
  SUPABASE_URL: "",       // e.g. https://abcdefgh.supabase.co
  SUPABASE_ANON_KEY: ""   // the "anon / public" key from Settings → API
};
