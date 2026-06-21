-- Slot di consegna scelto al checkout (testo libero es. "oggi-18-20"); coperto
-- dalle policy ordini esistenti (insert lato server). Anno fondazione negozio.
alter table public.orders   add column if not exists delivery_slot text;
alter table public.profiles add column if not exists founded_year  integer;
