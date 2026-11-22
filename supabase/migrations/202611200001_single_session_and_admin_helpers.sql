-- Keep each student account bound to its first authenticated session until staff
-- resets the lock. Also add staff helper accounts that cannot promote themselves.

-- Promote trusted helpers without allowing them to become the academy owner.
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', v_constraint.conname);
  end loop;
end;
$$;
alter table public.profiles
  add constraint profiles_role_check check (role in ('student', 'teacher', 'admin'));

create or replace function public.is_teacher()
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('teacher', 'admin')
  )
$$;

create or replace function public.is_academy_owner()
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'teacher'
  )
$$;
revoke all on function public.is_teacher() from public, anon;
revoke all on function public.is_academy_owner() from public, anon;
grant execute on function public.is_teacher() to authenticated;
grant execute on function public.is_academy_owner() to authenticated;

-- No direct staff updates to the profile table: role and status changes go
-- through narrowly scoped security-definer RPCs below.
drop policy if exists "teacher manages profiles" on public.profiles;
drop policy if exists "profile update own name" on public.profiles;
drop policy if exists "profile updates own details" on public.profiles;
create policy "profile updates own details"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role in ('student', 'teacher', 'admin'));
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, whatsapp_number, phone_number, school_name, governorate, academic_branch)
  on public.profiles to authenticated;

create or replace function public.teacher_set_account_role(
  p_account_id uuid,
  p_role text
)
returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  v_existing_role text;
begin
  if auth.uid() is null or not public.is_academy_owner() then
    raise exception 'Only the academy teacher can manage helper roles' using errcode = '42501';
  end if;
  if p_account_id is null or p_account_id = auth.uid() then
    raise exception 'Invalid account' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('student', 'admin') then
    raise exception 'Role must be student or admin' using errcode = '22023';
  end if;

  select role into v_existing_role
  from public.profiles
  where id = p_account_id
  for update;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if v_existing_role = 'teacher' then
    raise exception 'The academy teacher role cannot be changed here' using errcode = '42501';
  end if;

  update public.profiles set role = p_role where id = p_account_id;
  return p_role;
end;
$$;
revoke all on function public.teacher_set_account_role(uuid, text) from public, anon;
grant execute on function public.teacher_set_account_role(uuid, text) to authenticated;

-- A row binds the account to one browser installation and one Supabase auth
-- session. Refreshing that session works; a new login session is rejected until
-- the teacher removes the row. Older registrations have no session_id and must
-- be reset once by the teacher before that account can sign in again.
create table if not exists public.device_registrations (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  device_hash text not null,
  registered_at timestamptz not null default now()
);
alter table public.device_registrations
  add column if not exists session_id uuid;
alter table public.device_registrations enable row level security;

drop policy if exists "device manages self" on public.device_registrations;
revoke insert, update, delete on public.device_registrations from anon, authenticated;
grant select on public.device_registrations to authenticated;

create or replace function public.claim_student_device(p_device_hash text)
returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_role text;
  v_registered_hash text;
  v_registered_session uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  if p_device_hash is null or length(p_device_hash) < 20 or length(p_device_hash) > 200 then
    raise exception 'Invalid device identifier' using errcode = '22023';
  end if;
  if v_session_id is null then
    raise exception 'Could not verify this sign-in session. Please sign in again.' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = v_user_id;
  if v_role is null then
    raise exception 'Student profile not found' using errcode = 'P0002';
  elsif v_role in ('teacher', 'admin') then
    return v_role;
  elsif v_role <> 'student' then
    raise exception 'Unsupported account type' using errcode = '42501';
  end if;

  insert into public.device_registrations(student_id, device_hash, session_id)
  values (v_user_id, p_device_hash, v_session_id)
  on conflict (student_id) do nothing;

  select device_hash, session_id into v_registered_hash, v_registered_session
  from public.device_registrations
  where student_id = v_user_id
  for update;

  if v_registered_hash is distinct from p_device_hash then
    raise exception 'هذا الحساب مرتبط بمتصفح آخر. تواصل مع الأستاذ لإعادة السماح بتسجيل الدخول.' using errcode = '42501';
  end if;
  if v_registered_session is distinct from v_session_id then
    raise exception 'هذا الحساب استخدم تسجيل الدخول المسموح. تواصل مع الأستاذ لإعادة السماح بتسجيل الدخول.' using errcode = '42501';
  end if;

  return 'student';
end;
$$;

create or replace function public.validate_student_device(p_device_hash text)
returns boolean
language plpgsql security definer set search_path = public, auth as $$
begin
  perform public.claim_student_device(p_device_hash);
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.teacher_reset_student_device(p_student_id uuid)
returns boolean
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null or not public.is_teacher() then
    raise exception 'Teacher access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_student_id and role = 'student'
  ) then
    raise exception 'Student not found' using errcode = 'P0002';
  end if;
  delete from public.device_registrations where student_id = p_student_id;
  return true;
end;
$$;

revoke all on function public.claim_student_device(text) from public, anon;
revoke all on function public.validate_student_device(text) from public, anon;
revoke all on function public.teacher_reset_student_device(uuid) from public, anon;
grant execute on function public.claim_student_device(text) to authenticated;
grant execute on function public.validate_student_device(text) to authenticated;
grant execute on function public.teacher_reset_student_device(uuid) to authenticated;

-- Premium database reads must use the currently claimed auth session as well.
create or replace function public.has_course_access(target_course uuid)
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1
    from public.profiles p
    join public.enrollments e on e.student_id = p.id
    join public.device_registrations d on d.student_id = p.id
    where p.id = auth.uid()
      and p.status = 'approved'
      and e.course_id = target_course
      and e.status = 'approved'
      and (e.expires_at is null or e.expires_at > now())
      and d.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
  )
$$;
revoke all on function public.has_course_access(uuid) from public, anon;
grant execute on function public.has_course_access(uuid) to authenticated;
