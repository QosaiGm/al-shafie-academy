-- Initial schema for Fluent. Apply with `supabase db push`.
create extension if not exists pgcrypto;
create type public.account_status as enum ('pending_payment','payment_submitted','approved','rejected','suspended');
create type public.course_status as enum ('draft','published','archived');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'student' check (role in ('student','teacher')),
  status public.account_status not null default 'pending_payment',
  created_at timestamptz not null default now()
);
create table public.courses (
  id uuid primary key default gen_random_uuid(), title text not null, description text not null default '',
  category text not null default '', thumbnail_url text, price_cents integer not null default 0 check(price_cents>=0),
  status public.course_status not null default 'draft', created_at timestamptz not null default now()
);
create table public.enrollments (
 id uuid primary key default gen_random_uuid(), student_id uuid not null references public.profiles(id) on delete cascade,
 course_id uuid not null references public.courses(id) on delete cascade, status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(), unique(student_id,course_id)
);
create table public.lessons (
 id uuid primary key default gen_random_uuid(), course_id uuid not null references public.courses(id) on delete cascade,
 title text not null, description text not null default '', bunny_video_id text, duration_minutes integer check(duration_minutes is null or duration_minutes>=0),
 lesson_order integer not null default 0, status public.course_status not null default 'draft', created_at timestamptz not null default now()
);
create table public.lesson_resources (
 id uuid primary key default gen_random_uuid(), lesson_id uuid not null references public.lessons(id) on delete cascade,
 title text not null, storage_path text, external_url text, mime_type text, created_at timestamptz not null default now(),
 check ((storage_path is null) <> (external_url is null))
);
create table public.payment_submissions (
 id uuid primary key default gen_random_uuid(), student_id uuid not null references public.profiles(id) on delete cascade,
 course_id uuid not null references public.courses(id) on delete cascade, receipt_path text not null,
 status text not null default 'submitted' check(status in ('submitted','approved','rejected')),
 reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, created_at timestamptz not null default now()
);
create function public.mark_profile_payment_submitted() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update public.profiles set status='payment_submitted'
 where id=new.student_id and status in ('pending_payment','rejected');
 return new;
end $$;
create trigger on_payment_submission_created after insert on public.payment_submissions
 for each row execute function public.mark_profile_payment_submitted();
create table public.device_registrations (
 student_id uuid primary key references public.profiles(id) on delete cascade,
 device_hash text not null, registered_at timestamptz not null default now()
);
create table public.exams (
 id uuid primary key default gen_random_uuid(), course_id uuid not null references public.courses(id) on delete cascade,
 title text not null, published boolean not null default false, created_at timestamptz not null default now()
);
create table public.exam_questions (
 id uuid primary key default gen_random_uuid(), exam_id uuid not null references public.exams(id) on delete cascade,
 prompt text not null, question_type text not null check(question_type in ('multiple_choice','true_false')),
 marks numeric not null default 1 check(marks>0), question_order integer not null default 0
);
-- Correct answers are stored separately so a learner can never fetch them before submission.
create table public.exam_answer_keys (
 question_id uuid primary key references public.exam_questions(id) on delete cascade, correct_answer text not null
);
create table public.question_options (
 id uuid primary key default gen_random_uuid(), question_id uuid not null references public.exam_questions(id) on delete cascade,
 option_text text not null, option_order integer not null default 0
);
create table public.exam_attempts (
 id uuid primary key default gen_random_uuid(), exam_id uuid not null references public.exams(id) on delete cascade,
 student_id uuid not null references public.profiles(id) on delete cascade, score numeric not null default 0,
 submitted_at timestamptz not null default now()
);
create table public.student_answers (
 id uuid primary key default gen_random_uuid(), attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
 question_id uuid not null references public.exam_questions(id) on delete cascade, answer_text text not null,
 is_correct boolean not null, marks_awarded numeric not null default 0, unique(attempt_id,question_id)
);
create table public.lesson_progress (
 student_id uuid not null references public.profiles(id) on delete cascade, lesson_id uuid not null references public.lessons(id) on delete cascade,
 completed_at timestamptz not null default now(), primary key(student_id,lesson_id)
);

create function public.create_profile_for_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,full_name,role,status)
 values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),'student','pending_payment');
 return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile_for_new_user();

create function public.is_teacher() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='teacher')
$$;
create function public.has_course_access(target_course uuid) returns boolean language sql stable security definer set search_path=public as $$
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

