-- Storage enforces the same limits as the Worker on the private case-documents bucket:
-- 10 MB per file and only images or PDF. Supabase only (guarded): PGlite and plain Postgres have no storage schema.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
      set file_size_limit = 10485760,
          allowed_mime_types = '{image/jpeg,image/png,image/webp,image/heic,application/pdf}'
      where id = 'case-documents';
  end if;
end $$;
