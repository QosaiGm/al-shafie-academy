-- Review a submitted payment atomically from the teacher dashboard.
-- This avoids requiring a separately deployed Edge Function.
create or replace function public.review_payment_submission(
  p_submission_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_student_id uuid;
  v_course_id uuid;
  v_study_plan text;
begin
  if auth.uid() is null or not public.is_teacher() then
    raise exception 'Teacher access required' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid payment decision' using errcode = '22023';
  end if;

  update public.payment_submissions ps
  set status = p_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where ps.id = p_submission_id
    and ps.status = 'submitted'
  returning ps.student_id, ps.course_id, ps.study_plan
  into v_student_id, v_course_id, v_study_plan;

  if not found then
    raise exception 'Payment submission not found or already reviewed' using errcode = 'P0002';
  end if;

  update public.enrollments e
  set status = p_decision,
      study_plan = v_study_plan
  where e.student_id = v_student_id
    and e.course_id = v_course_id;

  if not found then
    raise exception 'Enrollment record not found' using errcode = 'P0002';
  end if;

  update public.profiles
  set status = case when p_decision = 'approved' then 'approved'::public.account_status
                    else 'rejected'::public.account_status end
  where id = v_student_id;

  if not found then
    raise exception 'Student profile not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

revoke all on function public.review_payment_submission(uuid, text) from public, anon;
grant execute on function public.review_payment_submission(uuid, text) to authenticated;
