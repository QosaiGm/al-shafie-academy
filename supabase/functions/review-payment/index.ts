import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}})
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
 if(req.method!=='POST')return json({error:'Method not allowed'},405)
 const authorization=req.headers.get('Authorization');if(!authorization)return json({error:'Sign in required'},401)
 const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
 const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}}}),admin=createClient(url,service)
 const {data:{user},error:authError}=await caller.auth.getUser();if(authError||!user)return json({error:'Invalid session'},401)
 const {data:profile}=await admin.from('profiles').select('role').eq('id',user.id).single();if(!['teacher','admin'].includes(profile?.role??''))return json({error:'Teacher or admin access required'},403)
 const {submission_id,decision}=await req.json();if(typeof submission_id!=='string'||!['approved','rejected'].includes(decision))return json({error:'Invalid review request'},400)
 const {data:submission,error}=await admin.from('payment_submissions').select('id,student_id,course_id,study_plan,status').eq('id',submission_id).single()
 if(error||!submission)return json({error:'Payment submission not found'},404)
 if(submission.status!=='submitted')return json({error:'This submission has already been reviewed'},409)
 const now=new Date().toISOString()
 const upd=await admin.from('payment_submissions').update({status:decision,reviewed_by:user.id,reviewed_at:now}).eq('id',submission_id).eq('status','submitted')
 if(upd.error)return json({error:'Could not update payment submission'},500)
 const enrollment=await admin.from('enrollments').update({status:decision,study_plan:submission.study_plan}).eq('student_id',submission.student_id).eq('course_id',submission.course_id)
 if(enrollment.error)return json({error:'Payment reviewed, but enrollment update failed; please retry from the admin console.'},500)
 const profileUpdate=await admin.from('profiles').update({status:decision==='approved'?'approved':'rejected'}).eq('id',submission.student_id)
 if(profileUpdate.error)return json({error:'Payment reviewed, but student status update failed.'},500)
 return json({ok:true,status:decision})
})
