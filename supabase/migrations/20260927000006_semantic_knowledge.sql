-- Semantic search over each business's knowledge (1024-dim embeddings from
-- OpenAI text-embedding-3-small). Always filtered by tenant first, so one
-- business's documents never show up in another's results.
create index if not exists knowledge_docs_embedding_hnsw on public.knowledge_docs using hnsw (embedding vector_cosine_ops);

create or replace function public.match_knowledge(p_tenant uuid, p_embedding vector(1024), p_limit int default 4)
returns table (id uuid, title text, content text, similarity real)
language sql stable set search_path = public as $$
  select d.id, d.title, d.content, (1 - (d.embedding <=> p_embedding))::real as similarity
  from public.knowledge_docs d
  where d.tenant_id = p_tenant and d.embedding is not null
  order by d.embedding <=> p_embedding
  limit p_limit;
$$;