create policy "profile read own or teacher" on public.profiles for select to authenticated using(id=auth.uid() or public.is_teacher());
-- Role/status deliberately excluded: students may update their name only.
create policy "profile update own name" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid() and role='student' and status in ('pending_payment','payment_submitted','approved','rejected','suspended'));
revoke update on public.profiles from authenticated;
grant update(full_name) on public.profiles to authenticated;
create policy "teacher manages profiles" on public.profiles for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
create policy "published courses readable" on public.courses for select to anon,authenticated using(status='published' or public.is_teacher());
create policy "teacher manages courses" on public.courses for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
create policy "enrollment own or teacher" on public.enrollments for select to authenticated using(student_id=auth.uid() or public.is_teacher());
create policy "student requests enrollment" on public.enrollments for insert to authenticated with check(student_id=auth.uid() and status='pending');
create policy "teacher manages enrollments" on public.enrollments for update to authenticated using(public.is_teacher()) with check(public.is_teacher());
create policy "lessons readable with access" on public.lessons for select to authenticated using(public.is_teacher() or (status='published' and public.has_course_access(course_id)));
create policy "teacher manages lessons" on public.lessons for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
create policy "resources readable with lesson access" on public.lesson_resources for select to authenticated using(public.is_teacher() or exists(select 1 from public.lessons l where l.id=lesson_id and public.has_course_access(l.course_id)));
create policy "teacher manages resources" on public.lesson_resources for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
create policy "payments own or teacher" on public.payment_submissions for select to authenticated using(student_id=auth.uid() or public.is_teacher());
create policy "student submits payment" on public.payment_submissions for insert to authenticated with check(student_id=auth.uid() and status='submitted');
create policy "teacher reviews payments" on public.payment_submissions for update to authenticated using(public.is_teacher()) with check(public.is_teacher());
create policy "device self or teacher" on public.device_registrations for select to authenticated using(student_id=auth.uid() or public.is_teacher());
create policy "device manages self" on public.device_registrations for insert to authenticated with check(student_id=auth.uid());
create policy "teacher resets devices" on public.device_registrations for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
create policy "exams public if published" on public.exams for select to authenticated using(public.is_teacher() or (published and public.has_course_access(course_id)));
create policy "teacher manages exams" on public.exams for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
create policy "questions only via exam access" on public.exam_questions for select to authenticated using(public.is_teacher() or exists(select 1 from public.exams e where e.id=exam_id and e.published and public.has_course_access(e.course_id)));
create policy "teacher manages questions" on public.exam_questions for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
create policy "teacher manages answer keys" on public.exam_answer_keys for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
create policy "options only via question access" on public.question_options for select to authenticated using(public.is_teacher() or exists(select 1 from public.exam_questions q join public.exams e on e.id=q.exam_id where q.id=question_id and e.published and public.has_course_access(e.course_id)));
create policy "teacher manages options" on public.question_options for all to authenticated using(public.is_teacher()) with check(public.is_teacher());
create policy "attempts own or teacher" on public.exam_attempts for select to authenticated using(student_id=auth.uid() or public.is_teacher());
create policy "answers own or teacher" on public.student_answers for select to authenticated using(exists(select 1 from public.exam_attempts a where a.id=attempt_id and (a.student_id=auth.uid() or public.is_teacher())));
-- Attempts and grades are created by the grading Edge Function using server-side credentials.
revoke insert, update, delete on public.exam_attempts from authenticated;
revoke insert, update, delete on public.student_answers from authenticated;
create policy "progress own or teacher" on public.lesson_progress for select to authenticated using(student_id=auth.uid() or public.is_teacher());
create policy "progress own" on public.lesson_progress for insert to authenticated with check(student_id=auth.uid() and exists(select 1 from public.lessons l where l.id=lesson_id and public.has_course_access(l.course_id)));
create policy "progress own update" on public.lesson_progress for update to authenticated using(student_id=auth.uid() and exists(select 1 from public.lessons l where l.id=lesson_id and public.has_course_access(l.course_id))) with check(student_id=auth.uid() and exists(select 1 from public.lessons l where l.id=lesson_id and public.has_course_access(l.course_id)));
create policy "teacher manages progress" on public.lesson_progress for all to authenticated using(public.is_teacher()) with check(public.is_teacher());

-- Private buckets. Receipt files are isolated from course documents.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('receipts','receipts',false,5242880,array['image/jpeg','image/png','application/pdf']),
 ('course-materials','course-materials',false,26214400,array['application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-powerpoint','image/jpeg','image/png'])
on conflict(id) do nothing;
create policy "students upload own receipt" on storage.objects for insert to authenticated with check(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "students and teachers read receipts" on storage.objects for select to authenticated using(bucket_id='receipts' and (public.is_teacher() or (storage.foldername(name))[1]=auth.uid()::text));
create policy "teachers manage course materials" on storage.objects for all to authenticated using(bucket_id='course-materials' and public.is_teacher()) with check(bucket_id='course-materials' and public.is_teacher());
create policy "enrolled students read permitted course materials" on storage.objects for select to authenticated using(
 bucket_id='course-materials' and exists(
  select 1 from public.lesson_resources r join public.lessons l on l.id=r.lesson_id
  where r.storage_path=name and public.has_course_access(l.course_id)
 )
);
