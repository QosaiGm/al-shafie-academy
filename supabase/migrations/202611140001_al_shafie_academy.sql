-- Al-Shafie Academy: student details, semester plans, wallet settings and support.
alter table public.profiles
  add column if not exists whatsapp_number text not null default '',
  add column if not exists phone_number text not null default '',
  add column if not exists school_name text not null default '',
  add column if not exists governorate text not null default '',
  add column if not exists academic_branch text not null default '';

alter table public.enrollments
  add column if not exists study_plan text not null default 'both'
    check (study_plan in ('semester_one','semester_two','both'));
alter table public.payment_submissions
  add column if not exists study_plan text not null default 'both'
    check (study_plan in ('semester_one','semester_two','both')),
  add column if not exists amount_cents integer not null default 0 check (amount_cents >= 0);

create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  academy_name text not null default 'Al-Shafie Academy',
  wallet_provider text not null default '',
  wallet_number text not null default '',
  wallet_holder text not null default '',
  wallet_instructions text not null default '',
  price_currency text not null default 'ILS',
  semester_one_price_cents integer not null default 0 check (semester_one_price_cents >= 0),
  semester_two_price_cents integer not null default 0 check (semester_two_price_cents >= 0),
  both_semesters_price_cents integer not null default 0 check (both_semesters_price_cents >= 0),
  updated_at timestamptz not null default now()
);
insert into public.platform_settings(id) values(true) on conflict(id) do nothing;
update public.platform_settings set wallet_provider='Jawwal Pay' where wallet_provider='';
insert into public.courses(id,title,description,category,status)
values (
  '11111111-1111-4111-8111-111111111111',
  'اللغة الإنجليزية — التوجيهي الفلسطيني',
  'دروس منظمة لمادة اللغة الإنجليزية حسب المنهاج الفلسطيني، مع متابعة الطالب وامتحانات ومراجعة.',
  'الصف الثاني عشر · فلسطين',
  'published'
) on conflict(id) do nothing;
alter table public.platform_settings enable row level security;
create policy "public can read academy payment details" on public.platform_settings
  for select to anon, authenticated using (true);
create policy "teacher manages academy settings" on public.platform_settings
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null,
  message text not null,
  teacher_reply text,
  status text not null default 'open' check (status in ('open','replied','closed')),
  created_at timestamptz not null default now(),
  replied_at timestamptz
);
alter table public.support_messages enable row level security;
create policy "student reads own support messages" on public.support_messages
  for select to authenticated using (student_id=auth.uid() or public.is_teacher());
create policy "student creates support message" on public.support_messages
  for insert to authenticated with check (student_id=auth.uid() and status='open');
create policy "teacher manages support messages" on public.support_messages
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists "student requests enrollment" on public.enrollments;
create policy "student requests enrollment" on public.enrollments
  for insert to authenticated with check (student_id=auth.uid() and status='pending');
drop policy if exists "student updates pending enrollment" on public.enrollments;
create policy "student updates pending enrollment" on public.enrollments
  for update to authenticated using (student_id=auth.uid() and status in ('pending','rejected'))
  with check (student_id=auth.uid() and status='pending');

create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,full_name,role,status,whatsapp_number,phone_number,school_name,governorate,academic_branch)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    'student','pending_payment',
    coalesce(new.raw_user_meta_data->>'whatsapp_number',''),
    coalesce(new.raw_user_meta_data->>'phone_number',''),
    coalesce(new.raw_user_meta_data->>'school_name',''),
    coalesce(new.raw_user_meta_data->>'governorate',''),
    coalesce(new.raw_user_meta_data->>'academic_branch','')
  );
  return new;
end $$;

create or replace function public.has_course_access(target_course uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.profiles p join public.enrollments e on e.student_id=p.id
    where p.id=auth.uid() and p.status='approved' and e.course_id=target_course
      and e.status='approved'
  )
$$;

grant select on public.platform_settings to anon, authenticated;
grant insert, update on public.platform_settings to authenticated;
grant select, insert on public.support_messages to authenticated;
grant update(teacher_reply,status,replied_at) on public.support_messages to authenticated;

