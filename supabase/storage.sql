-- File storage for uploaded pay stubs, time cards, receipts and statements.
--
-- Run this once in your Supabase project, after schema.sql:
-- Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
-- It is safe to run again.
--
-- Files go in a PRIVATE bucket, in a folder named after the user's id
-- ("<user id>/<file id>"). The rules below only let signed-in users read,
-- add, change or delete files inside their own folder. There are no public links.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 15728640, array['image/*', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their own files" on storage.objects;
create policy "Users can read their own files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "Users can upload their own files" on storage.objects;
create policy "Users can upload their own files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "Users can update their own files" on storage.objects;
create policy "Users can update their own files"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "Users can delete their own files" on storage.objects;
create policy "Users can delete their own files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid()::text));
