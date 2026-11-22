-- Semester subscriptions are independent. Each semester has three monthly
-- installments; the third installment absorbs any rounding remainder.

alter table public.lessons
  add column if not exists semester text not null default 'semester_one'
  check (semester in ('semester_one','semester_two'));
alter table public.exams
  add column if not exists semester text not null default 'semester_one'
  check (semester in ('semester_one','semester_two'));
alter table public.course_library_resources
  add column if not exists semester text not null default 'semester_one'
  check (semester in ('semester_one','semester_two'));
alter table public.payment_submissions
  add column if not exists installment_number smallint
  check (installment_number between 1 and 3);

-- A 150 NIS first semester price is the academy's starting price. Teachers can
-- change it in Settings; the monthly installment amount is always recalculated.
update public.platform_settings
set semester_one_price_cents = 15000
where id = true and semester_one_price_cents = 0;

create table if not exists public.semester_subscriptions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  semester text not null check (semester in ('semester_one','semester_two')),
  status text not null default 'pending_payment'
    check (status in ('pending_payment','active','suspended','completed')),
  installments_paid smallint not null default 0 check (installments_paid between 0 and 3),
  next_due_at timestamptz,
  grace_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, course_id, semester),
  check ((status = 'completed') = (installments_paid = 3))
);
create index if not exists semester_subscriptions_student_idx
  on public.semester_subscriptions(student_id, course_id, semester);
alter table public.semester_subscriptions enable row level security;
drop policy if exists "students and teachers read semester subscriptions" on public.semester_subscriptions;
create policy "students and teachers read semester subscriptions"
  on public.semester_subscriptions for select to authenticated
  using (student_id = auth.uid() or public.is_teacher());
grant select on public.semester_subscriptions to authenticated;

-- Preserve current semester access while translating the old single-enrollment
-- data model. Legacy "both" access becomes two completed semester records.
insert into public.semester_subscriptions
  (student_id,course_id,semester,status,installments_paid,next_due_at,grace_until,completed_at,created_at)
select e.student_id,e.course_id,sem.semester,
  case
    when e.status <> 'approved' then 'pending_payment'
    when e.study_plan = 'monthly' and e.expires_at is not null and e.expires_at <= now() then 'suspended'
    when e.study_plan = 'monthly' then 'active'
    else 'completed'
  end,
  case when e.status <> 'approved' then 0 when e.study_plan = 'monthly' then 1 else 3 end,
  case when e.study_plan = 'monthly' then coalesce(e.expires_at, e.created_at + interval '1 month') else null end,
  case when e.study_plan = 'monthly' then coalesce(e.expires_at, e.created_at + interval '1 month') + interval '3 days' else null end,
  case when e.status = 'approved' and e.study_plan <> 'monthly' then e.created_at else null end,
  e.created_at
from public.enrollments e
cross join lateral (
  select unnest(case e.study_plan
    when 'both' then array['semester_one','semester_two']::text[]
    when 'semester_two' then array['semester_two']::text[]
    else array['semester_one']::text[] end) as semester
) sem
on conflict (student_id,course_id,semester) do nothing;

-- Existing outstanding receipts are assigned to the first semester's first
-- installment so the teacher can still review the uploaded receipt.
update public.payment_submissions
set study_plan = case when study_plan = 'semester_two' then 'semester_two' else 'semester_one' end,
    installment_number = coalesce(installment_number, 1)
where status = 'submitted' and installment_number is null;

create or replace function public.has_semester_access(target_course uuid, target_semester text)
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1
    from public.profiles p
    join public.semester_subscriptions s on s.student_id = p.id
    join public.device_registrations d on d.student_id = p.id
    where p.id = auth.uid()
      and p.role in ('student','admin')
      and p.status = 'approved'
      and s.course_id = target_course
      and s.semester = target_semester
      and d.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and (
        (s.status = 'completed' and s.installments_paid = 3)
        or (
          s.status = 'active'
          and s.installments_paid between 1 and 2
          and now() <= s.grace_until
        )
        or exists (
          select 1 from public.payment_submissions ps
          where ps.student_id = s.student_id
            and ps.course_id = s.course_id
            and ps.study_plan = s.semester
            and ps.installment_number = s.installments_paid + 1
            and ps.status = 'submitted'
            and ps.created_at <= s.grace_until
        )
      )
  )
