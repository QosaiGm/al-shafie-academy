import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, GraduationCap, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { publicAsset } from '../lib/publicAsset'
import { formatLocale } from './localization'

type Semester='semester_one'|'semester_two'
type PaymentMethod='jawwal_pay'|'bank_of_palestine'|'palpay'
type PaymentChoice='installment'|'full'
type User={id:string;user_metadata?:Record<string,unknown>}
type Course={id:string;title:string}
type Settings={academy_name?:string;wallet_provider?:string;wallet_holder:string;wallet_number:string;wallet_instructions:string;bank_name:string;bank_account_holder:string;bank_account_number:string;bank_iban:string;bank_instructions:string;palpay_number:string;palpay_holder:string;palpay_instructions:string;price_currency:string;semester_one_price_cents:number;semester_two_price_cents:number}
type Subscription={id:string;course_id:string;semester:Semester;status:'pending_payment'|'active'|'suspended'|'completed';installments_paid:number;next_due_at:string|null;grace_until:string|null;completed_at:string|null}
const defaults:Settings={wallet_holder:'',wallet_number:'',wallet_instructions:'',bank_name:'بنك فلسطين',bank_account_holder:'',bank_account_number:'',bank_iban:'',bank_instructions:'',palpay_number:'',palpay_holder:'',palpay_instructions:'',price_currency:'ILS',semester_one_price_cents:15000,semester_two_price_cents:0}
const semesterName=(semester:Semester)=>semester==='semester_one'?'الفصل الأول':'الفصل الثاني'
const methodName:Record<PaymentMethod,string>={jawwal_pay:'محفظة جوال باي',bank_of_palestine:'تحويل بنكي · بنك فلسطين',palpay:'محفظة PalPay'}
function money(cents:number,settings:Settings){return cents>0?`${(cents/100).toLocaleString(formatLocale())} ${settings.price_currency}`:'لم يحدد الأستاذ السعر بعد'}
function installmentPrice(total:number,number:number){const first=Math.floor(total/3);return number<3?first:total-first*2}
function installmentStatus(item:Subscription|undefined,pending:boolean,now:number){if(pending)return 'وصل القسط بانتظار مراجعة الأستاذ';if(!item)return 'لم يبدأ الاشتراك';if(item.status==='completed')return 'مكتمل · وصول دائم لهذا الفصل';if(item.status==='suspended'||(item.grace_until&&Date.parse(item.grace_until)<now))return 'موقوف · انتهت مهلة السماح';if(item.status==='active')return `مفعّل · ${item.installments_paid} من 3 أقساط`;return 'بانتظار القسط الأول'}

