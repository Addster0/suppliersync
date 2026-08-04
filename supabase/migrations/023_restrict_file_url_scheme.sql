-- Restrict file_url to internal Supabase storage references (sb:// scheme).
--
-- Existing rows with external http(s) URLs, data: URLs, bare paths, or traversal
-- segments cannot be safely previewed. Documents with invalid file_url are deleted
-- (file_url is NOT NULL). Contract attachments with invalid file_url are cleared.

delete from public.documents
where file_url not like 'sb://%'
   or file_url like '%..%';

update public.contracts
set
  file_url = null,
  file_name = null,
  file_size = null,
  mime_type = null
where file_url is not null
  and (file_url not like 'sb://%' or file_url like '%..%');

alter table public.documents
  add constraint documents_file_url_sb_scheme
  check (file_url like 'sb://%');

alter table public.contracts
  add constraint contracts_file_url_sb_scheme
  check (file_url is null or file_url like 'sb://%');

comment on constraint documents_file_url_sb_scheme on public.documents is
  'Documents must reference organization-files storage via sb:// paths only.';

comment on constraint contracts_file_url_sb_scheme on public.contracts is
  'Contract attachments must reference organization-files storage via sb:// paths only.';
