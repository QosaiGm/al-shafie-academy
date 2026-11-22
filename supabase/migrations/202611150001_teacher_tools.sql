-- Teacher tools: student status management, course library files, and secure exam grading.

create table if not exists public.course_library_resources (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  description text not null default '',
  storage_path text not null unique,
  mime_type text not null,
  created_at timestamptz not null default now()
);

alter table public.course_library_resources enable row level security;
drop policy if exists "students and teachers read course library" on public.course_library_resources;
create policy "students and teachers read course library" on public.course_library_resources
  for select to authenticated using (public.is_teacher() or public.has_course_access(course_id));
drop policy if exists "teachers manage course library" on public.course_library_resources;
create policy "teachers manage course library" on public.course_library_resources
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
grant select, insert, update, delete on public.course_library_resources to authenticated;

drop policy if exists "enrolled students read library materials" on storage.objects;
create policy "enrolled students read library materials" on storage.objects
  for select to authenticated using (
    bucket_id = 'course-materials'
    and exists (
      select 1 from public.course_library_resources r
      where r.storage_path = name and public.has_course_access(r.course_id)
    )
  );

-- Keep account suspension in SQL and preserve the student's access state when reactivated.
create or replace function public.teacher_set_student_suspended(
  p_student_id uuid,
  p_suspended boolean
)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_status public.account_status;
begin
  if auth.uid() is null or not public.is_teacher() then
    raise exception 'Teacher access required' using errcode = '42501';
  end if;
  if p_student_id = auth.uid() then
    raise exception 'A teacher cannot suspend their own account here' using errcode = '22023';
  end if;

  if p_suspended then
    v_status := 'suspended';
  elsif exists (
    select 1 from public.enrollments e
    where e.student_id = p_student_id and e.status = 'approved'
  ) then
    v_status := 'approved';
  elsif exists (
    select 1 from public.payment_submissions ps
    where ps.student_id = p_student_id and ps.status = 'submitted'
  ) then
    v_status := 'payment_submitted';
  elsif exists (
    select 1 from public.payment_submissions ps
    where ps.student_id = p_student_id and ps.status = 'rejected'
  ) then
    v_status := 'rejected';
  else
    v_status := 'pending_payment';
  end if;

  update public.profiles
  set status = v_status
  where id = p_student_id and role = 'student';
  if not found then
    raise exception 'Student not found' using errcode = 'P0002';
  end if;
  return v_status::text;
end;
$$;
revoke all on function public.teacher_set_student_suspended(uuid, boolean) from public, anon;
grant execute on function public.teacher_set_student_suspended(uuid, boolean) to authenticated;

-- Grade exam submissions without exposing answer keys to student accounts.
create or replace function public.submit_exam_attempt(
  p_exam_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_course_id uuid;
  v_role text;
  v_profile_status public.account_status;
  v_question record;
  v_answer text;
  v_correct_answer text;
  v_correct boolean;
  v_score numeric := 0;
  v_max_score numeric := 0;
  v_question_count integer := 0;
  v_answer_count integer;
  v_attempt_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  if jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers must be an object' using errcode = '22023';
  end if;

  select e.course_id into v_course_id
  from public.exams e
  where e.id = p_exam_id and e.published;
  if not found then
    raise exception 'Exam is unavailable' using errcode = 'P0002';
  end if;

  select p.role, p.status into v_role, v_profile_status
  from public.profiles p where p.id = v_user_id;
  if v_role is distinct from 'teacher' then
    if v_profile_status is distinct from 'approved' or not exists (
      select 1 from public.enrollments en
      where en.student_id = v_user_id and en.course_id = v_course_id and en.status = 'approved'
    ) then
      raise exception 'Approved course enrollment required' using errcode = '42501';
    end if;
  end if;

  select count(*) into v_question_count from public.exam_questions q where q.exam_id = p_exam_id;
  select count(*) into v_answer_count from jsonb_object_keys(p_answers);
  if v_question_count = 0 or v_answer_count <> v_question_count then
    raise exception 'Answer every question in the exam' using errcode = '22023';
  end if;

  for v_question in
    select q.id, q.question_type, q.marks
    from public.exam_questions q
    where q.exam_id = p_exam_id
    order by q.question_order, q.id
  loop
    v_answer := p_answers ->> v_question.id::text;
    if v_answer is null or length(v_answer) > 500 then
      raise exception 'Invalid answer for question %', v_question.id using errcode = '22023';
    end if;
    if v_question.question_type = 'multiple_choice' then
      if not exists (
        select 1 from public.question_options o
        where o.question_id = v_question.id
          and lower(trim(o.option_text)) = lower(trim(v_answer))
      ) then
        raise exception 'Answer is not one of the available options' using errcode = '22023';
      end if;
    elsif lower(v_answer) not in ('true', 'false') then
      raise exception 'True/false answer must be true or false' using errcode = '22023';
    end if;

    select k.correct_answer into v_correct_answer
    from public.exam_answer_keys k where k.question_id = v_question.id;
    if v_correct_answer is null then
      raise exception 'Exam is missing an answer key' using errcode = '23514';
    end if;
    v_correct := lower(trim(v_answer)) = lower(trim(v_correct_answer));
    v_max_score := v_max_score + v_question.marks;
    if v_correct then v_score := v_score + v_question.marks; end if;
  end loop;

  insert into public.exam_attempts(exam_id, student_id, score)
  values (p_exam_id, v_user_id, v_score)
  returning id into v_attempt_id;

  insert into public.student_answers(attempt_id, question_id, answer_text, is_correct, marks_awarded)
  select v_attempt_id, q.id, p_answers ->> q.id::text,
         lower(trim(p_answers ->> q.id::text)) = lower(trim(k.correct_answer)),
         case when lower(trim(p_answers ->> q.id::text)) = lower(trim(k.correct_answer)) then q.marks else 0 end
  from public.exam_questions q
  join public.exam_answer_keys k on k.question_id = q.id
  where q.exam_id = p_exam_id;

  return jsonb_build_object('attempt_id', v_attempt_id, 'score', v_score, 'max_score', v_max_score);
end;
$$;
revoke all on function public.submit_exam_attempt(uuid, jsonb) from public, anon;
grant execute on function public.submit_exam_attempt(uuid, jsonb) to authenticated;
