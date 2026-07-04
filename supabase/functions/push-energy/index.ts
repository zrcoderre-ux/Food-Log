// PlateIQ — scheduled energy-reminder sender (Supabase Edge Function, Deno).
//
// Invoked on a schedule by pg_cron (see supabase-push-cron.sql). For each user
// with a push subscription, it checks whether they're within waking hours and
// enough time has passed for their adaptive cadence, then sends a Web Push.
//
// Required function secrets (Dashboard → Edge Functions → push-energy → Secrets,
// or `supabase secrets set`):
//   VAPID_PUBLIC   — your VAPID public key (same one the app uses)
//   VAPID_PRIVATE  — your VAPID private key (keep secret!)
//   VAPID_SUBJECT  — a contact URL or mailto:, e.g. mailto:you@email.com
//   CRON_SECRET    — a random string; must match the header pg_cron sends
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('unauthorized', { status: 401 });
  }

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
    Deno.env.get('VAPID_PUBLIC')!,
    Deno.env.get('VAPID_PRIVATE')!,
  );

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: rows, error } = await sb.from('plateiq_push').select('*');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const now = Date.now();
  let sent = 0;

  for (const r of rows ?? []) {
    const tz = r.tz || 'UTC';
    // Current local hour for this user.
    const hour = Number(new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
    if (Number.isNaN(hour) || hour < r.wake_start || hour >= r.wake_end) continue;

    const target = Math.max(1, r.target_per_day || 3);
    const intervalMs = ((r.wake_end - r.wake_start) * 3600 * 1000) / target;
    const last = r.last_sent ? new Date(r.last_sent).getTime() : 0;
    if (now - last < intervalMs * 0.9) continue;

    try {
      await webpush.sendNotification(
        r.subscription,
        JSON.stringify({ title: 'How’s your energy?', body: 'Tap to log — Low · Medium · High' }),
      );
      await sb.from('plateiq_push').update({ last_sent: new Date().toISOString() }).eq('user_id', r.user_id);
      sent++;
    } catch (e) {
      // 404/410 → the subscription is dead; drop it.
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await sb.from('plateiq_push').delete().eq('user_id', r.user_id);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }), { headers: { 'Content-Type': 'application/json' } });
});