export function SemesterPaymentPage({user,courses,coursesLoaded}:{user:User;courses:Course[];coursesLoaded:boolean}){
  const {courseId=''}=useParams()
  const nav=useNavigate()
  const course=courses.find(item=>item.id===courseId)
  const available=courses[0]
  const [settings,setSettings]=useState(defaults)
  const [semester,setSemester]=useState<Semester>(()=>new URLSearchParams(window.location.search).get('plan')==='semester_two'?'semester_two':'semester_one')
  const [subscription,setSubscription]=useState<Subscription|null>(null)
  const [pending,setPending]=useState(false)
  const [profile,setProfile]=useState({full_name:'',whatsapp_number:'',phone_number:''})
  const [choice,setChoice]=useState<PaymentChoice>('installment')
  const [method,setMethod]=useState<PaymentMethod>('jawwal_pay')
  const [file,setFile]=useState<File|null>(null)
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false)
  const [loaded,setLoaded]=useState(false)
  useEffect(()=>{
    let live=true
    const selected=(new URLSearchParams(window.location.search).get('plan')==='semester_two'?'semester_two':'semester_one') as Semester
    setSemester(selected)
    async function load(){
      await supabase.rpc('refresh_overdue_semester_subscriptions')
      const [settingsResult,profileResult,subscriptionResult,pendingResult]=await Promise.all([
        supabase.from('platform_settings').select('*').eq('id',true).maybeSingle(),
        supabase.from('profiles').select('full_name,whatsapp_number,phone_number').eq('id',user.id).single(),
        supabase.from('semester_subscriptions').select('id,course_id,semester,status,installments_paid,next_due_at,grace_until,completed_at').eq('student_id',user.id).eq('course_id',courseId).eq('semester',selected).maybeSingle(),
        supabase.from('payment_submissions').select('id').eq('student_id',user.id).eq('course_id',courseId).eq('study_plan',selected).eq('status','submitted').limit(1).maybeSingle(),
      ])
      if(!live)return
      if(settingsResult.data)setSettings({...defaults,...settingsResult.data})
      if(profileResult.data)setProfile(profileResult.data)
      if(subscriptionResult.data)setSubscription(subscriptionResult.data as Subscription)
      if(subscriptionResult.error)setNotice(`تعذّر تحميل حالة الاشتراك: ${subscriptionResult.error.message}`)
      setPending(Boolean(pendingResult.data))
      setLoaded(true)
    }
    void load()
    return()=>{live=false}
  },[user.id,courseId])
  useEffect(()=>{if(coursesLoaded&&!course&&available)nav(`/payment/${available.id}?plan=${semester}`,{replace:true})},[coursesLoaded,course?.id,available?.id,courseId,semester,nav])
  const total=semester==='semester_one'?settings.semester_one_price_cents:settings.semester_two_price_cents
  const installment=(subscription?.installments_paid??0)+1
  const amount=choice==='full'?total:installmentPrice(total,installment)
  const canChooseFull=(subscription?.installments_paid??0)===0
  const complete=subscription?.status==='completed'||subscription?.installments_paid===3
  const expired=subscription?.status==='suspended'||Boolean(subscription?.grace_until&&Date.parse(subscription.grace_until)<Date.now())
  async function submit(event:FormEvent){
    event.preventDefault()
    if(!file||!course)return
    setBusy(true);setNotice('')
    let receipt:string|null=null
    try{
      if(!['image/jpeg','image/png','application/pdf'].includes(file.type)||file.size>5*1024*1024)throw new Error('ارفق صورة JPG أو PNG أو PDF بحجم أقصى 5 MB.')
      if(total<=0)throw new Error('لم يحدد الأستاذ سعر هذا الفصل بعد.')
      receipt=`${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`
      const upload=await supabase.storage.from('receipts').upload(receipt,file,{contentType:file.type})
      if(upload.error)throw upload.error
      const result=await supabase.rpc('student_submit_semester_payment',{p_course_id:course.id,p_semester:semester,p_receipt_path:receipt,p_payment_method:method,p_payment_option:choice})
      if(result.error)throw result.error
      receipt=null;setPending(true);setNotice(choice==='full'?'وصل الدفعة الكاملة للأستاذ، وبانتظار المراجعة.':`وصل القسط ${result.data?.installment_number??installment} للأستاذ، وبانتظار المراجعة.`)
    }catch(error){
      if(receipt)await supabase.storage.from('receipts').remove([receipt])
      const detail=error&&typeof error==='object'&&'message'in error?String((error as {message:unknown}).message):String(error)
      setNotice(`تعذّر إرسال الوصل: ${detail}`)
    }finally{setBusy(false)}
  }
  if(!coursesLoaded||!loaded)return <main className="page-main"><div className="status-card">جارٍ تحميل الاشتراك…</div></main>
  if(!course&&available)return <main className="page-main"><div className="status-card">جارٍ فتح صفحة الاشتراك الصحيحة…</div></main>
  if(!course)return <main className="page-main"><div className="status-card">المادة غير متاحة حاليًا.</div></main>
  if(complete)return <main className="page-main semester-paid-page"><section className="semester-complete"><CheckCircle2 size={30}/><h1>{semesterName(semester)} مكتمل</h1><p>تم سداد الفصل كاملًا. يظل هذا الفصل متاحًا لحسابك.</p><Link className="button button-dark" to={`/courses/${course.id}`}>افتح المادة <ArrowLeft size={16}/></Link></section></main>
  return <div className="checkout-screen"><div className="checkout-background" aria-hidden="true"><div className="checkout-background-banner"/><div className="checkout-background-card"/><div className="checkout-background-grid"><i/><i/><i/></div></div><div className="checkout-scrim" onMouseDown={event=>{if(event.target===event.currentTarget)nav(`/courses/${course.id}`)}}><section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="semester-payment-title"><header className="checkout-header"><Link to={`/courses/${course.id}`} className="checkout-close" aria-label="إغلاق"><X size={17}/></Link><span className="brand-icon"><GraduationCap size={20}/></span><b>AL-SHAFIE ACADEMY</b><small id="semester-payment-title">اشتراك {semesterName(semester)}</small></header><form className="checkout-form" onSubmit={submit}>
    <div className="checkout-step-title"><span>١</span><div><b>{expired?'استعادة الوصول للفصل':choice==='full'?'سداد الفصل كاملًا':`القسط ${installment} من 3`}</b><small>{expired?'انتهت مهلة السماح، ويعود الوصول بعد اعتماد هذا القسط.':choice==='full'?`الدفعة الكاملة ${money(total,settings)}؛ وبعد اعتمادها يبقى الفصل مفتوحًا دائمًا.`:`مبلغ القسط ${money(amount,settings)}`}</small></div></div>
    <div className="installment-summary"><b>السعر الكامل: {money(total,settings)}</b>{choice==='full'?<span>دفعة واحدة، وبعد مراجعة الوصل يصبح هذا الفصل متاحًا دائمًا.</span>:<><span>المدفوع: {subscription?.installments_paid??0} من 3 · بعد القسط الثالث يصبح الفصل متاحًا دائمًا.</span>{subscription?.next_due_at&&<span>موعد القسط التالي: {new Date(subscription.next_due_at).toLocaleDateString(formatLocale())}، مع مهلة سماح 3 أيام.</span>}</>}</div>
    {pending?<div className="success-message" role="status">{choice==='full'?'وصل طلب سداد الفصل كاملًا، وهو بانتظار مراجعة الأستاذ.':'وصل القسط الحالي قيد مراجعة الأستاذ. سيظهر القسط التالي بعد اعتماده.'}</div>:<>
    <div className="payment-choice-grid" role="group" aria-label="طريقة سداد الفصل"><button type="button" className={choice==='full'?'payment-choice-card selected':'payment-choice-card'} aria-pressed={choice==='full'} disabled={!canChooseFull} onClick={()=>setChoice('full')}><b>سداد كامل</b><strong>{money(total,settings)}</strong><small>{canChooseFull?'دفعة واحدة · وصول دائم بعد الاعتماد':'بدأت التقسيط؛ أكمل الأقساط الثلاثة'}</small></button><button type="button" className={choice==='installment'?'payment-choice-card selected':'payment-choice-card'} aria-pressed={choice==='installment'} onClick={()=>setChoice('installment')}><b>تقسيط على 3 أشهر</b><strong>{money(installmentPrice(total,installment),settings)} × 3</strong><small>الدفعة الحالية {money(installmentPrice(total,installment),settings)}</small></button></div>
    <div className="payment-method-grid"><button type="button" className={method==='bank_of_palestine'?'payment-method-card selected':'payment-method-card'} aria-pressed={method==='bank_of_palestine'} onClick={()=>setMethod('bank_of_palestine')}><span className="payment-method-icon bank-logo-icon"><img src={publicAsset('payments/bank-of-palestine.png')} alt="بنك فلسطين"/></span><b>تحويل بنكي</b><small>بنك فلسطين</small>{method==='bank_of_palestine'&&<CheckCircle2 size={14}/>}</button><button type="button" className={method==='jawwal_pay'?'payment-method-card selected':'payment-method-card'} aria-pressed={method==='jawwal_pay'} onClick={()=>setMethod('jawwal_pay')}><span className="payment-method-icon"><img src={publicAsset('payments/jawwal-pay.png')} alt=""/></span><b>محفظة جوال باي</b><small>Jawwal Pay</small>{method==='jawwal_pay'&&<CheckCircle2 size={14}/>}</button><button type="button" className={method==='palpay'?'payment-method-card selected':'payment-method-card'} aria-pressed={method==='palpay'} onClick={()=>setMethod('palpay')}><span className="payment-method-icon"><img src={publicAsset('payments/palpay.png')} alt=""/></span><b>محفظة PalPay</b><small>PalPay</small>{method==='palpay'&&<CheckCircle2 size={14}/>}</button></div>
    <InstallmentPaymentDetails method={method} settings={settings} semester={semester} installment={installment} amount={amount} choice={choice}/>
    <label className="receipt-dropzone"><span className="upload-icon">↑</span><b>٣. أرفق صورة أو ملف الوصل</b><small>{file?file.name:'JPG أو PNG أو PDF حتى 5 MB'}</small><input type="file" accept="image/jpeg,image/png,application/pdf" required onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
    <div className="checkout-step-title contact-title"><span>٤</span><div><b>بيانات التواصل</b><small>ستصل هذه البيانات للأستاذ مع طلب القسط</small></div></div><div className="payment-contact-grid"><label>اسم الطالب<input value={profile.full_name||String(user.user_metadata?.full_name??'')} readOnly/></label><label>رقم الجوال<input value={profile.whatsapp_number||profile.phone_number} readOnly dir="ltr"/></label></div>
    <button className="button button-dark full-button checkout-submit" disabled={busy||total<=0}>{busy?'جارٍ إرسال الوصل…':`إرسال وصل ${choice==='full'?'الدفعة الكاملة':'القسط · '+money(amount,settings)}`} <ArrowLeft size={16}/></button>
    </>}{notice&&<div className={notice.startsWith('وصل القسط')||notice.startsWith('وصل الدفعة')?'success-message':'form-error'} role="status">{notice}</div>}</form></section></div></div>
}

