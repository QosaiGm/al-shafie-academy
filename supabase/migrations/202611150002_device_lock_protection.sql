-- One registered browser/device installation per student. Teachers can reset a lock.
create table if not exists public.device_registrations (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  device_hash text not null,
  registered_at timestamptz not null default now()
);
alter table public.device_registrations enable row level security;

create or replace function public.claim_student_device(p_device_hash text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_registered_hash text;
begin
  if v_user_id is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  if p_device_hash is null or length(p_device_hash) < 20 or length(p_device_hash) > 200 then
    raise exception 'Invalid device identifier' using errcode = '22023';
  end if;
  select p.role into v_role from public.profiles p where p.id = v_user_id;
  if v_role is null then
    raise exception 'Student profile not found' using errcode = 'P0002';
  elsif v_role = 'teacher' then
    return 'teacher';
  elsif v_role <> 'student' then
    raise exception 'Unsupported account type' using errcode = '42501';
  end if;

  insert into public.device_registrations(student_id, device_hash)
  values (v_user_id, p_device_hash)
  on conflict (student_id) do nothing;

  select d.device_hash into v_registered_hash
  from public.device_registrations d where d.student_id = v_user_id;
  if v_registered_hash is distinct from p_device_hash then
    raise exception 'هذا الحساب مرتبط بجهاز آخر. تواصل مع الأستاذ لإعادة تعيين الجهاز.' using errcode = '42501';
  end if;
  update public.device_registrations set registered_at = now() where student_id = v_user_id;
  return 'student';
end;
$$;

create or replace function public.validate_student_device(p_device_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
begin
  if v_user_id is null then return false; end if;
  select p.role into v_role from public.profiles p where p.id = v_user_id;
  if v_role = 'teacher' then return true; end if;
  return exists (
    select 1 from public.device_registrations d
    where d.student_id = v_user_id and d.device_hash = p_device_hash
  );
end;
$$;

create or replace function public.teacher_reset_student_device(p_student_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not public.is_teacher() then
    raise exception 'Teacher access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_student_id and p.role = 'student') then
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
