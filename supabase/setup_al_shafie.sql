-- Al-Shafie Academy complete Supabase database setup.
-- Run once in the Supabase SQL Editor for a fresh project.
-- Contains the initial schema followed by the Al-Shafie Academy additions.
-- Edge Functions must be deployed separately; this SQL only creates database objects.
-- Initial schema for Fluent. Apply with `supabase db push`.
create extension if not exists pgcrypto;
do $$ begin
  create type public.account_status as enum ('pending_payment','payment_submitted','approved','rejected','suspended');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.course_status as enum ('draft','published','archived');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'student' check (role in ('student','teacher')),
  status public.account_status not null default 'pending_payment',
  created_at timestamptz not null default now()
);
-- Existing Supabase projects may already have a minimal `profiles` table.
-- Add the academy fields needed by the policies and functions below.
alter table public.profiles
  add column if not exists full_name text not null default '',
  add column if not exists role text not null default 'student' check (role in ('student','teacher')),
  add column if not exists status public.account_status not null default 'pending_payment',
  add column if not exists created_at timestamptz not null default now();
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(), title text not null, description text not null default '',
  category text not null default '', thumbnail_url text, price_cents integer not null default 0 check(price_cents>=0),
  status public.course_status not null default 'draft', created_at timestamptz not null default now()
);
create table if not exists public.enrollments (
 id uuid primary key default gen_random_uuid(), student_id uuid not null references public.profiles(id) on delete cascade,
 course_id uuid not null references public.courses(id) on delete cascade, status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(), unique(student_id,course_id)
);
create table if not exists public.lessons (
 id uuid primary key default gen_random_uuid(), course_id uuid not null references public.courses(id) on delete cascade,
 title text not null, description text not null default '', bunny_video_id text, duration_minutes integer check(duration_minutes is null or duration_minutes>=0),
 lesson_order integer not null default 0, status public.course_status not null default 'draft', created_at timestamptz not null default now()
);
create table if not exists public.lesson_resources (
 id uuid primary key default gen_random_uuid(), lesson_id uuid not null references public.lessons(id) on delete cascade,
 title text not null, storage_path text, external_url text, mime_type text, created_at timestamptz not null default now(),
 check ((storage_path is null) <> (external_url is null))
);
create table if not exists public.payment_submissions (
 id uuid primary key default gen_random_uuid(), student_id uuid not null references public.profiles(id) on delete cascade,
 course_id uuid not null references public.courses(id) on delete cascade, receipt_path text not null,
 status text not null default 'submitted' check(status in ('submitted','approved','rejected')),
 reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, created_at timestamptz not null default now()
);
create or replace function public.mark_profile_payment_submitted() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update public.profiles set status='payment_submitted'
 where id=new.student_id and status in ('pending_payment','rejected');
 return new;
end $$;
drop trigger if exists on_payment_submission_created on public.payment_submissions;
create trigger on_payment_submission_created after insert on public.payment_submissions
 for each row execute function public.mark_profile_payment_submitted();
create table if not exists public.device_registrations (
 student_id uuid primary key references public.profiles(id) on delete cascade,
 device_hash text not null, registered_at timestamptz not null default now()
);
create table if not exists public.exams (
 id uuid primary key default gen_random_uuid(), course_id uuid not null references public.courses(id) on delete cascade,
 title text not null, published boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.exam_questions (
 id uuid primary key default gen_random_uuid(), exam_id uuid not null references public.exams(id) on delete cascade,
 prompt text not null, question_type text not null check(question_type in ('multiple_choice','true_false')),
 marks numeric not null default 1 check(marks>0), question_order integer not null default 0
);
-- Correct answers are stored separately so a learner can never fetch them before submission.
create table if not exists public.exam_answer_keys (
 question_id uuid primary key references public.exam_questions(id) on delete cascade, correct_answer text not null
);
create table if not exists public.question_options (
 id uuid primary key default gen_random_uuid(), question_id uuid not null references public.exam_questions(id) on delete cascade,
 option_text text not null, option_order integer not null default 0
);
create table if not exists public.exam_attempts (
 id uuid primary key default gen_random_uuid(), exam_id uuid not null references public.exams(id) on delete cascade,
 student_id uuid not null references public.profiles(id) on delete cascade, score numeric not null default 0,
 submitted_at timestamptz not null default now()
);
create table if not exists public.student_answers (
 id uuid primary key default gen_random_uuid(), attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
 question_id uuid not null references public.exam_questions(id) on delete cascade, answer_text text not null,
 is_correct boolean not null, marks_awarded numeric not null default 0, unique(attempt_id,question_id)
);
create table if not exists public.lesson_progress (
 student_id uuid not null references public.profiles(id) on delete cascade, lesson_id uuid not null references public.lessons(id) on delete cascade,
 completed_at timestamptz not null default now(), primary key(student_id,lesson_id)
);

create or replace function public.create_profile_for_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,full_name,role,status)
 values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),'student','pending_payment');
 return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile_for_new_user();