$$;
revoke all on function public.has_semester_access(uuid,text) from public, anon;
grant execute on function public.has_semester_access(uuid,text) to authenticated;

-- Keep older course-wide checks for compatibility, while all semester content
-- below uses the more specific helper.
create or replace function public.has_course_access(target_course uuid)
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select public.has_semester_access(target_course, 'semester_one')
      or public.has_semester_access(target_course, 'semester_two')
$$;
revoke all on function public.has_course_access(uuid) from public, anon;
grant execute on function public.has_course_access(uuid) to authenticated;

drop policy if exists "authenticated lessons preview or active" on public.lessons;
create policy "authenticated lessons preview or active"
  on public.lessons for select to authenticated
  using (status = 'published' and (is_preview or public.has_semester_access(course_id, semester) or public.is_teacher()));

drop policy if exists "resources readable with lesson access" on public.lesson_resources;
create policy "resources readable with lesson access"
  on public.lesson_resources for select to authenticated
  using (public.is_teacher() or exists (
    select 1 from public.lessons l where l.id = lesson_id
      and public.has_semester_access(l.course_id,l.semester)
  ));

drop policy if exists "exams public if published" on public.exams;
create policy "exams public if published" on public.exams for select to authenticated
  using (public.is_teacher() or (published and public.has_semester_access(course_id,semester)));
drop policy if exists "questions only via exam access" on public.exam_questions;
create policy "questions only via exam access" on public.exam_questions for select to authenticated
  using (public.is_teacher() or exists (
    select 1 from public.exams e where e.id = exam_id and e.published
      and public.has_semester_access(e.course_id,e.semester)
  ));
drop policy if exists "options only via question access" on public.question_options;
create policy "options only via question access" on public.question_options for select to authenticated
  using (public.is_teacher() or exists (
    select 1 from public.exam_questions q join public.exams e on e.id=q.exam_id
    where q.id=question_id and e.published and public.has_semester_access(e.course_id,e.semester)
  ));
drop policy if exists "progress own" on public.lesson_progress;
create policy "progress own" on public.lesson_progress for insert to authenticated
  with check (student_id=auth.uid() and exists (
    select 1 from public.lessons l where l.id=lesson_id
      and public.has_semester_access(l.course_id,l.semester)
  ));
drop policy if exists "progress own update" on public.lesson_progress;
create policy "progress own update" on public.lesson_progress for update to authenticated
  using (student_id=auth.uid() and exists (
    select 1 from public.lessons l where l.id=lesson_id
      and public.has_semester_access(l.course_id,l.semester)
  ))
  with check (student_id=auth.uid() and exists (
    select 1 from public.lessons l where l.id=lesson_id
      and public.has_semester_access(l.course_id,l.semester)
  ));

drop policy if exists "students and teachers read course library" on public.course_library_resources;
create policy "students and teachers read course library" on public.course_library_resources
  for select to authenticated
  using (public.is_teacher() or public.has_semester_access(course_id,semester));
drop policy if exists "enrolled students read library materials" on storage.objects;
create policy "enrolled students read library materials" on storage.objects for select to authenticated
  using (bucket_id='course-materials' and exists (
    select 1 from public.course_library_resources r
    where r.storage_path=name and public.has_semester_access(r.course_id,r.semester)
  ));
drop policy if exists "enrolled students read permitted course materials" on storage.objects;
create policy "enrolled students read permitted course materials" on storage.objects for select to authenticated
  using (bucket_id='course-materials' and exists (
    select 1 from public.lesson_resources r join public.lessons l on l.id=r.lesson_id
    where r.storage_path=name and public.has_semester_access(l.course_id,l.semester)
  ));

