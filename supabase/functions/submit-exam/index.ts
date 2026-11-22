import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}})
function sessionIdFromAuthorization(value:string){try{const payload=value.replace(/^Bearer\s+/i,'').split('.')[1];if(!payload)return null;const normalized=payload.replaceAll('-','+').replaceAll('_','/');return (JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,'='))).session_id as string|undefined)??null}catch{return null}}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
 if(req.method!=='POST')return json({error:'Method not allowed'},405)
 const authorization=req.headers.get('Authorization');if(!authorization)return json({error:'Sign in required'},401)
 const url=Deno.env.get('SUPABASE_URL')!,admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}}})
 const {data:{user},error:authError}=await caller.auth.getUser();if(authError||!user)return json({error:'Invalid session'},401)
 const {exam_id,answers}=await req.json();if(typeof exam_id!=='string'||!answers||typeof answers!=='object'||Array.isArray(answers))return json({error:'Invalid submission'},400)
 const {data:exam}=await admin.from('exams').select('id,course_id,semester,published').eq('id',exam_id).single();if(!exam?.published)return json({error:'Exam is unavailable'},404)
 const {data:profile}=await admin.from('profiles').select('role,status').eq('id',user.id).single()
 if(!['teacher','admin'].includes(profile?.role??'')){
  const {data:device}=await admin.from('device_registrations').select('session_id').eq('student_id',user.id).maybeSingle()
  if(!device?.session_id||device.session_id!==sessionIdFromAuthorization(authorization))return json({error:'Teacher reset required before signing in again'},403)
  if(profile?.status!=='approved')return json({error:'Account approval required'},403)
  const {data:subscription}=await admin.from('semester_subscriptions').select('status,installments_paid,grace_until').eq('student_id',user.id).eq('course_id',exam.course_id).eq('semester',exam.semester).maybeSingle()
  if(!subscription)return json({error:'Active semester subscription required'},403)
  const fullyPaid=subscription.status==='completed'&&subscription.installments_paid===3
  const withinGrace=subscription.status==='active'&&subscription.installments_paid>0&&subscription.grace_until&&Date.parse(subscription.grace_until)>=Date.now()
  const {data:submittedInstallment}=!fullyPaid&&subscription.installments_paid<3&&subscription.grace_until
   ?await admin.from('payment_submissions').select('id').eq('student_id',user.id).eq('course_id',exam.course_id).eq('study_plan',exam.semester).eq('installment_number',subscription.installments_paid+1).eq('status','submitted').lte('created_at',subscription.grace_until).limit(1).maybeSingle()
   :{data:null}
  if(!fullyPaid&&!withinGrace&&!submittedInstallment)return json({error:'Semester access paused after the installment grace period'},403)
 }
 const {data:questions,error}=await admin.from('exam_questions').select('id,marks,question_type,question_options(option_text)').eq('exam_id',exam_id)
 if(error||!questions?.length)return json({error:'Exam has no questions'},400)
 const qids=new Set(questions.map(q=>q.id));if(Object.keys(answers).some(id=>!qids.has(id))||Object.keys(answers).length!==questions.length)return json({error:'Submit one answer for every question'},400)
 const {data:keys}=await admin.from('exam_answer_keys').select('question_id,correct_answer').in('question_id',questions.map(q=>q.id));const keyMap=new Map((keys??[]).map(k=>[k.question_id,k.correct_answer]))
 const answerRows=[];let score=0
 for(const q of questions){const raw=(answers as Record<string,unknown>)[q.id];if(typeof raw!=='string'||raw.length>500)return json({error:'Invalid answer format'},400)
  const options=(q.question_options??[]).map((option:{option_text:string})=>option.option_text)
  if(q.question_type==='multiple_choice'&&!options.some((option:string)=>option.trim().toLowerCase()===raw.trim().toLowerCase()))return json({error:'Answer option is invalid'},400)
  if(q.question_type==='true_false'&&!['true','false'].includes(raw.toLowerCase()))return json({error:'Answer must be true or false'},400)
  const correct=raw.trim().toLowerCase()===String(keyMap.get(q.id)??'').trim().toLowerCase();const marks=correct?Number(q.marks):0;score+=marks
  answerRows.push({question_id:q.id,answer_text:raw,is_correct:correct,marks_awarded:marks})
 }
 const {data:attempt,error:insertError}=await admin.from('exam_attempts').insert({exam_id,student_id:user.id,score}).select('id,score,submitted_at').single()
 if(insertError||!attempt)return json({error:'Could not save exam attempt'},500)
 const saved=await admin.from('student_answers').insert(answerRows.map(a=>({...a,attempt_id:attempt.id})))
 if(saved.error){await admin.from('exam_attempts').delete().eq('id',attempt.id);return json({error:'Could not save exam answers'},500)}
 return json({attempt_id:attempt.id,score:attempt.score,submitted_at:attempt.submitted_at})
})
