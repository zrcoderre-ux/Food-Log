// PlateIQ — scheduled reminder sender (Supabase Edge Function, Deno).
//
// Invoked on a schedule by pg_cron (see supabase-push-cron.sql). For each user
// with a push subscription it can send two kinds of Web Push, each only if the
// user turned it on in the app (read from their synced state):
//   • energy check-ins — within waking hours, on their adaptive cadence
//   • a morning inventory summary — once a day at the start of waking hours,
//     listing items that are expired, near best-by, or running low
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

type InvItem = { name?: string; qty?: number; unit?: string; bestBy?: string; low?: number };

// Local date (YYYY-MM-DD), hour and minute in the user's timezone.
function localNow(tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

// Same rules as the app: expired, best-by within 3 days, or at/below the low mark.
function inventorySummary(items: InvItem[], today: string): string | null {
  const day = (d: string) => Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 864e5);
  const soon: string[] = [], low: string[] = [];
  for (const it of items) {
    if (!it || !it.name) continue;
    const qty = Number(it.qty) || 0;
    if (it.bestBy && qty > 0) {
      const d = day(it.bestBy);
      if (d < 0) soon.push(`${it.name} (past best-by)`);
      else if (d <= 3) soon.push(`${it.name} (${d === 0 ? 'today' : d === 1 ? 'tomorrow' : d + ' days'})`);
    }
    if (qty <= (it.low != null ? Number(it.low) : 1)) low.push(qty > 0 ? `${it.name} (${qty}${it.unit ? ' ' + it.unit : ''} left)` : `${it.name} (used up)`);
  }
  const parts = [];
  if (soon.length) parts.push('Use soon: ' + soon.join(', ') + '.');
  if (low.length) parts.push('Running low: ' + low.join(', ') + '.');
  return parts.length ? parts.join(' ') : null;
}

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

  // Each user's synced app state says which reminders are on, and holds the inventory.
  const ids = (rows ?? []).map((r) => r.user_id);
  const { data: states } = ids.length
    ? await sb.from('plateiq_state').select('user_id, data').in('user_id', ids)
    : { data: [] };
  const stateOf = new Map((states ?? []).map((s) => [s.user_id, s.data || {}]));

  const now = Date.now();
  let sent = 0;

  for (const r of rows ?? []) {
    const tz = r.tz || 'UTC';
    let local;
    try { local = localNow(tz); } catch { continue; }
    if (local.hour < r.wake_start || local.hour >= r.wake_end) continue;
    const data = stateOf.get(r.user_id) || {};
    const pushes: { payload: Record<string, string>; energy: boolean }[] = [];

    // Morning inventory summary: the first run (every 15 min) of the first waking hour.
    if (data.invSettings?.pushOn && local.hour === r.wake_start && local.minute < 15) {
      const body = inventorySummary(Array.isArray(data.inventory) ? data.inventory : [], local.date);
      if (body) pushes.push({ payload: { type: 'inventory', title: 'Groceries to check today', body }, energy: false });
    }

    // Energy check-ins (on unless the app has turned them off; older apps don't sync the flag).
    if (data.energy?.pushOn !== false) {
      const target = Math.max(1, r.target_per_day || 3);
      const intervalMs = ((r.wake_end - r.wake_start) * 3600 * 1000) / target;
      const last = r.last_sent ? new Date(r.last_sent).getTime() : 0;
      if (now - last >= intervalMs * 0.9) {
        pushes.push({ payload: { type: 'energy', title: 'How’s your energy?', body: 'Tap to log — Low · Medium · High' }, energy: true });
      }
    }

    for (const p of pushes) {
      try {
        await webpush.sendNotification(r.subscription, JSON.stringify(p.payload));
        if (p.energy) await sb.from('plateiq_push').update({ last_sent: new Date().toISOString() }).eq('user_id', r.user_id);
        sent++;
      } catch (e) {
        // 404/410 → the subscription is dead; drop it.
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await sb.from('plateiq_push').delete().eq('user_id', r.user_id);
          break;
        }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }), { headers: { 'Content-Type': 'application/json' } });
});
