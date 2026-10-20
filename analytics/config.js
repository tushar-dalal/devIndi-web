// devIndi website analytics settings.
// Fill in the two Supabase values from: Supabase -> Project Settings -> API
// (Project URL, and the anon / publishable key). This key can add and read
// analytics rows (see supabase-setup.sql), and the admin Analytics page uses it.
// Until they're filled in, tracking stays off and the admin page shows setup steps.
window.DEVINDI_ANALYTICS = {
  supabaseUrl: 'https://pbrcuqgqtuivxmuyrujo.supabase.co',
  anonKey: 'sb_publishable_17W68ar-AGs2BFDng3wC-g_XxStWi5p',

  recordSessions: true,     // session recordings (inputs are always masked)
  recordSampleRate: 1,      // 1 = record every visit, 0.25 = one in four
  respectDoNotTrack: true   // skip visitors whose browser sends Do Not Track / GPC
};
