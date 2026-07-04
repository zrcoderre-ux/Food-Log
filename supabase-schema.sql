-- ============================================================================
--  PlateIQ — Supabase schema
--  Run this ONCE in your Supabase project: Dashboard → SQL Editor → New query →
--  paste all of this → Run. It is safe to re-run (idempotent).
--
--  It creates:
--    • plateiq_state  — one JSON blob per user (cross-device sync)
--    • plateiq_steps  — per-day step counts pushed from Apple Health / phone
--    • plateiq_tokens — a per-user secret token used by the zero-touch Shortcut
--    • ingest_steps() — an RPC the Shortcut calls with only the public anon key
--  Row-Level Security ensures every user can only ever read/write their own rows.
-- ============================================================================

-- ── Cross-device state blob ────────────────────────────────────────────────
create table if not exists public.plateiq_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.plateiq_state enable row level security;

drop policy if exists "own state select" on public.plateiq_state;
create policy "own state select" on public.plateiq_state
  for select using (auth.uid() = user_id);
drop policy if exists "own state upsert" on public.plateiq_state;
create policy "own state upsert" on public.plateiq_state
  for insert with check (auth.uid() = user_id);
drop policy if exists "own state update" on public.plateiq_state;
create policy "own state update" on public.plateiq_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Per-day steps (from Apple Health via the Shortcut, or the phone) ────────
create table if not exists public.plateiq_steps (
  user_id    uuid not null references auth.users (id) on delete cascade,
  day        date not null,
  steps      integer not null default 0,
  source     text not null default 'apple_health',
  updated_at timestamptz not null default now(),
  primary key (user_id, day, source)
);
alter table public.plateiq_steps enable row level security;

drop policy if exists "own steps select" on public.plateiq_steps;
create policy "own steps select" on public.plateiq_steps
  for select using (auth.uid() = user_id);

-- ── Per-user ingest token (maps a secret string → the user, for the Shortcut)
create table if not exists public.plateiq_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.plateiq_tokens enable row level security;

drop policy if exists "own token select" on public.plateiq_tokens;
create policy "own token select" on public.plateiq_tokens
  for select using (auth.uid() = user_id);
drop policy if exists "own token insert" on public.plateiq_tokens;
create policy "own token insert" on public.plateiq_tokens
  for insert with check (auth.uid() = user_id);

-- ── Zero-touch ingest RPC ───────────────────────────────────────────────────
-- Callable with ONLY the public anon key (no login), so an Apple Shortcut
-- background automation can POST steps. It validates the secret token, then
-- writes the row for the matching user. SECURITY DEFINER lets it bypass RLS
-- for exactly this one controlled write. It can never read your other data.
create or replace function public.ingest_steps(
  p_token  text,
  p_day    date,
  p_steps  integer,
  p_source text default 'apple_health'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  select user_id into v_user from public.plateiq_tokens where token = p_token;
  if v_user is null then
    raise exception 'invalid token';
  end if;
  insert into public.plateiq_steps (user_id, day, steps, source, updated_at)
  values (v_user, p_day, greatest(p_steps, 0), coalesce(p_source, 'apple_health'), now())
  on conflict (user_id, day, source)
  do update set steps = excluded.steps, updated_at = now();
end;
$$;

revoke all on function public.ingest_steps(text, date, integer, text) from public;
grant execute on function public.ingest_steps(text, date, integer, text) to anon, authenticated;
