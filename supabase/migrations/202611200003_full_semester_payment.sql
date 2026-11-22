-- Preserve both ways to buy a semester: pay all at once, or pay three monthly
-- installments. This migration follows 202611200002_semester_installments.sql.

alter table public.payment_submissions
  add column if not exists payment_option text not null default 'installment'
  check (payment_option in ('installment','full'));

drop function if exists public.student_submit_semester_payment(uuid,text,text,text);

create or replace function public.student_submit_semester_payment(
  p_course_id uuid,
  p_semester text,
  p_receipt_path text,
  p_payment_method text,
  p_payment_option text
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
  if p_payment_option is null or p_payment_option not in ('installment','full') then raise exception 'Invalid semester payment option' using errcode='22023'; end if;
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
  if p_payment_option='full' and v_paid>0 then
    raise exception 'Installments have already started; continue with the remaining installments' using errcode='22023';
  end if;
  if exists (select 1 from public.payment_submissions ps where ps.student_id=v_student and ps.course_id=p_course_id
      and ps.study_plan=p_semester and ps.status='submitted') then
    raise exception 'A receipt for this semester is already awaiting teacher review' using errcode='23505';
  end if;

  if p_payment_option='full' then
    v_installment := null;
    v_amount := v_price;
  else
    v_installment := v_paid + 1;
    v_amount := case when v_installment < 3 then v_price / 3 else v_price - ((v_price / 3) * 2) end;
  end if;
  insert into public.payment_submissions(student_id,course_id,receipt_path,status,study_plan,amount_cents,payment_method,installment_number,payment_option)
    values(v_student,p_course_id,p_receipt_path,'submitted',p_semester,v_amount,p_payment_method,v_installment,p_payment_option)
    returning id into v_id;
  return jsonb_build_object('id',v_id,'semester',p_semester,'payment_option',p_payment_option,
    'installment_number',v_installment,'amount_cents',v_amount);
end;
$$;

create or replace function public.review_payment_submission(p_submission_id uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_student uuid; v_course uuid; v_semester text; v_installment smallint; v_option text;
  v_paid smallint; v_status text; v_due timestamptz; v_new_paid smallint; v_new_due timestamptz;
begin
  if auth.uid() is null or not public.is_teacher() then raise exception 'Teacher access required' using errcode='42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Invalid payment decision' using errcode='22023'; end if;
  select student_id,course_id,study_plan,installment_number,payment_option
    into v_student,v_course,v_semester,v_installment,v_option
    from public.payment_submissions where id=p_submission_id and status='submitted' for update;
  if not found then raise exception 'Payment submission not found or already reviewed' using errcode='P0002'; end if;
  if v_semester not in ('semester_one','semester_two') or v_option not in ('installment','full') then
    raise exception 'This legacy request cannot be approved; ask the student to submit a new receipt' using errcode='22023';
  end if;
  select installments_paid,status,next_due_at into v_paid,v_status,v_due
    from public.semester_subscriptions
    where student_id=v_student and course_id=v_course and semester=v_semester for update;
  if not found then raise exception 'Semester subscription record not found' using errcode='P0002'; end if;
  if v_option='full' then
    if v_paid<>0 then raise exception 'Installments have already started for this semester' using errcode='22023'; end if;
  elsif v_installment is null or v_installment<>v_paid+1 then
    raise exception 'This installment is no longer current' using errcode='22023';
  end if;

  update public.payment_submissions set status=p_decision,reviewed_by=auth.uid(),reviewed_at=now()
    where id=p_submission_id;
  if p_decision='rejected' then
    if v_paid=0 then update public.semester_subscriptions set status='pending_payment',updated_at=now()
      where student_id=v_student and course_id=v_course and semester=v_semester; end if;
    return jsonb_build_object('ok',true,'status','rejected','payment_option',v_option,'installment_number',v_installment);
  end if;

  if v_option='full' then
    update public.semester_subscriptions set installments_paid=3,status='completed',next_due_at=null,grace_until=null,
      completed_at=now(),updated_at=now()
      where student_id=v_student and course_id=v_course and semester=v_semester;
    v_new_paid := 3;
    v_new_due := null;
  else
    v_new_paid := v_paid + 1;
    if v_new_paid=3 then
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
  end if;
  update public.profiles set status='approved' where id=v_student and role='student';
  insert into public.enrollments(student_id,course_id,status,study_plan,expires_at)
    values(v_student,v_course,'approved',v_semester,null)
    on conflict(student_id,course_id) do update set status='approved',study_plan=excluded.study_plan,expires_at=null;
  return jsonb_build_object('ok',true,'status',case when v_new_paid=3 then 'completed' else 'active' end,
    'payment_option',v_option,'installments_paid',v_new_paid,'next_due_at',v_new_due);
end;
$$;

revoke all on function public.student_submit_semester_payment(uuid,text,text,text,text) from public,anon;
revoke all on function public.review_payment_submission(uuid,text) from public,anon;
grant execute on function public.student_submit_semester_payment(uuid,text,text,text,text) to authenticated;
grant execute on function public.review_payment_submission(uuid,text) to authenticated;
