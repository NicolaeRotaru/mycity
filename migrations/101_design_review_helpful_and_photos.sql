-- Recensioni store: foto + voto "Utile". Autore/verificato si derivano
-- (user_id join profiles, order_id presente = acquisto verificato).
alter table public.store_reviews
  add column if not exists photo_urls    text[]  not null default '{}',
  add column if not exists helpful_count integer not null default 0;

create table if not exists public.review_helpful (
  review_id  uuid not null references public.store_reviews(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);
alter table public.review_helpful enable row level security;

drop policy if exists "review_helpful_select_own" on public.review_helpful;
create policy "review_helpful_select_own" on public.review_helpful
  for select using (auth.uid() = user_id);

drop policy if exists "review_helpful_insert_own" on public.review_helpful;
create policy "review_helpful_insert_own" on public.review_helpful
  for insert with check (auth.uid() = user_id);

drop policy if exists "review_helpful_delete_own" on public.review_helpful;
create policy "review_helpful_delete_own" on public.review_helpful
  for delete using (auth.uid() = user_id);

-- Mantiene store_reviews.helpful_count coerente coi voti.
create or replace function public.sync_review_helpful_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.store_reviews set helpful_count = helpful_count + 1 where id = new.review_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.store_reviews set helpful_count = greatest(helpful_count - 1, 0) where id = old.review_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_review_helpful_count on public.review_helpful;
create trigger trg_review_helpful_count
  after insert or delete on public.review_helpful
  for each row execute function public.sync_review_helpful_count();

-- La funzione-trigger non va esposta via RPC (gira come owner nel trigger).
revoke execute on function public.sync_review_helpful_count() from anon, authenticated, public;
