-- Base oficial (RAG) para validação factual da monitoria.
-- Rode uma vez no SQL Editor do Supabase.
-- Modelo de embedding assumido: gemini-embedding-001 (3072 dimensões).
-- Se usar outro modelo, troque 3072 pela dimensão dele em todo o arquivo.

create extension if not exists vector;

create table if not exists public.documents (
  id        bigserial primary key,
  content   text,
  metadata  jsonb,
  embedding vector(3072)
);

-- Índice HNSW via halfvec (o tipo vector só indexa até 2000 dimensões).
create index if not exists documents_embedding_hnsw
  on public.documents
  using hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

create index if not exists documents_file_id_idx
  on public.documents ((metadata->>'file_id'));

-- Função de busca que o nó Supabase Vector Store do n8n chama.
create or replace function public.match_documents (
  query_embedding vector(3072),
  match_count int default null,
  filter jsonb default '{}'
) returns table (id bigint, content text, metadata jsonb, similarity float)
language plpgsql
as $$
#variable_conflict use_column
begin
  return query
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) as similarity
  from public.documents d
  where d.metadata @> filter
  order by d.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  limit match_count;
end;
$$;

-- Remove todos os trechos de um arquivo antes de reindexá-lo.
create or replace function public.delete_by_file (p_file_id text)
returns void
language sql
as $$
  delete from public.documents where metadata->>'file_id' = p_file_id;
$$;

-- Base interna: só a service_role (usada no n8n) acessa.
alter table public.documents enable row level security;
revoke all on public.documents from anon, authenticated;
revoke all on function public.match_documents(vector, int, jsonb) from public, anon, authenticated;
revoke all on function public.delete_by_file(text) from public, anon, authenticated;