create or replace function public.is_teacher() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='teacher')
$$;
create or replace function public.has_course_access(target_course uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles p join public.enrollments e on e.student_id=p.id
  where p.id=auth.uid() and p.status='approved' and e.course_id=target_course and e.status='approved')
$$;
revoke all on function public.is_teacher() from public; grant execute on function public.is_teacher() to authenticated;
revoke all on function public.has_course_access(uuid) from public; grant execute on function public.has_course_access(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_resources enable row level security;
alter table public.payment_submissions enable row level security;
alter table public.device_registrations enable row level security;
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_answer_keys enable row level security;
alter table public.question_options enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.student_answers enable row level security;
alter table public.lesson_progress enable row level security;

drop policy if exists "profile read own or teacher" on public.profiles;
create policy "profile read own or teacher" on public.profiles for select to authenticated using(id=auth.uid() or public.is_teacher());
-- Role/status deliberately excluded: students may update their name only.
drop policy if exists "profile update own name" on public.profiles;
create policy "profile update own name" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid() and role='student' and status in ('pending_payment','payment_submitted','approved','rejected','suspended'));
revoke update on public.profiles from authenticated;
grant update(full_name) on public.profiles to authenticated;
drop policy if exists "teacher manages profiles" on public.profiles;
create policy "teacher manages profiles" on public.profiles for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
drop policy if exists "published courses readable" on public.courses;
create policy "published courses readable" on public.courses for select to anon,authenticated using(status='published' or public.is_teacher());
drop policy if exists "teacher manages courses" on public.courses;
create policy "teacher manages courses" on public.courses for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
drop policy if exists "enrollment own or teacher" on public.enrollments;
create policy "enrollment own or teacher" on public.enrollments for select to authenticated using(student_id=auth.uid() or public.is_teacher());
drop policy if exists "student requests enrollment" on public.enrollments;
create policy "student requests enrollment" on public.enrollments for insert to authenticated with check(student_id=auth.uid() and status='pending');
drop policy if exists "teacher manages enrollments" on public.enrollments;
create policy "teacher manages enrollments" on public.enrollments for update to authenticated using(public.is_teacher()) with check(public.is_teacher());
drop policy if exists "lessons readable with access" on public.lessons;
create policy "lessons readable with access" on public.lessons for select to authenticated using(public.is_teacher() or (status='published' and public.has_course_access(course_id)));
drop policy if exists "teacher manages lessons" on public.lessons;
create policy "teacher manages lessons" on public.lessons for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
drop policy if exists "resources readable with lesson access" on public.lesson_resources;
create policy "resources readable with lesson access" on public.lesson_resources for select to authenticated using(public.is_teacher() or exists(select 1 from public.lessons l where l.id=lesson_id and public.has_course_access(l.course_id)));
drop policy if exists "teacher manages resources" on public.lesson_resources;
create policy "teacher manages resources" on public.lesson_resources for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
drop policy if exists "payments own or teacher" on public.payment_submissions;
create policy "payments own or teacher" on public.payment_submissions for select to authenticated using(student_id=auth.uid() or public.is_teacher());
drop policy if exists "student submits payment" on public.payment_submissions;
create policy "student submits payment" on public.payment_submissions for insert to authenticated with check(student_id=auth.uid() and status='submitted');
drop policy if exists "teacher reviews payments" on public.payment_submissions;
create policy "teacher reviews payments" on public.payment_submissions for update to authenticated using(public.is_teacher()) with check(public.is_teacher());
drop policy if exists "device self or teacher" on public.device_registrations;
create policy "device self or teacher" on public.device_registrations for select to authenticated using(student_id=auth.uid() or public.is_teacher());
drop policy if exists "device manages self" on public.device_registrations;
create policy "device manages self" on public.device_registrations for insert to authenticated with check(student_id=auth.uid());
drop policy if exists "teacher resets devices" on public.device_registrations;
create policy "teacher resets devices" on public.device_registrations for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
drop policy if exists "exams public if published" on public.exams;
create policy "exams public if published" on public.exams for select to authenticated using(public.is_teacher() or (published and public.has_course_access(course_id)));
drop policy if exists "teacher manages exams" on public.exams;
create policy "teacher manages exams" on public.exams for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
drop policy if exists "questions only via exam access" on public.exam_questions;
create policy "questions only via exam access" on public.exam_questions for select to authenticated using(public.is_teacher() or exists(select 1 from public.exams e where e.id=exam_id and e.published and public.has_course_access(e.course_id)));
drop policy if exists "teacher manages questions" on public.exam_questions;
create policy "teacher manages questions" on public.exam_questions for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
drop policy if exists "teacher manages answer keys" on public.exam_answer_keys;
create policy "teacher manages answer keys" on public.exam_answer_keys for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
drop policy if exists "options only via question access" on public.question_options;
create policy "options only via question access" on public.question_options for select to authenticated using(public.is_teacher() or exists(select 1 from public.exam_questions q join public.exams e on e.id=q.exam_id where q.id=question_id and e.published and public.has_course_access(e.course_id)));
drop policy if exists "teacher manages options" on public.question_options;
create policy "teacher manages options" on public.question_options for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
drop policy if exists "attempts own or teacher" on public.exam_attempts;
create policy "attempts own or teacher" on public.exam_attempts for select to authenticated using(student_id=auth.uid() or public.is_teacher());
drop policy if exists "answers own or teacher" on public.student_answers;
create policy "answers own or teacher" on public.student_answers for select to authenticated using(exists(select 1 from public.exam_attempts a where a.id=attempt_id and (a.student_id=auth.uid() or public.is_teacher())));
-- Attempts and grades are created by the grading Edge Function using server-side credentials.
revoke insert, update, delete on public.exam_attempts from authenticated;
revoke insert, update, delete on public.student_answers from authenticated;
drop policy if exists "progress own or teacher" on public.lesson_progress;
create policy "progress own or teacher" on public.lesson_progress for select to authenticated using(student_id=auth.uid() or public.is_teacher());
drop policy if exists "progress own" on public.lesson_progress;
create policy "progress own" on public.lesson_progress for insert to authenticated with check(student_id=auth.uid() and exists(select 1 from public.lessons l where l.id=lesson_id and public.has_course_access(l.course_id)));
drop policy if exists "progress own update" on public.lesson_progress;
create policy "progress own update" on public.lesson_progress for update to authenticated using(student_id=auth.uid() and exists(select 1 from public.lessons l where l.id=lesson_id and public.has_course_access(l.course_id))) with check(student_id=auth.uid() and exists(select 1 from public.lessons l where l.id=lesson_id and public.has_course_access(l.course_id)));
drop policy if exists "teacher manages progress" on public.lesson_progress;
create policy "teacher manages progress" on public.lesson_progress for all to authenticated using(public.is_teacher()) with check(public.is_teacher());