-- Exam attempts are also checked at write time, so the grading RPC cannot be
-- used to submit a second-semester exam with only first-semester access.
create or replace function public.guard_exam_attempt_access()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare v_course_id uuid; v_semester text;
begin
  if auth.role() = 'service_role' or public.is_teacher() then return new; end if;
  select e.course_id,e.semester into v_course_id,v_semester
  from public.exams e where e.id=new.exam_id and e.published;
  if v_course_id is null or new.student_id is distinct from auth.uid()
     or not public.has_semester_access(v_course_id,v_semester) then
    raise exception 'Active semester subscription required' using errcode='42501';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_exam_attempt_active_subscription on public.exam_attempts;
create trigger guard_exam_attempt_active_subscription before insert on public.exam_attempts
  for each row execute function public.guard_exam_attempt_access();

create or replace function public.student_submit_semester_payment(
  p_course_id uuid,
  p_semester text,
  p_receipt_path text,
  p_payment_method text
)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_student uuid := auth.uid();
  v_paid smallint;
  v_status text;
  v_price integer;
  v_amount integer;
  v_installment smallint;
  v_settings public.platform_settings%rowtype;
  v_id uuid;
begin
  if v_student is null then raise exception 'Sign in required' using errcode='28000'; end if;
  if p_semester not in ('semester_one','semester_two') then raise exception 'Choose one semester' using errcode='22023'; end if;
  if p_payment_method not in ('jawwal_pay','bank_of_palestine','palpay') then raise exception 'Invalid payment method' using errcode='22023'; end if;
  if p_receipt_path is null or split_part(p_receipt_path,'/',1) <> v_student::text then raise exception 'Invalid receipt path' using errcode='42501'; end if;
  if not exists (select 1 from public.profiles p where p.id=v_student and p.role='student' and p.status <> 'suspended') then
    raise exception 'Student account is unavailable' using errcode='42501';
  end if;
  select * into v_settings from public.platform_settings where id=true;
  if not found then raise exception 'Academy payment settings are missing' using errcode='P0002'; end if;
  v_price := case p_semester when 'semester_one' then v_settings.semester_one_price_cents else v_settings.semester_two_price_cents end;
  if v_price <= 0 then raise exception 'The teacher has not set a price for this semester' using errcode='22023'; end if;

  insert into public.semester_subscriptions(student_id,course_id,semester)
    values(v_student,p_course_id,p_semester)
    on conflict(student_id,course_id,semester) do nothing;
  select installments_paid,status into v_paid,v_status
    from public.semester_subscriptions
    where student_id=v_student and course_id=p_course_id and semester=p_semester
    for update;
  if v_status='completed' or v_paid>=3 then raise exception 'This semester has already been paid in full' using errcode='22023'; end if;
  v_installment := v_paid + 1;
  if exists (select 1 from public.payment_submissions ps where ps.student_id=v_student and ps.course_id=p_course_id
      and ps.study_plan=p_semester and ps.installment_number=v_installment and ps.status='submitted') then
    raise exception 'A receipt for this installment is already awaiting teacher review' using errcode='23505';
  end if;
  v_amount := case when v_installment < 3 then v_price / 3 else v_price - ((v_price / 3) * 2) end;
  insert into public.payment_submissions(student_id,course_id,receipt_path,status,study_plan,amount_cents,payment_method,installment_number)
    values(v_student,p_course_id,p_receipt_path,'submitted',p_semester,v_amount,p_payment_method,v_installment)
    returning id into v_id;
  return jsonb_build_object('id',v_id,'semester',p_semester,'installment_number',v_installment,'amount_cents',v_amount);
end;
$$;

