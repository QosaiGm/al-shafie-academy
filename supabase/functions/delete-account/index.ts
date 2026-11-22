import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}})
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
const from64=(value:string)=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))
async function sign(payload:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))))}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
 if(req.method!=='POST')return json({error:'Method not allowed'},405)
 const authorization=req.headers.get('Authorization')
 if(!authorization)return json({error:'Sign in required'},401)
 const url=Deno.env.get('SUPABASE_URL')!
 const caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}}})
 const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
 const {data:{user},error}=await caller.auth.getUser()
 if(error||!user)return json({error:'Invalid session'},401)
 const body=await req.json().catch(()=>({}))
 const {data:profile}=await admin.from('profiles').select('role').eq('id',user.id).maybeSingle()
 if(profile?.role!=='student')return json({error:'Student account required'},403)
 if(body.action==='schedule'){
  let token=authorization.replace(/^Bearer\s+/i,'')
  if(typeof body.reauth_token==='string'){
   const reauth=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:`Bearer ${body.reauth_token}`}}})
   const {data:{user:verifiedUser},error:reauthError}=await reauth.auth.getUser()
   if(reauthError||verifiedUser?.id!==user.id)return json({error:'Password verification failed'},403)
   token=body.reauth_token
  }
  let authTime=0;try{authTime=Number(JSON.parse(new TextDecoder().decode(from64(token.split('.')[1]))).auth_time)}catch{}
  if(!authTime||Date.now()-authTime*1000>120_000)return json({error:'Please verify your password again'},403)
  const payload=btoa(JSON.stringify({student_id:user.id,issued_at:Date.now()})).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
  return json({ok:true,delete_token:`${payload}.${await sign(payload)}`})
 }
 if(body.action!=='confirm')return json({error:'Unsupported action'},400)
 const [payload,signature]=String(body.delete_token??'').split('.')
 if(!payload||!signature||await sign(payload)!==signature)return json({error:'Invalid deletion approval'},403)
 let claim:{student_id:string;issued_at:number};try{claim=JSON.parse(new TextDecoder().decode(from64(payload)))}catch{return json({error:'Invalid deletion approval'},403)}
 const age=Date.now()-claim.issued_at
 if(claim.student_id!==user.id||age<30_000||age>10*60_000)return json({error:'Wait 30 seconds before confirming deletion'},403)
 const {error:deleteError}=await admin.auth.admin.deleteUser(user.id)
 if(deleteError)return json({error:deleteError.message},500)
 return json({ok:true})
})
