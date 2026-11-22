import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}})
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
const from64=(value:string)=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))
async function sign(payload:string){const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))))}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
 if(req.method!=='POST')return json({error:'Method not allowed'},405)
 const authorization=req.headers.get('Authorization');if(!authorization)return json({error:'Sign in required'},401)
 const url=Deno.env.get('SUPABASE_URL')!,admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}}})
 const {data:{user},error}=await caller.auth.getUser();if(error||!user)return json({error:'Invalid session'},401)
 const {data:profile}=await admin.from('profiles').select('role').eq('id',user.id).single();if(!['teacher','admin'].includes(profile?.role??''))return json({error:'Teacher or admin access required'},403)
 const {student_id,action,delete_token}=await req.json();if(typeof student_id!=='string'||student_id===user.id)return json({error:'Invalid student'},400)
 if(action==='schedule_delete'){
  const {data:target}=await admin.from('profiles').select('id,role').eq('id',student_id).maybeSingle()
  if(!target||target.role!=='student')return json({error:'Student not found'},404)
  const payload=btoa(JSON.stringify({teacher_id:user.id,student_id,issued_at:Date.now()})).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
  return json({ok:true,delete_token:`${payload}.${await sign(payload)}`})
 }
 if(action==='confirm_delete'){
  const token=String(delete_token??'')
  const [payload,signature]=token.split('.')
  if(!payload||!signature||await sign(payload)!==signature)return json({error:'Invalid deletion approval'},403)
  let claim:{teacher_id:string;student_id:string;issued_at:number};try{claim=JSON.parse(new TextDecoder().decode(from64(payload)))}catch{return json({error:'Invalid deletion approval'},403)}
  const age=Date.now()-claim.issued_at
  if(claim.teacher_id!==user.id||claim.student_id!==student_id||age<30_000||age>10*60_000)return json({error:'Wait 30 seconds before confirming deletion'},403)
  const {data:target}=await admin.from('profiles').select('id,role').eq('id',student_id).maybeSingle()
  if(!target||target.role!=='student')return json({error:'Student not found'},404)
  const {error:deleteError}=await admin.auth.admin.deleteUser(student_id)
  if(deleteError)return json({error:deleteError.message},500)
  return json({ok:true,deleted:true})
 }
 if(!['approved','suspended','rejected'].includes(action))return json({error:'Unsupported action'},400)
 const result=await admin.from('profiles').update({status:action}).eq('id',student_id).eq('role','student');if(result.error)return json({error:'Student update failed'},500)
 return json({ok:true,status:action})
})
