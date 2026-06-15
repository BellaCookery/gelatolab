-- Escolas/métodos de balanceamento criados pelo usuário.
-- A estrutura (famílias, subtipos, faixas) fica em JSON no campo "dados".
create table if not exists escolas (
  id            uuid primary key default gen_random_uuid(),
  dono          uuid references auth.users(id) on delete cascade,
  nome          text not null,
  dados         jsonb default '{}'::jsonb,
  criado_em     timestamptz default now(),
  atualizado_em timestamptz default now()
);
alter table escolas enable row level security;
drop policy if exists "escolas proprias" on escolas;
create policy "escolas proprias" on escolas
  for all using (auth.uid() = dono) with check (auth.uid() = dono);