function InstallmentPaymentDetails({method,settings,semester,installment,amount,choice}:{method:PaymentMethod;settings:Settings;semester:Semester;installment:number;amount:number;choice:PaymentChoice}){
  const rows=method==='jawwal_pay'?[['اسم المستفيد',settings.wallet_holder],['اسم المحفظة','جوال باي'],['رقم المحفظة',settings.wallet_number]]:method==='bank_of_palestine'?[['البنك',settings.bank_name],['اسم صاحب الحساب',settings.bank_account_holder],['رقم الحساب',settings.bank_account_number],['IBAN',settings.bank_iban]]:[['اسم المحفظة','PalPay'],['اسم المستفيد',settings.palpay_holder],['رقم المحفظة',settings.palpay_number]]
  const instructions=method==='jawwal_pay'?settings.wallet_instructions:method==='bank_of_palestine'?settings.bank_instructions:settings.palpay_instructions
  return <section className="wallet-details checkout-wallet"><div className="checkout-step-title"><span>٢</span><div><b>تفاصيل الدفع · {methodName[method]}</b><small>{semesterName(semester)} · {choice==='full'?'دفعة كاملة':`القسط ${installment} من 3`} · {money(amount,settings)}</small></div></div>{rows.map(([label,value])=><div className="wallet-detail-row" key={label}><span>{label}</span><b dir={label==='IBAN'||label.includes('رقم')?'ltr':undefined}>{value||'ستُضاف بيانات الدفع لاحقًا'}</b></div>)}{instructions&&<p className="wallet-instructions">{instructions}</p>}</section>
}

