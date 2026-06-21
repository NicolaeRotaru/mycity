-- Segui-negozio (PDP "Segui/Segui già"). Additive, RLS, idempotente.
create table if not exists public.follows (
  user_id    uuid not null references auth.users(id) on delete cascade,
  store_id   uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, store_id)
);
create index if not exists follows_store_idx on public.follows(store_id);

alter table public.follows enable row level security;

drop policy if exists "follows_select_own" on public.follows;
create policy "follows_select_own" on public.follows
  for select using (auth.uid() = user_id);

drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own" on public.follows
  for insert with check (auth.uid() = user_id);

drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own" on public.follows
  for delete using (auth.uid() = user_id);

-- Conteggio follower pubblico (aggregato sicuro, non espone le righe altrui).
create or replace function public.store_follower_count(p_store_id uuid)
returns integer language sql security definer stable set search_path = public as $$
  select count(*)::int from public.follows where store_id = p_store_id;
$$;
grant execute on function public.store_follower_count(uuid) to anon, authenticated;
