begin;

do $$
begin
  if to_regclass('core.users') is not null then
    execute 'create index if not exists idx_core_users_email_lower on core.users (lower(email))';
  end if;

  if to_regclass('core.user_profiles') is not null then
    execute 'create index if not exists idx_core_user_profiles_username_lower on core.user_profiles (lower(username))';
  end if;

  if to_regclass('core.sessions') is not null then
    execute 'create index if not exists idx_core_sessions_id_expires_at on core.sessions (id, expires_at)';
  end if;
end
$$;

commit;