export function StudentSemesterBilling({userId,courseId}:{userId:string;courseId:string}){
  const [subscriptions,setSubscriptions]=useState<Subscription[]>([])
  const [pending,setPending]=useState<string[]>([])
  const [notice,setNotice]=useState('')
  useEffect(()=>{
    let live=true
    async function load(){
      await supabase.rpc('refresh_overdue_semester_subscriptions')
      const [subResult,paymentResult]=await Promise.all([
        supabase.from('semester_subscriptions').select('id,course_id,semester,status,installments_paid,next_due_at,grace_until,completed_at').eq('student_id',userId).eq('course_id',courseId),
        supabase.from('payment_submissions').select('study_plan').eq('student_id',userId).eq('course_id',courseId).eq('status','submitted'),
      ])
      if(!live)return
      if(subResult.error)setNotice(`تعذّر تحميل الاشتراكات: ${subResult.error.message}`)
      setSubscriptions((subResult.data??[]) as Subscription[])
      setPending((paymentResult.data??[]).map(row=>row.study_plan))
    }
    if(courseId)void load()
    return()=>{live=false}
  },[userId,courseId])
  if(!courseId)return null
  const semesters:Semester[]=['semester_one','semester_two']
  return <section className="admin-section semester-billing"><div className="teacher-section-head"><div><h2>اشتراكات الفصلين</h2><p>ادفع كل فصل كاملًا أو على 3 أقساط شهرية. عند التقسيط، تنتهي مهلة السماح بعد 3 أيام من موعد الاستحقاق.</p></div></div><div className="semester-billing-grid">{semesters.map(semester=>{const item=subscriptions.find(row=>row.semester===semester),isPending=pending.includes(semester);const nextDue=item?.next_due_at?new Date(item.next_due_at).toLocaleDateString(formatLocale()):'';return <article className="semester-billing-card" key={semester}><div><b>{semesterName(semester)}</b><span className={item?.status==='completed'?'semester-status complete':item?.status==='suspended'?'semester-status suspended':'semester-status'}>{installmentStatus(item,isPending,Date.now())}</span></div>{item&&item.status!=='completed'&&<small>الأقساط المدفوعة: {item.installments_paid} من 3 {nextDue&&`· الاستحقاق ${nextDue}`} {item.grace_until&&`· آخر مهلة ${new Date(item.grace_until).toLocaleDateString(formatLocale())}`}</small>}{item?.status==='completed'&&<small>تم سداد الفصل كاملًا، والوصول دائم.</small>}<Link className="button button-dark button-small" aria-disabled={isPending||item?.status==='completed'} onClick={event=>{if(isPending||item?.status==='completed')event.preventDefault()}} to={`/payment/${courseId}?plan=${semester}`}>{item?.status==='completed'?'مكتمل':isPending?'بانتظار المراجعة':item?.installments_paid?'ادفع القسط التالي':'ابدأ الاشتراك'}</Link></article>})}</div>{notice&&<div className="form-error">{notice}</div>}</section>
}

