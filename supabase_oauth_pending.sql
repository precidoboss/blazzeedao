-- Add this to your existing schema: replaces the in-memory pendingAuth map,
-- since Vercel serverless functions don't share memory across invocations.
create table oauth_pending (
  session_id    text primary key,
  state         text not null,
  code_verifier text not null,
  wallet        text not null,
  created_at    timestamptz default now()
);

alter table oauth_pending enable row level security;
create policy "oauth_pending_service_only" on oauth_pending for all using (false);

-- Optional cleanup: delete rows older than 10 minutes whenever convenient
-- (cron job, or just delete-on-read in the callback function itself, which
-- the code below already does).
