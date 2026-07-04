-- ============================================================================
--  PlateIQ — schedule the energy push sender
--  Run this in Supabase → SQL Editor AFTER deploying the push-energy edge
--  function and setting its secrets. Replace the two placeholders first:
--    <PROJECT_REF>  — your project ref (the xxxx in xxxx.supabase.co)
--    <CRON_SECRET>  — the same random string you set as the CRON_SECRET secret
-- ============================================================================

-- Enable the scheduler + outbound HTTP (both are available on Supabase).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- (Re)create the schedule: every 15 minutes, ask the edge function to send any
-- due reminders. The function itself decides who is actually due.
select cron.unschedule('plateiq-energy-push')
  where exists (select 1 from cron.job where jobname = 'plateiq-energy-push');

select cron.schedule(
  'plateiq-energy-push',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/push-energy',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
  $$
);

-- To stop later:  select cron.unschedule('plateiq-energy-push');