-- Private buckets. Receipt files are isolated from course documents.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('receipts','receipts',false,5242880,array['image/jpeg','image/png','application/pdf']),
 ('course-materials','course-materials',false,26214400,array['application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-powerpoint','image/jpeg','image/png'])
on conflict(id) do nothing;
drop policy if exists "students upload own receipt" on storage.objects;
create policy "students upload own receipt" on storage.objects for insert to authenticated with check(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "students and teachers read receipts" on storage.objects;
create policy "students and teachers read receipts" on storage.objects for select to authenticated using(bucket_id='receipts' and (public.is_teacher() or (storage.foldername(name))[1]=auth.uid()::text));
drop policy if exists "teachers manage course materials" on storage.objects;
create policy "teachers manage course materials" on storage.objects for all to authenticated using(bucket_id='course-materials' and public.is_teacher()) with check(bucket_id='course-materials' and public.is_teacher());
drop policy if exists "enrolled students read permitted course materials" on storage.objects;
create policy "enrolled students read permitted course materials" on storage.objects for select to authenticated using(
 bucket_id='course-materials' and exists(
  select 1 from public.lesson_resources r join public.lessons l on l.id=r.lesson_id
  where r.storage_path=name and public.has_course_access(l.course_id)
 )
);


-- Al-Shafie Academy additions
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
  add column if not exists amount_cents integer not null default 0 check (amount_cents >= 0),
  add column if not exists payment_method text not null default 'jawwal_pay'
    check (payment_method in ('jawwal_pay','bank_of_palestine','palpay'));

create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  academy_name text not null default 'Al-Shafie Academy',
  wallet_provider text not null default '',
  wallet_number text not null default '',
  wallet_holder text not null default '',
  wallet_instructions text not null default '',
  bank_name text not null default 'بنك فلسطين',
  bank_account_holder text not null default '',
  bank_account_number text not null default '',
  bank_iban text not null default '',
  bank_instructions text not null default '',
  palpay_number text not null default '',
  palpay_holder text not null default '',
  palpay_instructions text not null default '',
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
drop policy if exists "public can read academy payment details" on public.platform_settings;
create policy "public can read academy payment details" on public.platform_settings
  for select to anon, authenticated using (true);
drop policy if exists "teacher manages academy settings" on public.platform_settings;
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
drop policy if exists "student reads own support messages" on public.support_messages;
create policy "student reads own support messages" on public.support_messages
  for select to authenticated using (student_id=auth.uid() or public.is_teacher());
drop policy if exists "student creates support message" on public.support_messages;
create policy "student creates support message" on public.support_messages
  for insert to authenticated with check (student_id=auth.uid() and status='open');
drop policy if exists "teacher manages support messages" on public.support_messages;
create policy "teacher manages support messages" on public.support_messages
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists "student requests enrollment" on public.enrollments;
drop policy if exists "student requests enrollment" on public.enrollments;
create policy "student requests enrollment" on public.enrollments
  for insert to authenticated with check (student_id=auth.uid() and status='pending');
drop policy if exists "student updates pending enrollment" on public.enrollments;
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

