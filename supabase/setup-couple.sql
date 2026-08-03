-- NOSSO CAIXA — execute uma vez no SQL Editor do Supabase.
-- Mantém as tabelas financeiras existentes e configura nomes, limite de duas
-- contas e entrada automática das duas pessoas na mesma casa.

create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Pessoas da casa podem ver os nomes" on public.profiles;
create policy "Pessoas da casa podem ver os nomes"
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.household_members me
    join public.household_members partner
      on partner.household_id = me.household_id
    where me.user_id = (select auth.uid())
      and partner.user_id = profiles.id
  )
);

drop policy if exists "Cada pessoa altera seu nome" on public.profiles;
create policy "Cada pessoa altera seu nome"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

grant select, update on public.profiles to authenticated;

create or replace function private.limit_couple_accounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from auth.users) >= 2 then
    raise exception 'Apenas duas contas podem fazer parte deste espaço.';
  end if;
  return new;
end;
$$;

drop trigger if exists limit_couple_accounts on auth.users;
create trigger limit_couple_accounts
before insert on auth.users
for each row execute function private.limit_couple_accounts();

create or replace function private.prepare_couple_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  shared_household_id bigint;
  chosen_name text;
begin
  chosen_name := trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  if chosen_name = '' then
    chosen_name := split_part(new.email, '@', 1);
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, chosen_name)
  on conflict (id) do update set display_name = excluded.display_name;

  select id into shared_household_id
  from public.households
  order by created_at asc
  limit 1;

  if shared_household_id is null then
    insert into public.households (name, created_by)
    values ('Nosso espaço', new.id)
    returning id into shared_household_id;

    insert into public.household_members (household_id, user_id, role)
    values (shared_household_id, new.id, 'owner');

    insert into public.categories (household_id, name, color, icon)
    values
      (shared_household_id, 'Alimentação', '#d97854', 'utensils'),
      (shared_household_id, 'Casa', '#7b68b7', 'home'),
      (shared_household_id, 'Transporte', '#668196', 'car'),
      (shared_household_id, 'Saúde', '#b76573', 'heart'),
      (shared_household_id, 'Lazer', '#b88646', 'sparkles'),
      (shared_household_id, 'Renda', '#468a72', 'trending-up'),
      (shared_household_id, 'Outros', '#6f7e87', 'credit-card')
    on conflict (household_id, name) do nothing;
  else
    insert into public.household_members (household_id, user_id, role)
    values (shared_household_id, new.id, 'member')
    on conflict (household_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists prepare_couple_user on auth.users;
create trigger prepare_couple_user
after insert on auth.users
for each row execute function private.prepare_couple_user();

-- Aproveita contas que já existam antes da instalação deste script.
insert into public.profiles (id, display_name)
select
  id,
  coalesce(nullif(trim(raw_user_meta_data ->> 'full_name'), ''), split_part(email, '@', 1))
from auth.users
on conflict (id) do nothing;

-- Se uma ou duas contas já existiam, coloca ambas na primeira casa criada.
do $$
declare
  shared_household_id bigint;
  household_owner_id uuid;
begin
  select id, created_by
  into shared_household_id, household_owner_id
  from public.households
  order by created_at asc
  limit 1;

  if shared_household_id is not null then
    insert into public.household_members (household_id, user_id, role)
    select
      shared_household_id,
      users.id,
      case when users.id = household_owner_id then 'owner' else 'member' end
    from auth.users as users
    on conflict (household_id, user_id) do nothing;
  end if;
end;
$$;
