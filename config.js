/*
 * Supabase settings for sign-in and cloud sync. See "Sign-in & sync setup" in README.md.
 *
 * Find both in your Supabase dashboard: click "Connect" at the top of your project,
 * or go to Settings > API Keys. They are meant to be public:
 * your data is protected by the database's Row Level Security rules
 * (supabase/schema.sql), not by keeping these secret.
 *
 * Use the PUBLISHABLE key (starts with "sb_publishable_") or the legacy "anon" key.
 * NEVER put the secret key ("sb_secret_...") or the "service_role" key here.
 *
 * Leave them empty to use the app without accounts (data stays on the device).
 */
window.MONEY_TRACKER_CONFIG = {
  supabaseUrl: 'https://fkczaghpdzmfnsurlyuh.supabase.co',
  supabaseKey: 'sb_publishable_wBrTEoQqLOi1Nh5bvE46SQ_1CvANp1Y'
};