export function TeacherSemesterSettings(){
  const [form,setForm]=useState<Settings>(defaults)
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{supabase.from('platform_settings').select('*').eq('id',true).maybeSingle().then(({data,error})=>{if(error)setNotice(`تعذّر تحميل الإعدادات: ${error.message}`);if(data)setForm({...defaults,...data})})},[])
  function update<K extends keyof Settings>(key:K,value:Settings[K]){setForm(old=>({...old,[key]:value}))}
  async function save(event:FormEvent){event.preventDefault();setBusy(true);setNotice('');const {error}=await supabase.from('platform_settings').upsert({id:true,...form,updated_at:new Date().toISOString()});setNotice(error?`تعذّر حفظ الإعدادات: ${error.message}`:'تم حفظ بيانات الدفع وأسعار الفصلين.');setBusy(false)}
  function installmentText(total:number){return total>0?`${money(installmentPrice(total,1),form)} + ${money(installmentPrice(total,2),form)} + ${money(installmentPrice(total,3),form)}`:'حدد السعر لإظهار الأقساط'}
  return <section className="admin-section"><h2>بيانات الدفع وأسعار الفصول</h2><p className="page-lede">حدد السعر الكامل لكل فصل. يمكن للطالب الدفع كاملًا أو على 3 أقساط شهرية؛ يظهر مبلغ كل قسط ويتحدث تلقائيًا عند تغيير السعر.</p><form className="course-form settings-form payment-settings-form" onSubmit={save}>
    <section className="payment-settings-group"><h3>جوال باي</h3><label>اسم المحفظة<input value={form.wallet_provider??'Jawwal Pay'} onChange={event=>update('wallet_provider',event.target.value)}/></label><label>رقم المحفظة<input value={form.wallet_number} onChange={event=>update('wallet_number',event.target.value)}/></label><label>اسم صاحب المحفظة<input value={form.wallet_holder} onChange={event=>update('wallet_holder',event.target.value)}/></label><label>تعليمات التحويل<textarea value={form.wallet_instructions} onChange={event=>update('wallet_instructions',event.target.value)}/></label></section>
    <section className="payment-settings-group"><h3><img src={publicAsset('payments/bank-of-palestine.png')} alt=""/> بنك فلسطين</h3><label>اسم البنك<input value={form.bank_name} onChange={event=>update('bank_name',event.target.value)}/></label><label>اسم صاحب الحساب<input value={form.bank_account_holder} onChange={event=>update('bank_account_holder',event.target.value)}/></label><label>رقم الحساب<input value={form.bank_account_number} onChange={event=>update('bank_account_number',event.target.value)}/></label><label>IBAN<input dir="ltr" value={form.bank_iban} onChange={event=>update('bank_iban',event.target.value)}/></label><label>تعليمات التحويل<textarea value={form.bank_instructions} onChange={event=>update('bank_instructions',event.target.value)}/></label></section>
    <section className="payment-settings-group"><h3>PalPay</h3><label>رقم المحفظة<input value={form.palpay_number} onChange={event=>update('palpay_number',event.target.value)}/></label><label>اسم صاحب المحفظة<input value={form.palpay_holder} onChange={event=>update('palpay_holder',event.target.value)}/></label><label>تعليمات التحويل<textarea value={form.palpay_instructions} onChange={event=>update('palpay_instructions',event.target.value)}/></label></section>
    <section className="payment-settings-group price-settings-group"><h3>الأسعار والأقساط</h3><label>السعر الكامل للفصل الأول<input type="number" min="0" step="0.01" value={form.semester_one_price_cents/100} onChange={event=>update('semester_one_price_cents',Math.round(Number(event.target.value)*100))}/></label><div className="installment-preview"><b>أقساط الفصل الأول</b><span>{installmentText(form.semester_one_price_cents)}</span></div><label>السعر الكامل للفصل الثاني<input type="number" min="0" step="0.01" value={form.semester_two_price_cents/100} onChange={event=>update('semester_two_price_cents',Math.round(Number(event.target.value)*100))}/></label><div className="installment-preview"><b>أقساط الفصل الثاني</b><span>{installmentText(form.semester_two_price_cents)}</span></div><label>العملة<input value={form.price_currency} onChange={event=>update('price_currency',event.target.value.toUpperCase())}/></label></section>
    <button className="button button-dark" disabled={busy}>{busy?'جارٍ الحفظ…':'حفظ الإعدادات'}</button></form>{notice&&<div className={notice.startsWith('تعذّر')?'form-error':'success-message'} role="status">{notice}</div>}</section>
}

