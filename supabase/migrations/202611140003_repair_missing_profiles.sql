-- Repair auth accounts created before the profile trigger/schema was ready.
-- Existing profile roles are preserved. The academy owner's requested teacher role
-- is restored only if that account's profile is missing.
insert into public.profiles (
  id,
  full_name,
  role,
  status,
  whatsapp_number,
  phone_number,
  school_name,
  governorate,
  academic_branch
)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', ''),
  case when lower(coalesce(u.email, '')) = 'qosi.ghun@gmail.com' then 'teacher' else 'student' end,
  'pending_payment'::public.account_status,
  coalesce(u.raw_user_meta_data->>'whatsapp_number', ''),
  coalesce(u.raw_user_meta_data->>'phone_number', ''),
  coalesce(u.raw_user_meta_data->>'school_name', ''),
  coalesce(u.raw_user_meta_data->>'governorate', ''),
  coalesce(u.raw_user_meta_data->>'academic_branch', '')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- Keep profile creation active for accounts registered after this repair.
create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, full_name, role, status, whatsapp_number, phone_number,
    school_name, governorate, academic_branch
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'student',
    'pending_payment',
    coalesce(new.raw_user_meta_data->>'whatsapp_number', ''),
    coalesce(new.raw_user_meta_data->>'phone_number', ''),
    coalesce(new.raw_user_meta_data->>'school_name', ''),
    coalesce(new.raw_user_meta_data->>'governorate', ''),
    coalesce(new.raw_user_meta_data->>'academic_branch', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_user();