-- Apply overdue suspension lazily as students or teachers return to the site.
-- The access function above also checks timestamps directly, so a stale status
-- can never extend access beyond the grace period.
create or replace function public.refresh_overdue_semester_subscriptions()
returns integer language plpgsql security definer set search_path = public, auth as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='28000'; end if;
  update public.semester_subscriptions s
  set status='suspended',updated_at=now()
  where s.status='active' and s.installments_paid between 1 and 2
    and s.grace_until < now()
    and not exists (
      select 1 from public.payment_submissions ps
      where ps.student_id=s.student_id and ps.course_id=s.course_id and ps.study_plan=s.semester
        and ps.installment_number=s.installments_paid+1 and ps.status='submitted'
        and ps.created_at <= s.grace_until
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.review_payment_submission(p_submission_id uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_student uuid; v_course uuid; v_semester text; v_installment smallint;
  v_paid smallint; v_status text; v_due timestamptz; v_new_paid smallint; v_new_due timestamptz;
begin
  if auth.uid() is null or not public.is_teacher() then raise exception 'Teacher access required' using errcode='42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Invalid payment decision' using errcode='22023'; end if;
  select student_id,course_id,study_plan,coalesce(installment_number,1)
    into v_student,v_course,v_semester,v_installment
    from public.payment_submissions where id=p_submission_id and status='submitted' for update;
  if not found then raise exception 'Payment submission not found or already reviewed' using errcode='P0002'; end if;
  if v_semester not in ('semester_one','semester_two') or v_installment not between 1 and 3 then
    raise exception 'This legacy request cannot be approved; ask the student to submit a semester receipt again' using errcode='22023';
  end if;
  select installments_paid,status,next_due_at into v_paid,v_status,v_due
    from public.semester_subscriptions
    where student_id=v_student and course_id=v_course and semester=v_semester for update;
  if not found then raise exception 'Semester subscription record not found' using errcode='P0002'; end if;
  if v_installment <> v_paid + 1 then raise exception 'This installment is no longer current' using errcode='22023'; end if;

  update public.payment_submissions set status=p_decision,reviewed_by=auth.uid(),reviewed_at=now()
    where id=p_submission_id;
  if p_decision='rejected' then
    if v_paid=0 then update public.semester_subscriptions set status='pending_payment',updated_at=now()
      where student_id=v_student and course_id=v_course and semester=v_semester; end if;
    return jsonb_build_object('ok',true,'status','rejected','installment_number',v_installment);
  end if;

  v_new_paid := v_paid + 1;
  if v_new_paid = 3 then
    update public.semester_subscriptions set installments_paid=3,status='completed',next_due_at=null,grace_until=null,
      completed_at=now(),updated_at=now()
      where student_id=v_student and course_id=v_course and semester=v_semester;
    v_new_due := null;
  else
    v_new_due := greatest(coalesce(v_due,now()),now()) + interval '1 month';
    update public.semester_subscriptions set installments_paid=v_new_paid,status='active',next_due_at=v_new_due,
      grace_until=v_new_due + interval '3 days',updated_at=now()
      where student_id=v_student and course_id=v_course and semester=v_semester;
  end if;
  update public.profiles set status='approved' where id=v_student and role='student';
  insert into public.enrollments(student_id,course_id,status,study_plan,expires_at)
    values(v_student,v_course,'approved',v_semester,null)
    on conflict(student_id,course_id) do update set status='approved',study_plan=excluded.study_plan,expires_at=null;
  return jsonb_build_object('ok',true,'status',case when v_new_paid=3 then 'completed' else 'active' end,
    'installments_paid',v_new_paid,'next_due_at',v_new_due);
end;
$$;

drop policy if exists "student submits payment" on public.payment_submissions;
revoke insert on public.payment_submissions from authenticated;
revoke all on function public.student_submit_semester_payment(uuid,text,text,text) from public,anon;
revoke all on function public.refresh_overdue_semester_subscriptions() from public,anon;
revoke all on function public.review_payment_submission(uuid,text) from public,anon;
grant execute on function public.student_submit_semester_payment(uuid,text,text,text) to authenticated;
grant execute on function public.refresh_overdue_semester_subscriptions() to authenticated;
grant execute on function public.review_payment_submission(uuid,text) to authenticated;
