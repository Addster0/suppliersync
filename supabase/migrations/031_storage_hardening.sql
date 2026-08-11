-- Server-side upload limits for organization-files bucket.
-- Complements client checks in src/lib/utils.ts.

update storage.buckets
set
  file_size_limit = 4194304,
  allowed_mime_types = array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'text/plain',
    'text/csv'
  ]
where id = 'organization-files';
