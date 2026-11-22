-- Single-teacher, single-course academy; monthly subscriptions and public preview lessons.
-- Safe to rerun in Supabase SQL Editor.

alter table public.enrollments
  add column if not exists expires_at timestamptz;

alter table public.lessons
  add column if not exists is_preview boolean not null default false;

alter table public.platform_settings
  add column if not exists monthly_price_cents integer not null default 0
    check (monthly_price_cents >= 0);

alter table public.enrollments
  drop constraint if exists enrollments_study_plan_check;
alter table public.enrollments
  add constraint enrollments_study_plan_check
  check (study_plan in ('semester_one','semester_two','both','monthly'));

alter table public.payment_submissions
  drop constraint if exists payment_submissions_study_plan_check;
alter table public.payment_submissions
  add constraint payment_submissions_study_plan_check
  check (study_plan in ('semester_one','semester_two','both','monthly'));

drop policy if exists "student updates pending enrollment" on public.enrollments;
create policy "student updates pending enrollment"
  on public.enrollments for update to authenticated
  using (
    student_id = auth.uid()
    and (
      status in ('pending','rejected')
      or (status = 'approved' and expires_at is not null and expires_at <= now())
    )
  )
  with check (student_id = auth.uid() and status = 'pending');

-- These indexes prevent new second teacher/course records. If old duplicates exist,
-- resolve them manually before running this migration; it intentionally deletes nothing.
create unique index if not exists profiles_single_teacher_only
  on public.profiles ((true)) where role = 'teacher';
create unique index if not exists courses_single_academy_course_only
  on public.courses ((true));

create or replace function public.has_course_access(target_course uuid)
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1
    from public.profiles p
    join public.enrollments e on e.student_id = p.id
    where p.id = auth.uid()
      and p.status = 'approved'
      and e.course_id = target_course
      and e.status = 'approved'
      and (e.expires_at is null or e.expires_at > now())
  )
$$;

-- Anyone can read the metadata of published preview lessons. Paid lessons and all
-- lesson resources remain gated by an active enrollment.
drop policy if exists "lessons readable with access" on public.lessons;
drop policy if exists "public preview lessons" on public.lessons;
drop policy if exists "authenticated lessons preview or active" on public.lessons;
create policy "public preview lessons"
  on public.lessons for select to anon
  using (status = 'published' and is_preview);
create policy "authenticated lessons preview or active"
  on public.lessons for select to authenticated
  using (
    status = 'published'
    and (is_preview or public.has_course_access(course_id) or public.is_teacher())
  );
grant select on public.lessons to anon, authenticated;

-- Monthly expiry is enforced even if an exam is submitted through the SQL RPC.
create or replace function public.guard_exam_attempt_access()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_course_id uuid;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if public.is_teacher() then
    return new;
  end if;
  select e.course_id into v_course_id
  from public.exams e
  where e.id = new.exam_id and e.published;
  if v_course_id is null
     or new.student_id is distinct from auth.uid()
     or not public.has_course_access(v_course_id) then
    raise exception 'Active course subscription required' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_exam_attempt_active_subscription on public.exam_attempts;
create trigger guard_exam_attempt_active_subscription
  before insert on public.exam_attempts
  for each row execute function public.guard_exam_attempt_access();

-- A monthly plan starts when the teacher approves its receipt. Early renewals add
-- one month to the existing expiry; semester plans have no monthly expiry.
create or replace function public.review_payment_submission(
  p_submission_id uuid,
  p_decision text
)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_student_id uuid;
  v_course_id uuid;
  v_study_plan text;
  v_existing_status text;
  v_existing_expiry timestamptz;
  v_had_active_access boolean := false;
  v_new_expiry timestamptz;
begin
  if auth.uid() is null or not public.is_teacher() then
    raise exception 'Teacher access required' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid payment decision' using errcode = '22023';
  end if;

  update public.payment_submissions ps
  set status = p_decision, reviewed_by = auth.uid(), reviewed_at = now()
  where ps.id = p_submission_id and ps.status = 'submitted'
  returning ps.student_id, ps.course_id, ps.study_plan
  into v_student_id, v_course_id, v_study_plan;
  if not found then
    raise exception 'Payment submission not found or already reviewed' using errcode = 'P0002';
  end if;

  select e.status, e.expires_at into v_existing_status, v_existing_expiry
  from public.enrollments e
  where e.student_id = v_student_id and e.course_id = v_course_id
  for update;
  if not found then
    raise exception 'Enrollment record not found' using errcode = 'P0002';
  end if;
  v_had_active_access := v_existing_status = 'approved'
    and (v_existing_expiry is null or v_existing_expiry > now());

  if p_decision = 'approved' then
    if v_study_plan = 'monthly' then
      v_new_expiry := case
        when v_existing_status = 'approved'
          and v_existing_expiry is not null
          and v_existing_expiry > now()
        then v_existing_expiry + interval '1 month'
        else now() + interval '1 month'
      end;
    else
      v_new_expiry := null;
    end if;
    update public.enrollments
      set status = 'approved', study_plan = v_study_plan, expires_at = v_new_expiry
      where student_id = v_student_id and course_id = v_course_id;
    update public.profiles set status = 'approved' where id = v_student_id;
  elsif not v_had_active_access then
    update public.enrollments set status = 'rejected'
      where student_id = v_student_id and course_id = v_course_id;
    update public.profiles set status = 'rejected' where id = v_student_id;
  end if;

  return jsonb_build_object('ok', true, 'status', p_decision, 'expires_at', v_new_expiry);
end;
$$;

revoke all on function public.guard_exam_attempt_access() from public, anon;
revoke all on function public.review_payment_submission(uuid, text) from public, anon;
grant execute on function public.review_payment_submission(uuid, text) to authenticated;

-- Teacher announcements shown in the student dashboard and notification feed.
create table if not exists public.academy_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 120),
  body text not null check (char_length(trim(body)) between 1 and 3000),
  published boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists academy_announcements_published_created_at_idx
  on public.academy_announcements (created_at desc) where published;

alter table public.academy_announcements enable row level security;
drop policy if exists "read published academy announcements" on public.academy_announcements;
create policy "read published academy announcements"
  on public.academy_announcements for select to authenticated
  using (published or public.is_teacher());
drop policy if exists "teachers manage academy announcements" on public.academy_announcements;
create policy "teachers manage academy announcements"
  on public.academy_announcements for all to authenticated
  using (public.is_teacher())
  with check (public.is_teacher() and created_by = auth.uid());
grant select, insert, update, delete on public.academy_announcements to authenticated;
