import { FormEvent, ReactNode, useEffect, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, CheckCircle2, ChevronLeft, CircleHelp, Clock3, FileQuestion, GraduationCap, Home as HomeIcon, Languages, Library, LogOut, Megaphone, Menu, MessageCircle, Moon, Play, Plus, Search, Send, Settings, ShieldCheck, Sparkles, Sun, Trash2, Users, Video, Wallet, X } from 'lucide-react'
import { configured, supabase } from '../lib/supabase'
import { appRedirectUrl, publicAsset } from '../lib/publicAsset'
import './portal.css'
import { AllStudentsPanel, StudentExamsPage, StudentLibraryPage, TeacherAnnouncementsPanel, TeacherExamsPanel, TeacherLibraryPanel } from './TeacherTools'
import { AccountControls } from './AccountControls'
import { NotificationsBell, StudentAnnouncements } from './Notifications'
import { SemesterPaymentPage, StudentSemesterBilling, TeacherSemesterSettings } from './SemesterBilling'
import { formatLocale, Language, localizeDom, translateText } from './localization'

type Semester = 'semester_one'|'semester_two'
type StudyPlan = 'semester_one'|'semester_two'|'both'|'monthly'
type Lesson = { id:string; title:string; duration_minutes:number|null; bunny_video_id?:string|null; status?:string; is_preview?:boolean; semester?:Semester }
type Course = { id:string; title:string; description:string; category:string; thumbnail_url:string|null; status?:string; lessons?:Lesson[] }
type SessionUser = { id:string; email?:string; user_metadata?:Record<string,unknown> }
type AuthSession = { access_token:string; user:SessionUser }
type AcademySettings = { academy_name:string; wallet_provider:string; wallet_number:string; wallet_holder:string; wallet_instructions:string; bank_name:string; bank_account_holder:string; bank_account_number:string; bank_iban:string; bank_instructions:string; palpay_number:string; palpay_holder:string; palpay_instructions:string; price_currency:string; semester_one_price_cents:number; semester_two_price_cents:number; both_semesters_price_cents:number; monthly_price_cents:number }
type PaymentMethod = 'jawwal_pay'|'bank_of_palestine'|'palpay'

const demoCourse:Course={id:'starter',title:'اللغة الإنجليزية — التوجيهي الفلسطيني',category:'الصف الثاني عشر · فلسطين',description:'دروس منظمة لمادة اللغة الإنجليزية حسب المنهاج الفلسطيني، مع متابعة الطالب وامتحانات ومراجعة.',thumbnail_url:null,lessons:[{id:'preview-1',title:'الوحدة الأولى · الدرس الأول',duration_minutes:25,is_preview:true},{id:'preview-2',title:'قواعد اللغة الإنجليزية',duration_minutes:30,is_preview:true}]}
const defaultSettings:AcademySettings={academy_name:'Al-Shafie Academy',wallet_provider:'Jawwal Pay',wallet_number:'',wallet_holder:'',wallet_instructions:'',bank_name:'بنك فلسطين',bank_account_holder:'',bank_account_number:'',bank_iban:'',bank_instructions:'',palpay_number:'',palpay_holder:'',palpay_instructions:'',price_currency:'ILS',semester_one_price_cents:15000,semester_two_price_cents:0,both_semesters_price_cents:0,monthly_price_cents:0}
const planLabels:Record<string,string>={semester_one:'الفصل الأول',semester_two:'الفصل الثاني',both:'اشتراك سابق',monthly:'اشتراك سابق'}
const paymentMethodLabels:Record<PaymentMethod,string>={jawwal_pay:'محفظة جوال باي',bank_of_palestine:'تحويل بنكي · بنك فلسطين',palpay:'محفظة PalPay'}
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isUuid=(value:string|undefined):value is string=>Boolean(value&&UUID_PATTERN.test(value))
function getBrowserDeviceId(){const key='alshafie-device-id';try{let value=window.localStorage.getItem(key);if(!value){value=globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}-${Math.random()}`;window.localStorage.setItem(key,value)}return value}catch{return 'unavailable-device-id'}}
function useClock(){const [now,setNow]=useState(()=>new Date());useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(timer)},[]);return now}

export default function App(){
  const [user,setUser]=useState<SessionUser|null>(null),[role,setRole]=useState('student'),[courses,setCourses]=useState<Course[]>([demoCourse]),[coursesLoaded,setCoursesLoaded]=useState(!configured),[busy,setBusy]=useState(false),[error,setError]=useState(''),[menu,setMenu]=useState(false),[profileIncomplete,setProfileIncomplete]=useState(false)
  const [theme,setTheme]=useState<'light'|'dark'>(()=>{try{return window.localStorage.getItem('alshafie-theme')==='light'?'light':'dark'}catch{return 'dark'}})
  const [language,setLanguage]=useState<Language>(()=>{try{return window.localStorage.getItem('alshafie-language')==='en'?'en':'ar'}catch{return 'ar'}})
  const [sidebarHidden,setSidebarHidden]=useState(false)
  const displayedTheme=user?theme:'light'
  const nav=useNavigate()
  useEffect(()=>{document.documentElement.dataset.theme=displayedTheme;try{window.localStorage.setItem('alshafie-theme',theme)}catch{}},[displayedTheme,theme])
  useEffect(()=>{document.documentElement.lang=language;document.documentElement.dir=language==='en'?'ltr':'rtl';try{window.localStorage.setItem('alshafie-language',language)}catch{}},[language])
  useEffect(()=>{
    const root=document.querySelector('.app')
    if(!root)return
    localizeDom(root,language)
    const observer=new MutationObserver(records=>{
      for(const record of records){
        if(record.type==='attributes'||record.type==='characterData')localizeDom(record.target,language)
        else for(const node of Array.from(record.addedNodes))localizeDom(node,language)
      }
    })
    observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['placeholder','title','aria-label']})
    return()=>observer.disconnect()
  },[language])
  async function activateSession(session:AuthSession){
    const {data:claimedRole,error:claimError}=await supabase.rpc('claim_student_device',{p_device_hash:getBrowserDeviceId()})
    if(claimError){await supabase.auth.signOut();setUser(null);setRole('student');setProfileIncomplete(false);setError(claimError.message.includes('تواصل مع الأستاذ')?claimError.message:'تعذّر اعتماد تسجيل الدخول. إذا سبق وسجّلت الخروج، اطلب من الأستاذ إعادة السماح لحسابك.');return false}
    const {data:profile,error:profileError}=await supabase.from('profiles').select('role,whatsapp_number,school_name,governorate,academic_branch').eq('id',session.user.id).maybeSingle()
    if(profileError||!profile){await supabase.auth.signOut();setUser(null);setError('تعذّر تحميل بيانات الحساب. تواصل مع الأستاذ.');return false}
    const sessionRole=String(claimedRole??profile.role??'student')
    setRole(sessionRole)
    setProfileIncomplete(!['teacher','admin'].includes(sessionRole)&&(!profile.whatsapp_number||!profile.school_name||!profile.governorate||!profile.academic_branch))
    setUser(session.user)
    setError('')
    return true
  }
  useEffect(()=>{if(!configured)return;let active=true;const authCallback=new URLSearchParams(window.location.search).has('code')||window.location.hash.includes('access_token=');supabase.auth.getSession().then(async({data})=>{if(!active||!data.session)return;await activateSession(data.session as AuthSession);if(authCallback)nav('/dashboard')});const {data:{subscription}}=supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){setUser(null);setRole('student');setProfileIncomplete(false)}});return()=>{active=false;subscription.unsubscribe()}},[nav])
  useEffect(()=>{if(!configured){setCoursesLoaded(true);return}let active=true;supabase.from('courses').select('id,title,description,category,thumbnail_url,status,lessons(id,title,duration_minutes,bunny_video_id,status,is_preview,semester)').eq('status','published').then(({data})=>{if(!active)return;if(data?.length)setCourses(data as Course[]);setCoursesLoaded(true)});return()=>{active=false}},[])
  useEffect(()=>{if(!user||!configured)return;void supabase.rpc('refresh_overdue_semester_subscriptions')},[user?.id])
  async function auth(e:FormEvent<HTMLFormElement>,mode:'login'|'signup'){
    e.preventDefault();setError('');setBusy(true);const fd=new FormData(e.currentTarget);const email=String(fd.get('email')),password=String(fd.get('password'))
    if(mode==='signup'){
      const metadata={full_name:String(fd.get('full_name')),whatsapp_number:String(fd.get('whatsapp_number')),phone_number:String(fd.get('phone_number')),school_name:String(fd.get('school_name')),governorate:String(fd.get('governorate')),academic_branch:String(fd.get('academic_branch'))}
      const {data,error:signupError}=await supabase.auth.signUp({email,password,options:{data:metadata,emailRedirectTo:appRedirectUrl()}})
      if(signupError)setError(signupError.message);else if(!data.session||!data.user)setError('تم إنشاء الحساب. افحص بريدك لتأكيده، ثم سجّل الدخول.');else if(await activateSession(data.session as AuthSession))nav('/dashboard')
    }else{
      const {data,error:loginError}=await supabase.auth.signInWithPassword({email,password})
      if(loginError)setError(loginError.message);else if(data.session&&await activateSession(data.session as AuthSession))nav('/dashboard')
    }
    setBusy(false)
  }
  async function logout(){await supabase.auth.signOut();document.documentElement.dataset.theme='light';setUser(null);setRole('student');nav('/')}
  function studentRoute(content:ReactNode):ReactNode{if(!user)return <Auth mode="login" onSubmit={auth} error={error} busy={busy}/>;return content}
  return <div className={`${user?'app app-with-sidebar':''}${user&&sidebarHidden?' sidebar-hidden':''}`} dir={language==='en'?'ltr':'rtl'}>{user&&<Sidebar role={role} logout={logout}/>}<div className={user?'app-main authenticated-main':'app-main'}>{user?<div className="utility-bar"><button type="button" className="utility-menu-toggle" aria-label={sidebarHidden?'إظهار القائمة':'إخفاء القائمة'} aria-expanded={!sidebarHidden} title={sidebarHidden?'إظهار القائمة':'إخفاء القائمة'} onClick={()=>setSidebarHidden(hidden=>!hidden)}><Menu size={17}/></button><div className="utility-search"><Search size={14}/><span>ابحث في المنصة</span></div><div className="utility-actions">{role==='student'&&<NotificationsBell user={user}/>}<div className="utility-user"><span>{String(user.user_metadata?.full_name??user.email??'طالب')}</span><span className="avatar">{String(user.user_metadata?.full_name??'ط').slice(0,1)}</span></div></div></div>:<header className="topbar"><Link className="brand" to="/"><span className="brand-icon"><GraduationCap size={20}/></span><span>الشافعي</span></Link><nav className={menu?'nav open':'nav'}><Link to="/courses" onClick={()=>setMenu(false)}>المواد والدروس</Link><a href="/#about" onClick={()=>setMenu(false)}>عن الأكاديمية</a></nav><div className="top-actions"><Link className="login-link" to="/login">تسجيل الدخول</Link><Link className="button button-dark button-small" to="/signup">إنشاء حساب <ArrowLeft size={15}/></Link><button className="icon-button mobile-menu" aria-label="القائمة" onClick={()=>setMenu(!menu)}>{menu?<X/>:<Menu/>}</button></div></header>}
    {!configured&&<div className="setup-banner"><CircleHelp size={15}/> وضع المعاينة · فعّل Supabase لتشغيل الحسابات والدفع.</div>}
    <Routes><Route path="/" element={<Home courses={courses}/>}/><Route path="/courses" element={<CoursePage courses={courses} user={user}/>}/><Route path="/courses/:id" element={<CoursePage courses={courses} user={user}/>}/><Route path="/payment/:courseId" element={user?<SemesterPaymentPage user={user} courses={courses} coursesLoaded={coursesLoaded}/>:<Auth mode="login" onSubmit={auth} error={error} busy={busy}/>}/><Route path="/lesson/:lessonId" element={<LessonPage user={user}/>}/><Route path="/teacher" element={user?<TeacherDashboard user={user}/>:<Auth mode="login" onSubmit={auth} error={error} busy={busy}/>}/><Route path="/library" element={studentRoute(<StudentLibraryPage user={user!}/>)} /><Route path="/exams" element={studentRoute(<StudentExamsPage user={user!}/>)} /><Route path="/settings" element={studentRoute(<StudentSettingsPage user={user!} theme={theme} onThemeChange={setTheme} language={language} onLanguageChange={setLanguage}/>)} /><Route path="/support" element={user?<SupportPage user={user}/>:<Auth mode="login" onSubmit={auth} error={error} busy={busy}/>}/><Route path="/complete-profile" element={user?<CompleteProfile user={user} onComplete={()=>{setProfileIncomplete(false);nav('/dashboard')}}/>:<Auth mode="login" onSubmit={auth} error={error} busy={busy}/>}/><Route path="/login" element={<Auth mode="login" onSubmit={auth} error={error} busy={busy}/>}/><Route path="/signup" element={<Auth mode="signup" onSubmit={auth} error={error} busy={busy}/>}/><Route path="/dashboard" element={user&&profileIncomplete?<CompleteProfile user={user} onComplete={()=>{setProfileIncomplete(false);nav('/dashboard')}}/>:studentRoute(<StudentDashboard user={user!} courses={courses}/>)} /><Route path="*" element={<Home courses={courses}/>}/></Routes>
    <footer><Link className="brand" to="/"><span className="brand-icon"><GraduationCap size={17}/></span><span>الشافعي</span></Link><span>أكاديمية الشافعي · التوجيهي الفلسطيني</span>{user&&<Link to="/support">مركز الدعم</Link>}</footer></div></div>
}


function Sidebar({role,logout}:{role:string;logout:()=>void}){const links:Array<[string,string,typeof HomeIcon]>=['teacher','admin'].includes(role)?[['/teacher',role==='admin'?'لوحة الإدارة':'لوحة الأستاذ',HomeIcon],['/courses','المادة والدروس',Library],['/support','رسائل الدعم',MessageCircle],['/settings','الإعدادات',Settings]]:[['/dashboard','الرئيسية',HomeIcon],['/courses','مادتي الدراسية',BookOpen],['/library','المكتبة',Library],['/exams','اختباراتي',FileQuestion],['/settings','الإعدادات',Settings]];return <aside className="app-sidebar"><Link to="/dashboard" className="sidebar-brand"><span className="brand-icon"><GraduationCap size={20}/></span><b>AL-SHAFIE</b><small>ACADEMY</small></Link><nav>{links.map(([href,label,Icon])=><Link to={href} key={label} className="side-link"><Icon size={15}/><span>{label}</span></Link>)}</nav><button className="side-logout" onClick={logout}><LogOut size={15}/> تسجيل الخروج</button></aside>}

function Home({courses}:{courses:Course[]}){const now=useClock();return <><section className="hero"><div className="hero-copy"><div className="eyebrow"><Sparkles size={14}/> أكاديمية الشافعي · التوجيهي الفلسطيني</div><h1>خطوتك نحو<br/><em>علامة تفرحك.</em></h1><p className="hero-lede">تعلم الإنجليزي للتوجيهي مع أستاذك، بخطة واضحة ودروس مرتبة ومتابعة تساعدك توصل لهدفك.</p><div className="hero-buttons"><Link className="button button-dark" to="/signup">ابدأ التسجيل <ArrowLeft size={17}/></Link><Link className="text-link" to="/courses">تعرّف على المادة <ChevronLeft size={16}/></Link></div><div className="social-proof"><span className="float-icon"><BookOpen size={18}/></span><span><b>منهاج التوجيهي الفلسطيني</b><br/><small>حصص مرتبة · متابعة من الأستاذ</small></span></div></div><div className="hero-art"><div className="sun-disc"/><div className="hero-image academy-preview"><div className="image-label"><span className="live-dot"/> لوحة الطالب</div><h2>أهلًا بعودتك،</h2><div className="preview-name">طالب التوجيهي</div><div className="preview-date"><CalendarDays size={15}/>{now.toLocaleDateString(formatLocale(),{weekday:'long',day:'numeric',month:'long'})}</div><div className="preview-time"><Clock3 size={15}/>{now.toLocaleTimeString(formatLocale(),{hour:'2-digit',minute:'2-digit'})}</div><div className="preview-progress"><span>مادة الإنجليزي</span><b>الفصل الدراسي</b><div><i/></div></div></div><div className="floating-card progress-float"><span className="float-icon"><CheckCircle2 size={18}/></span><span><b>تعلمك منظم</b><small>الدروس بانتظارك</small></span></div><div className="floating-card note-float"><div className="note-top"><span>باقات الاشتراك</span><span>2026</span></div><b>الفصل الأول أو الفصل الثاني، وكل فصل على ثلاث دفعات شهرية</b><small>اختر الباقة المناسبة وأرسل وصل الدفع</small></div></div></section><div className="trust-strip"><span>أكاديمية الشافعي</span><i>منهاج التوجيهي الفلسطيني</i><i>دروس فيديو مرتبة</i><i>دعم مباشر من الأستاذ</i></div><section id="about" className="section method"><div className="section-head"><div><div className="eyebrow">رحلتك الدراسية بخطوات واضحة</div><h2>سجّل، فعّل، وابدأ التعلّم.</h2></div><p>حسابك ودروسك وتقدّمك الدراسي في مكان واحد، حسب الباقة التي اخترتها.</p></div><div className="steps"><article><span className="step-num">01</span><span className="step-icon mint-bg"><GraduationCap/></span><h3>أنشئ حسابك</h3><p>أضف بياناتك ورقم واتساب للتواصل مع الأستاذ.</p></article><article><span className="step-num">02</span><span className="step-icon peach-bg"><Wallet/></span><h3>اختر الباقة وادفع</h3><p>ادفع عبر محفظة جوال باي وأرفق صورة الوصل.</p></article><article><span className="step-num">03</span><span className="step-icon blue-bg"><Play/></span><h3>تابع حصصك</h3><p>بعد اعتماد الوصل يفتح لك الأستاذ دروس الفصل.</p></article></div></section><section className="section course-section"><div className="section-head"><div><div className="eyebrow">المادة المتاحة</div><h2>الإنجليزي · التوجيهي الفلسطيني</h2></div><Link className="text-link" to="/courses">عرض المادة <ArrowLeft size={16}/></Link></div><div className="course-grid">{courses.slice(0,1).map((c,i)=><CourseCard key={c.id} course={c} index={i}/>)}</div></section><section className="bottom-cta"><span className="cta-spark">✳</span><div><div className="eyebrow">ابدأ رحلتك اليوم</div><h2>سجّل حسابك<br/>وتواصل مع الأستاذ.</h2></div><Link className="button button-dark" to="/signup">إنشاء حساب طالب <ArrowLeft size={17}/></Link></section></>}

function CourseCard({course,index}:{course:Course;index:number}){return <Link className="course-card" to={`/courses/${course.id}`}><div className={`course-art course-art-${index%3}`}><span>{course.category}</span><div className="course-art-title">اللغة<br/><i>الإنجليزية</i></div><span className="course-mark">✳</span></div><div className="course-meta"><div><h3>{course.title}</h3><p>{course.description}</p></div><ChevronLeft size={19}/></div><div className="course-foot"><span><Play size={13}/> {course.lessons?.length??0} دروس</span><span><Clock3 size={13}/> مشاهدة آمنة</span></div></Link>}
function CoursePage({courses,user}:{courses:Course[];user:SessionUser|null}) {
  const {id=''}=useParams()
  const nav=useNavigate()
  const course=courses.find(item=>item.id===id)??courses.find(item=>isUuid(item.id))??demoCourse
  const [settings,setSettings]=useState<AcademySettings>(defaultSettings)
  useEffect(()=>{supabase.from('platform_settings').select('*').eq('id',true).maybeSingle().then(({data})=>{if(data)setSettings({...defaultSettings,...data})})},[])
  const plans:StudyPlan[]=['semester_one','semester_two']
  function subscribe(plan:StudyPlan){if(!user){nav('/signup');return}if(!isUuid(course.id))return;nav(`/payment/${course.id}?plan=${plan}`)}
  return <main className="page-main course-detail"><div className="course-detail-layout"><div className="course-detail-main"><section className="course-detail-banner"><img className="course-teacher-photo" src={publicAsset('academy-teacher-portrait.png')} alt="Teacher portrait"/><div className="course-art-copy"><span>مادة · الصف الثاني عشر</span><h1>{course.title}</h1><small>ENGLISH · PALESTINIAN TAWJIHI</small></div><span className="course-art-spark spark-one">✦</span><span className="course-art-spark spark-two">✧</span></section><section className="teacher-summary"><div className="teacher-avatar">ش</div><div><small>مدرس المادة</small><h2>أكاديمية الشافعي</h2><p>شرح ومتابعة لمادة اللغة الإنجليزية · المنهاج الفلسطيني</p></div><span className="teacher-badge">مدرس معتمد</span></section><section className="detail-lessons"><div className="section-heading"><div><small>محتوى المادة</small><h2>دروس اللغة الإنجليزية</h2></div><span>{course.lessons?.length??0} دروس</span></div><p className="page-lede">{course.description}</p><div className="lesson-list">{(course.lessons??[]).map((lesson,index)=><Link className="lesson-row" key={lesson.id} to={'/lesson/'+lesson.id}><span className="lesson-number">{String(index+1).padStart(2,'0')}</span><span><b>{lesson.title}</b><small>{lesson.semester==='semester_two'?'الفصل الثاني':'الفصل الأول'} · {lesson.duration_minutes??10} دقيقة · {lesson.is_preview?'معاينة مجانية':'درس ضمن الاشتراك'}</small></span><Play size={16}/></Link>)}</div></section></div><aside className="package-panel"><div className="package-panel-heading"><div><small>باقات الاشتراك</small><h2>اختر الباقة المناسبة</h2></div><span className="package-current">مادة الإنجليزي</span></div>{plans.map(plan=><article className="package-card" key={plan}><div className="package-card-top"><b>{planLabels[plan]}</b><strong>{priceLabel(plan,settings)}</strong></div><p>ادفع الفصل كاملًا أو قسّمه على 3 دفعات شهرية؛ وبعد اعتماد الدفع يبقى الفصل متاحًا دائمًا.</p><button type="button" className="button button-dark full-button" disabled={Boolean(user&&!isUuid(course.id))} onClick={()=>subscribe(plan)}>{isUuid(course.id)?(user?'اشترك في الباقة':'سجّل واختر الباقة'):'المادة غير متاحة للاشتراك حاليًا'} <ArrowLeft size={14}/></button></article>)}<div className="package-note"><ShieldCheck size={15}/><span>تُفعّل الحصص بعد مراجعة وصل الدفع من الأستاذ.</span></div></aside></div></main>
}

function CompleteProfile({user,onComplete}:{user:SessionUser;onComplete:()=>void}){const [busy,setBusy]=useState(false),[error,setError]=useState(''),[values,setValues]=useState({full_name:String(user.user_metadata?.full_name??user.user_metadata?.name??''),whatsapp_number:'',phone_number:'',school_name:'',governorate:'',academic_branch:''});const nav=useNavigate();useEffect(()=>{let active=true;supabase.from('profiles').select('role,full_name,whatsapp_number,phone_number,school_name,governorate,academic_branch').eq('id',user.id).maybeSingle().then(({data})=>{if(!active)return;if(['teacher','admin'].includes(data?.role??'')||(data?.whatsapp_number&&data?.school_name&&data?.governorate&&data?.academic_branch)){onComplete();return}if(data)setValues(v=>({...v,full_name:data.full_name||v.full_name,whatsapp_number:data.whatsapp_number||'',phone_number:data.phone_number||'',school_name:data.school_name||'',governorate:data.governorate||'',academic_branch:data.academic_branch||''}))});return()=>{active=false}},[user.id]);async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');const form=new FormData(e.currentTarget);const profile={full_name:String(form.get('full_name')).trim(),whatsapp_number:String(form.get('whatsapp_number')).trim(),phone_number:String(form.get('phone_number')).trim(),school_name:String(form.get('school_name')).trim(),governorate:String(form.get('governorate')).trim(),academic_branch:String(form.get('academic_branch')).trim()};const {error:saveError}=await supabase.from('profiles').update(profile).eq('id',user.id);if(saveError)setError('تعذّر حفظ بياناتك: '+saveError.message);else{await supabase.auth.updateUser({data:{full_name:profile.full_name,whatsapp_number:profile.whatsapp_number,phone_number:profile.phone_number,school_name:profile.school_name,governorate:profile.governorate,academic_branch:profile.academic_branch}});onComplete()}setBusy(false)}return <main className="auth-wrap"><div className="auth-card"><span className="auth-mark"><GraduationCap/></span><div className="eyebrow">AL-SHAFIE ACADEMY</div><h1>أكمل بيانات الطالب</h1><p>أضف معلومات التواصل والدراسة حتى يتمكن الأستاذ من متابعة تسجيلك.</p><form onSubmit={submit}><label>الاسم الكامل<input name="full_name" value={values.full_name} onChange={e=>setValues({...values,full_name:e.target.value})} required/></label><label>رقم واتساب<input name="whatsapp_number" type="tel" value={values.whatsapp_number} onChange={e=>setValues({...values,whatsapp_number:e.target.value})} required/></label><label>رقم هاتف إضافي<input name="phone_number" type="tel" value={values.phone_number} onChange={e=>setValues({...values,phone_number:e.target.value})}/></label><label>المدرسة<input name="school_name" value={values.school_name} onChange={e=>setValues({...values,school_name:e.target.value})} required/></label><label>المحافظة<input name="governorate" value={values.governorate} onChange={e=>setValues({...values,governorate:e.target.value})} required/></label><label>الفرع<input name="academic_branch" value={values.academic_branch} onChange={e=>setValues({...values,academic_branch:e.target.value})} required/></label>{error&&<div className="form-error" role="alert">{error}</div>}<button className="button button-dark full-button" disabled={busy}>{busy?'جارٍ الحفظ…':'حفظ ومتابعة'} <ArrowLeft size={16}/></button><button type="button" className="google-auth-button" onClick={async()=>{await supabase.auth.signOut();nav('/')}}>تسجيل الخروج</button></form></div></main>}
function Auth({mode,onSubmit,error,busy}:{mode:'login'|'signup';onSubmit:(e:FormEvent<HTMLFormElement>,mode:'login'|'signup')=>void;error:string;busy:boolean}){const [oauthError,setOauthError]=useState(''),[oauthBusy,setOauthBusy]=useState(false);async function googleSignIn(){setOauthError('');setOauthBusy(true);const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:appRedirectUrl(),queryParams:{prompt:'select_account'}}});if(error){setOauthError('تعذّر بدء تسجيل الدخول عبر Google: '+error.message);setOauthBusy(false)}}return <main className="auth-wrap"><div className="auth-card"><span className="auth-mark"><GraduationCap/></span><div className="eyebrow">AL-SHAFIE ACADEMY</div><h1>{mode==='signup'?'إنشاء حساب طالب':'أهلًا بعودتك'}</h1><p>{mode==='signup'?'أدخل بياناتك بدقة ليتمكن الأستاذ من التواصل معك ومراجعة اشتراكك.':'سجّل الدخول بحسابك لمتابعة دروسك.'}</p><form onSubmit={e=>onSubmit(e,mode)}>{mode==='signup'&&<><label>الاسم الكامل<input name="full_name" placeholder="الاسم كما يظهر في المدرسة" autoComplete="name" required/></label><label>رقم واتساب<input name="whatsapp_number" type="tel" placeholder="05xxxxxxxx" autoComplete="tel" required/></label><label>رقم هاتف إضافي<input name="phone_number" type="tel" placeholder="اختياري"/></label><label>المدرسة<input name="school_name" placeholder="اسم المدرسة" required/></label><label>المحافظة<input name="governorate" placeholder="المحافظة" required/></label><label>الفرع<input name="academic_branch" placeholder="علمي أو أدبي أو غيره" required/></label></>}<label>البريد الإلكتروني<input name="email" type="email" placeholder="name@example.com" autoComplete="email" required/></label><label>كلمة المرور<input name="password" type="password" placeholder="8 أحرف على الأقل" minLength={8} autoComplete={mode==='signup'?'new-password':'current-password'} required/></label>{error&&<div className="form-error" role="alert">{error}</div>}<button className="button button-dark full-button" disabled={busy}>{busy?'يرجى الانتظار…':mode==='signup'?'إنشاء الحساب':'تسجيل الدخول'} <ArrowLeft size={16}/></button></form><div className="auth-divider"><span>أو</span></div><button type="button" className="google-auth-button" onClick={googleSignIn} disabled={oauthBusy}><span className="google-g">G</span>{oauthBusy?'جارٍ التحويل إلى Google…':'المتابعة باستخدام Google'}</button>{oauthError&&<div className="form-error" role="alert">{oauthError}</div>}{mode==='login'&&<button className="forgot" onClick={async()=>{const email=prompt(document.documentElement.lang==='en'?'Enter your account email':'أدخل بريد الحساب');if(email){const {error}=await supabase.auth.resetPasswordForEmail(email);alert(error?.message??document.documentElement.lang==='en'?'Password reset email sent.':'تم إرسال رسالة استعادة كلمة المرور.')}}}>نسيت كلمة المرور؟</button>}<div className="auth-switch">{mode==='signup'?'لديك حساب؟':'طالب جديد؟'} <Link to={mode==='signup'?'/login':'/signup'}>{mode==='signup'?'تسجيل الدخول':'إنشاء حساب'}</Link></div></div></main>}

type StudentProfile={full_name:string;whatsapp_number:string;phone_number:string;school_name:string;governorate:string;academic_branch:string;status:string}

export function PaymentPage({user,courses,coursesLoaded}:{user:SessionUser;courses:Course[];coursesLoaded:boolean}) {
  const {courseId=''}=useParams()
  const nav=useNavigate()
  const course=courses.find(item=>item.id===courseId&&isUuid(item.id))
  const availableCourse=courses.find(item=>isUuid(item.id))
  const [settings,setSettings]=useState<AcademySettings>(defaultSettings)
  const [plan]=useState<StudyPlan>(()=>{const value=new URLSearchParams(window.location.search).get('plan');return value==='semester_two'||value==='both'||value==='monthly'?value:'semester_one'})
  const [method,setMethod]=useState<PaymentMethod>('jawwal_pay')
  const [file,setFile]=useState<File|null>(null)
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const [contact,setContact]=useState({full_name:'',whatsapp_number:'',phone_number:''})
  useEffect(()=>{supabase.from('platform_settings').select('*').eq('id',true).maybeSingle().then(({data})=>{if(data)setSettings({...defaultSettings,...data})});supabase.from('profiles').select('full_name,whatsapp_number,phone_number').eq('id',user.id).single().then(({data})=>{if(data)setContact(data)})},[user.id])
  useEffect(()=>{if(coursesLoaded&&!course&&availableCourse)nav(`/payment/${availableCourse.id}${window.location.search}`,{replace:true})},[coursesLoaded,course?.id,availableCourse?.id,courseId,nav])
  const price=plan==='monthly'?settings.monthly_price_cents:plan==='semester_one'?settings.semester_one_price_cents:plan==='semester_two'?settings.semester_two_price_cents:settings.both_semesters_price_cents
  async function submit(e:FormEvent) {
    e.preventDefault()
    if (!file) return
    if (!course || course.id !== courseId || !isUuid(course.id)) {
      setMessage('لا توجد مادة منشورة صالحة للتسجيل الآن. حدّث الصفحة أو تواصل مع الأستاذ.')
      return
    }
    setBusy(true)
    setMessage('')
    let stage = 'التحقق من الملف'
    let uploadedReceiptPath: string | null = null
    try {
      if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) || file.size > 5 * 1024 * 1024) {
        throw new Error('ارفق صورة JPG أو PNG أو ملف PDF بحجم أقل من 5 MB.')
      }

      stage = 'التحقق من الاشتراك الحالي'
      const { data: existing, error: existingError } = await supabase
        .from('enrollments')
        .select('status,expires_at')
        .eq('student_id', user.id)
        .eq('course_id', course.id)
        .maybeSingle()
      if (existingError) throw existingError

      const hasActiveSubscription = existing?.status === 'approved'
        && (!existing.expires_at || Date.parse(existing.expires_at) > Date.now())
      if (!hasActiveSubscription) {
        stage = 'حفظ طلب تسجيل المادة'
        const enrollment = await supabase.from('enrollments').upsert(
          { student_id: user.id, course_id: course.id, status: 'pending', study_plan: plan },
          { onConflict: 'student_id,course_id' },
        )
        if (enrollment.error) throw enrollment.error
      }

      const path = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      stage = 'رفع الملف إلى مساحة الإيصالات'
      const upload = await supabase.storage.from('receipts').upload(path, file, { contentType: file.type })
      if (upload.error) throw upload.error
      uploadedReceiptPath = path

      stage = 'حفظ سجل وصل الدفع'
      const result = await supabase.from('payment_submissions').insert({
        student_id: user.id,
        course_id: course.id,
        receipt_path: path,
        status: 'submitted',
        study_plan: plan,
        amount_cents: price,
        payment_method: method,
      })
      if (result.error) throw result.error
      uploadedReceiptPath = null
      setMessage('وصل الدفع وصل للأستاذ، وبانتظار المراجعة. تابع حالة الطلب من لوحة الطالب.')
    } catch (err) {
      if (uploadedReceiptPath) {
        try {
          const { error: cleanupError } = await supabase.storage.from('receipts').remove([uploadedReceiptPath])
          if (cleanupError) console.warn('Could not remove an unreferenced payment receipt', cleanupError)
        } catch (cleanupError) {
          console.warn('Could not remove an unreferenced payment receipt', cleanupError)
        }
      }
      const details = err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : err instanceof Error ? err.message : String(err)
      console.error('Payment receipt submission failed', { stage, error: err })
      setMessage(`تعذّر ${stage}: ${details || 'خطأ غير معروف'}`)
    } finally {
      setBusy(false)
    }
  }
  if(!coursesLoaded)return <main className="page-main"><div className="status-card">جارٍ تحميل المادة…</div></main>
  if(!course&&availableCourse)return <main className="page-main"><div className="status-card">جارٍ فتح صفحة الاشتراك الصحيحة…</div></main>
  if(!course)return <main className="page-main"><section className="admin-section payment-unavailable"><h1 className="page-title">التسجيل غير متاح حاليًا</h1><p className="page-lede">لا توجد مادة منشورة صالحة لبدء طلب الدفع. يرجى التواصل مع الأستاذ أو العودة لاحقًا.</p><Link className="button button-dark" to="/courses">العودة للمادة</Link></section></main>
  return <div className="checkout-screen"><div className="checkout-background" aria-hidden="true"><div className="checkout-background-banner"/><div className="checkout-background-card"/><div className="checkout-background-grid"><i/><i/><i/><i/></div></div><div className="checkout-scrim" onMouseDown={event=>{if(event.target===event.currentTarget)nav(`/courses/${course.id}`)}}><section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title"><header className="checkout-header"><Link to={`/courses/${course.id}`} className="checkout-close" aria-label="إغلاق"><X size={17}/></Link><span className="brand-icon"><GraduationCap size={20}/></span><b>AL-SHAFIE ACADEMY</b><small id="checkout-title">تأكيد الاشتراك</small></header><form className="checkout-form" onSubmit={submit}><div className="checkout-step-title"><span>١</span><div><b>اختر طريقة الدفع</b><small>يمكنك اختيار التحويل البنكي أو إحدى المحافظ</small></div></div><div className="payment-method-grid"><button type="button" className={method==='bank_of_palestine'?'payment-method-card selected':'payment-method-card'} aria-pressed={method==='bank_of_palestine'} onClick={()=>setMethod('bank_of_palestine')}><span className="payment-method-icon bank-logo-icon"><img src={publicAsset('payments/bank-of-palestine.png')} alt="بنك فلسطين"/></span><b>تحويل بنكي</b><small>بنك فلسطين</small>{method==='bank_of_palestine'&&<CheckCircle2 size={14}/>}</button><button type="button" className={method==='jawwal_pay'?'payment-method-card selected':'payment-method-card'} aria-pressed={method==='jawwal_pay'} onClick={()=>setMethod('jawwal_pay')}><span className="payment-method-icon"><img src={publicAsset('payments/jawwal-pay.png')} alt=""/></span><b>محفظة جوال باي</b><small>Jawwal Pay</small>{method==='jawwal_pay'&&<CheckCircle2 size={14}/>}</button><button type="button" className={method==='palpay'?'payment-method-card selected':'payment-method-card'} aria-pressed={method==='palpay'} onClick={()=>setMethod('palpay')}><span className="payment-method-icon"><img src={publicAsset('payments/palpay.png')} alt=""/></span><b>محفظة PalPay</b><small>PalPay</small>{method==='palpay'&&<CheckCircle2 size={14}/>}</button></div><PaymentMethodDetails method={method} settings={settings} plan={plan}/><label className="receipt-dropzone"><span className="upload-icon">↑</span><b>٣. أرفق صورة أو ملف الوصل</b><small>{file?file.name:'اضغط لاختيار الملف · JPG أو PNG أو PDF حتى 5 MB'}</small><input type="file" accept="image/jpeg,image/png,application/pdf" required onChange={event=>setFile(event.target.files?.[0]??null)}/></label><div className="checkout-step-title contact-title"><span>٤</span><div><b>بيانات التواصل</b><small>ستصل هذه البيانات للأستاذ مع طلبك</small></div></div><div className="payment-contact-grid"><label>اسم الطالب<input value={contact.full_name||String(user.user_metadata?.full_name??'')} readOnly/></label><label>رقم الجوال<input value={contact.whatsapp_number||contact.phone_number||''} readOnly dir="ltr"/></label></div><button className="button button-dark full-button checkout-submit" disabled={busy}>{busy?'جارٍ إرسال الطلب…':'إرسال طلب الاشتراك'} <ArrowLeft size={16}/></button>{message&&<div className={message.startsWith('وصل الدفع')?'success-message':'form-error'} role="status">{message}</div>}</form></section></div></div>
}
function PaymentMethodDetails({method,settings,plan}:{method:PaymentMethod;settings:AcademySettings;plan:StudyPlan}) {
  const rows=method==='jawwal_pay'?[['اسم المستفيد',settings.wallet_holder],['اسم المحفظة','جوال باي'],['رقم المحفظة',settings.wallet_number]]:method==='bank_of_palestine'?[['البنك',settings.bank_name],['اسم صاحب الحساب',settings.bank_account_holder],['رقم الحساب',settings.bank_account_number],['IBAN',settings.bank_iban]]:[['اسم المحفظة','PalPay'],['اسم المستفيد',settings.palpay_holder],['رقم المحفظة',settings.palpay_number]]
  const instructions=method==='jawwal_pay'?settings.wallet_instructions:method==='bank_of_palestine'?settings.bank_instructions:settings.palpay_instructions
  return <section className="wallet-details checkout-wallet"><div className="checkout-step-title"><span>٢</span><div><b>تفاصيل الدفع · {paymentMethodLabels[method]}</b><small>الباقة: {planLabels[plan]} · {priceLabel(plan,settings)}</small></div></div>{rows.map(([label,value])=><div className="wallet-detail-row" key={label}><span>{label}</span><b dir={label==='IBAN'||label.includes('رقم')?'ltr':undefined}>{value||'ستُضاف بيانات الدفع لاحقًا'}</b></div>)}{instructions&&<p className="wallet-instructions">{instructions}</p>}</section>
}
function priceLabel(plan:StudyPlan,s:AcademySettings){const amount=plan==='monthly'?s.monthly_price_cents:plan==='semester_one'?s.semester_one_price_cents:plan==='semester_two'?s.semester_two_price_cents:s.both_semesters_price_cents;return amount?`${(amount/100).toLocaleString(formatLocale())} ${s.price_currency}`:'السعر يحدده الأستاذ'}

async function edgeFunctionErrorMessage(error:unknown){
  const fallback=error instanceof Error?error.message:String(error)
  if(!error||typeof error!=='object'||!('context'in error))return fallback
  const response=(error as {context?:unknown}).context
  if(!(response instanceof Response))return fallback
  const body=await response.clone().json().catch(()=>null) as {error?:unknown;message?:unknown}|null
  const detail=body?.error??body?.message
  if(typeof detail==='string'){
    if(detail==='Video service is not configured.')return 'خدمة الفيديو غير مكتملة الإعداد. أضف BUNNY_LIBRARY_ID وBUNNY_TOKEN_AUTH_KEY إلى أسرار Edge Functions في Supabase.'
    if(detail==='Lesson unavailable')return 'الدرس غير منشور أو لا يحتوي معرّف فيديو Bunny صالحًا.'
    if(detail==='Invalid Bunny video ID. Use the video GUID only, not a URL.')return 'معرّف Bunny غير صحيح. أدخل GUID الخاص بالفيديو فقط، وليس رابط المشاهدة.'
    return detail
  }
  return fallback
}

function LessonPage({user}:{user:SessionUser|null}) {
  const {lessonId=''}=useParams()
  const [url,setUrl]=useState(''),[message,setMessage]=useState('جارٍ التحقق من صلاحية الحصة…'),[stamp,setStamp]=useState(()=>new Date()),[isPreview,setIsPreview]=useState(false)
  useEffect(()=>{const timer=setInterval(()=>setStamp(new Date()),15000);return()=>clearInterval(timer)},[])
  useEffect(()=>{let active=true;setUrl('');setMessage('جارٍ التحقق من صلاحية الحصة…');void(async()=>{const {data,error}=await supabase.functions.invoke('bunny-playback',{body:{lesson_id:lessonId}});if(!active)return;if(error)setMessage(await edgeFunctionErrorMessage(error));else if(data?.error)setMessage(data.error);else if(data?.embed_url){setUrl(data.embed_url);setIsPreview(Boolean(data.is_preview));setMessage('')}else setMessage('لم تُرجع خدمة الفيديو رابط تشغيل صالحًا.')})();return()=>{active=false}},[lessonId,user?.id])
  const identity=String(user?.user_metadata?.full_name??user?.email??'معاينة مجانية')
  return <main className="page-main"><Link className="text-link" to={user?'/dashboard':'/courses'}><ArrowRight size={16}/> {user?'لوحة الطالب':'العودة للمادة'}</Link><div className="eyebrow" style={{marginTop:30}}>درس التوجيهي</div><h1 className="page-title">حصة اللغة الإنجليزية</h1>{url?<><div className="video-frame" onContextMenu={e=>e.preventDefault()}><iframe src={url} allow="accelerometer; autoplay; encrypted-media" title={isPreview?'فيديو تجريبي مجاني':'درس محمي'}/>{user&&<><div className="video-watermark" aria-hidden="true"><span>{identity}</span><span>{stamp.toLocaleString(formatLocale())}</span></div><div className="video-watermark video-watermark-secondary" aria-hidden="true"><span>{identity}</span><span>{stamp.toLocaleTimeString(formatLocale())}</span></div></>}</div><p className="video-protection-note"><ShieldCheck size={14}/>{isPreview?'هذا فيديو تجريبي مجاني من أكاديمية الشافعي.':'هذا الدرس مخصص لحسابك ويظهر اسم الحساب ووقت المشاهدة للمساعدة في حماية المحتوى.'}</p></>:<><div className="status-card">{message}</div>{!user&&<div className="preview-signin-actions"><Link className="button button-dark button-small" to="/signup">إنشاء حساب</Link><Link className="text-link" to="/login">تسجيل الدخول</Link></div>}<Link className="text-link" to="/courses">عرض باقات الاشتراك</Link></>}</main>
}

function SupportForm({user}:{user:SessionUser}){const [subject,setSubject]=useState(''),[message,setMessage]=useState(''),[notice,setNotice]=useState('');async function submit(e:FormEvent){e.preventDefault();const {error}=await supabase.from('support_messages').insert({student_id:user.id,subject,message});setNotice(error?.message??'وصلت رسالتك للأستاذ.');if(!error){setSubject('');setMessage('')}}return <section className="admin-section support-card"><h2><MessageCircle size={19}/> الدعم الفني</h2><p className="page-lede">للمساعدة في تسجيل الدخول أو الاشتراك، أرسل رسالة للأستاذ.</p><form className="course-form" onSubmit={submit}><label>عنوان الرسالة<input required value={subject} onChange={e=>setSubject(e.target.value)}/></label><label>التفاصيل<textarea required rows={3} value={message} onChange={e=>setMessage(e.target.value)}/></label><button className="button button-dark"><Send size={15}/> إرسال للدعم</button></form>{notice&&<div className="success-message">{notice}</div>}</section>}
function SupportPage({user}:{user:SessionUser}){return <main className="page-main"><div className="eyebrow">نحن هنا لمساعدتك</div><h1 className="page-title">الدعم الفني</h1><SupportForm user={user}/><SupportHistory user={user}/></main>}

function SupportHistory({user}:{user:SessionUser}){const [items,setItems]=useState<{id:string;subject:string;message:string;teacher_reply:string|null;status:string;created_at:string}[]>([]);useEffect(()=>{supabase.from('support_messages').select('id,subject,message,teacher_reply,status,created_at').eq('student_id',user.id).order('created_at',{ascending:false}).then(({data})=>setItems((data??[]) as typeof items))},[user.id]);if(!items.length)return null;return <section className="admin-section"><h2>رسائلي للأستاذ</h2>{items.map(item=><article className="support-message" key={item.id}><b>{item.subject}</b><p>{item.message}</p><small>{item.status==='replied'?'رد الأستاذ:':'بانتظار رد الأستاذ'}</small>{item.teacher_reply&&<p>{item.teacher_reply}</p>}</article>)}</section>}

type PendingPayment={id:string;student_id:string;course_id:string;receipt_path:string;study_plan:StudyPlan;payment_option:'installment'|'full';installment_number:number|null;payment_method:PaymentMethod;amount_cents:number;created_at:string;profiles:{full_name:string;whatsapp_number:string}|null;courses:{title:string}|null}
type TeacherSection = 'payments'|'students'|'announcements'|'videos'|'exams'|'library'|'support'|'settings'

function TeacherDashboard({user}:{user:SessionUser}){
  const [isTeacher,setIsTeacher]=useState<boolean|null>(null),[isOwner,setIsOwner]=useState(false)
  const [payments,setPayments]=useState<PendingPayment[]>([])
  const [courses,setCourses]=useState<Course[]>([])
  const [message,setMessage]=useState('')
  const [activeSection,setActiveSection]=useState<TeacherSection>('payments')
  async function load(){
    const {data:profile}=await supabase.from('profiles').select('role').eq('id',user.id).single()
    setIsTeacher(['teacher','admin'].includes(profile?.role??''));setIsOwner(profile?.role==='teacher')
    if(!['teacher','admin'].includes(profile?.role??''))return
    const [p,c]=await Promise.all([
      supabase.from('payment_submissions').select('id,student_id,course_id,receipt_path,study_plan,payment_option,payment_method,amount_cents,installment_number,created_at,profiles!payment_submissions_student_id_fkey(full_name,whatsapp_number),courses(title)').eq('status','submitted').order('created_at'),
      supabase.from('courses').select('id,title,description,category,thumbnail_url,status,lessons(id,title,duration_minutes)').order('created_at',{ascending:false})
    ])
    if(p.error)setMessage('تعذّر تحميل طلبات الدفع: '+p.error.message)
    setPayments((p.data??[]) as unknown as PendingPayment[])
    setCourses((c.data??[]) as Course[])
  }
  useEffect(()=>{void load()},[user.id])
  async function decide(row:PendingPayment,decision:'approved'|'rejected'){
    setMessage('جارٍ تحديث طلب الدفع…')
    const {data,error}=await supabase.rpc('review_payment_submission',{p_submission_id:row.id,p_decision:decision})
    if(error){setMessage('تعذّر '+(decision==='approved'?'تفعيل':'رفض')+' الطلب: '+error.message);return}
    if(data&&typeof data==='object'&&'error'in data){setMessage('تعذّر تحديث الطلب: '+String(data.error));return}
    setMessage(decision==='approved'?(row.payment_option==='full'?'تم اعتماد الدفعة الكاملة، وأصبح الفصل متاحًا دائمًا.':'تم اعتماد القسط وتحديث اشتراك الطالب.'):'تم رفض طلب الدفع.')
    await load()
  }
  async function viewReceipt(path:string){
    const receiptWindow=window.open('about:blank','_blank')
    const {data,error}=await supabase.storage.from('receipts').createSignedUrl(path,60)
    if(error){receiptWindow?.close();setMessage('تعذّر فتح الوصل: '+error.message)}
    else if(receiptWindow)receiptWindow.location.href=data.signedUrl
    else setMessage('اسمح بالنوافذ المنبثقة لفتح صورة الوصل.')
  }
  if(isTeacher===null)return <main className="page-main"><div className="status-card">جارٍ التحقق من صلاحية الأستاذ…</div></main>
  if(!isTeacher)return <main className="page-main"><h1 className="page-title">هذه الصفحة للأستاذ فقط</h1></main>
  const sections:Array<{id:TeacherSection;label:string;Icon:typeof HomeIcon}>=[
    {id:'payments',label:'وصلات الدفع',Icon:Wallet},
    {id:'students',label:'الطلاب',Icon:Users},
    {id:'announcements',label:'الإعلانات',Icon:Megaphone},
    {id:'videos',label:'الفيديوهات والدروس',Icon:Video},
    {id:'exams',label:'الاختبارات',Icon:FileQuestion},
    {id:'library',label:'الكتب والملفات',Icon:Library},
    {id:'support',label:'الدعم الفني',Icon:MessageCircle},
    {id:'settings',label:'الإعدادات والأسعار',Icon:Settings}
  ]
  return <main className="page-main dashboard teacher-dashboard">
    <div className="eyebrow">مساحة الأستاذ</div>
    <h1 className="page-title">لوحة الأكاديمية</h1>
    <p className="page-lede">كل أداة في قسم مستقل. اختر القسم المطلوب بدل التنقل بين صفحة طويلة.</p>
    <nav className="teacher-dashboard-nav" aria-label="أقسام لوحة الأستاذ">
      {sections.map(({id,label,Icon})=><button type="button" key={id} className={activeSection===id?'teacher-tab active':'teacher-tab'} aria-current={activeSection===id?'page':undefined} onClick={()=>setActiveSection(id)}><Icon size={16}/><span>{label}</span>{id==='payments'&&payments.length>0&&<b>{payments.length}</b>}</button>)}
    </nav>
    {message&&<div className={message.startsWith('تعذّر')?'form-error':'success-message'} role="status">{message}</div>}
    <div className="teacher-dashboard-content" key={activeSection}>
      {activeSection==='payments'&&<section className="admin-section"><h2>وصلات الدفع <span className="muted">{payments.length} بانتظار المراجعة</span></h2>{payments.length?payments.map(row=><div className="admin-row" key={row.id}><div><b>{row.profiles?.full_name||row.student_id.slice(0,8)}</b><small>{row.courses?.title} · {planLabels[row.study_plan]} · {row.payment_option==='full'?'دفعة كاملة':'القسط '+(row.installment_number??1)+'/3'} · {(row.amount_cents/100).toLocaleString(formatLocale())} شيكل · {paymentMethodLabels[row.payment_method]} · واتساب {row.profiles?.whatsapp_number}</small></div><button className="text-button" type="button" onClick={()=>viewReceipt(row.receipt_path)}>عرض صورة الوصل</button><button className="button button-dark button-small" type="button" onClick={()=>decide(row,'approved')}>{row.payment_option==='full'?'اعتماد الدفع الكامل':'اعتماد القسط'}</button><button className="button button-light button-small" type="button" onClick={()=>decide(row,'rejected')}>رفض الطلب</button></div>):<div className="empty-state">لا توجد وصلات بانتظار المراجعة.</div>}</section>}
      {activeSection==='students'&&<AllStudentsPanel canManageRoles={isOwner}/>}
      {activeSection==='announcements'&&<TeacherAnnouncementsPanel userId={user.id}/>}
      {activeSection==='videos'&&<LessonBuilder courses={courses}/>}
      {activeSection==='exams'&&<TeacherExamsPanel courses={courses}/>}
      {activeSection==='library'&&<TeacherLibraryPanel courses={courses}/>}
      {activeSection==='support'&&<TeacherSupportInbox/>}
      {activeSection==='settings'&&<TeacherSemesterSettings/>}
    </div>
  </main>
}
function AcademySettings(){
  const [form,setForm]=useState<AcademySettings>(defaultSettings),[notice,setNotice]=useState('')
  useEffect(()=>{supabase.from('platform_settings').select('*').eq('id',true).maybeSingle().then(({data})=>{if(data)setForm({...defaultSettings,...data})})},[])
  function set<K extends keyof AcademySettings>(key:K,value:AcademySettings[K]){setForm(old=>({...old,[key]:value}))}
  async function save(e:FormEvent){e.preventDefault();const {error}=await supabase.from('platform_settings').upsert({id:true,...form,updated_at:new Date().toISOString()});setNotice(error?.message??'تم حفظ بيانات الدفع والأسعار.')}
  return <section className="admin-section"><h2>بيانات الدفع والأسعار</h2><p className="page-lede">أضف بيانات كل وسيلة؛ ستظهر للطالب عند اختيارها.</p><form className="course-form settings-form payment-settings-form" onSubmit={save}><section className="payment-settings-group"><h3><img src={publicAsset('payments/jawwal-pay.png')} alt=""/> جوال باي</h3><label>اسم المحفظة<input value={form.wallet_provider} onChange={e=>set('wallet_provider',e.target.value)}/></label><label>رقم المحفظة<input value={form.wallet_number} onChange={e=>set('wallet_number',e.target.value)}/></label><label>اسم صاحب المحفظة<input value={form.wallet_holder} onChange={e=>set('wallet_holder',e.target.value)}/></label><label>تعليمات التحويل<textarea value={form.wallet_instructions} onChange={e=>set('wallet_instructions',e.target.value)}/></label></section><section className="payment-settings-group"><h3><img src={publicAsset('payments/bank-of-palestine.png')} alt=""/> بنك فلسطين</h3><label>اسم البنك<input value={form.bank_name} onChange={e=>set('bank_name',e.target.value)}/></label><label>اسم صاحب الحساب<input value={form.bank_account_holder} onChange={e=>set('bank_account_holder',e.target.value)}/></label><label>رقم الحساب<input value={form.bank_account_number} onChange={e=>set('bank_account_number',e.target.value)}/></label><label>IBAN<input dir="ltr" value={form.bank_iban} onChange={e=>set('bank_iban',e.target.value)}/></label><label>تعليمات التحويل<textarea value={form.bank_instructions} onChange={e=>set('bank_instructions',e.target.value)}/></label></section><section className="payment-settings-group"><h3><img src={publicAsset('payments/palpay.png')} alt=""/> PalPay</h3><label>رقم المحفظة<input value={form.palpay_number} onChange={e=>set('palpay_number',e.target.value)}/></label><label>اسم صاحب المحفظة<input value={form.palpay_holder} onChange={e=>set('palpay_holder',e.target.value)}/></label><label>تعليمات التحويل<textarea value={form.palpay_instructions} onChange={e=>set('palpay_instructions',e.target.value)}/></label></section><section className="payment-settings-group price-settings-group"><h3>أسعار الباقات</h3><label>سعر الفصل الأول<input type="number" min="0" step="0.01" value={form.semester_one_price_cents/100} onChange={e=>set('semester_one_price_cents',Math.round(Number(e.target.value)*100))}/></label><label>سعر الفصل الثاني<input type="number" min="0" step="0.01" value={form.semester_two_price_cents/100} onChange={e=>set('semester_two_price_cents',Math.round(Number(e.target.value)*100))}/></label><label>سعر الفصلين معًا<input type="number" min="0" step="0.01" value={form.both_semesters_price_cents/100} onChange={e=>set('both_semesters_price_cents',Math.round(Number(e.target.value)*100))}/></label><label>سعر الاشتراك الشهري<input type="number" min="0" step="0.01" value={form.monthly_price_cents/100} onChange={e=>set('monthly_price_cents',Math.round(Number(e.target.value)*100))}/></label><label>العملة<input value={form.price_currency} onChange={e=>set('price_currency',e.target.value.toUpperCase())}/></label></section><button className="button button-dark">حفظ الإعدادات</button></form>{notice&&<div className="success-message">{notice}</div>}</section>
}


function TeacherSupportInbox(){const [items,setItems]=useState<{id:string;subject:string;message:string;teacher_reply:string|null;status:string;profiles:{full_name:string;whatsapp_number:string}|null}[]>([]),[reply,setReply]=useState<Record<string,string>>({}),[notice,setNotice]=useState('');async function load(){const {data}=await supabase.from('support_messages').select('id,subject,message,teacher_reply,status,profiles(full_name,whatsapp_number)').order('created_at',{ascending:false});setItems((data??[]) as unknown as typeof items)}useEffect(()=>{load()},[]);async function respond(id:string){const {error}=await supabase.from('support_messages').update({teacher_reply:reply[id]??'',status:'replied',replied_at:new Date().toISOString()}).eq('id',id);setNotice(error?.message??'تم إرسال الرد.');if(!error)load()}return <section className="admin-section"><h2>رسائل الدعم</h2>{items.length?items.map(item=><article className="support-message" key={item.id}><b>{item.subject} · {item.profiles?.full_name} · {item.profiles?.whatsapp_number}</b><p>{item.message}</p>{item.teacher_reply&&<small>رد سابق: {item.teacher_reply}</small>}<textarea placeholder="اكتب رد الأستاذ" value={reply[item.id]??''} onChange={e=>setReply({...reply,[item.id]:e.target.value})}/><button className="button button-dark button-small" onClick={()=>respond(item.id)}>إرسال الرد</button></article>):<div className="empty-state">لا توجد رسائل دعم.</div>}{notice&&<div className="success-message">{notice}</div>}</section>}

type TeacherLesson = {id:string;title:string;description:string;bunny_video_id:string|null;duration_minutes:number|null;status:string;is_preview:boolean;semester:string;created_at:string;courses:{title:string}|null}

function LessonBuilder({courses}:{courses:Course[]}){
  const [course,setCourse]=useState('')
  const [semester,setSemester]=useState<Semester>('semester_one')
  const [title,setTitle]=useState('')
  const [description,setDescription]=useState('')
  const [video,setVideo]=useState('')
  const [duration,setDuration]=useState('')
  const [isPreview,setIsPreview]=useState(false)
  const [notice,setNotice]=useState('')
  const [lessons,setLessons]=useState<TeacherLesson[]>([])
  const [search,setSearch]=useState('')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{if(!course&&courses[0])setCourse(courses[0].id)},[course,courses])
  async function load(){
    const {data,error}=await supabase.from('lessons').select('id,title,description,bunny_video_id,duration_minutes,status,is_preview,semester,created_at,courses(title)').order('created_at',{ascending:false})
    if(error)setNotice('تعذّر تحميل الدروس: '+error.message)
    else setLessons((data??[]) as unknown as TeacherLesson[])
  }
  useEffect(()=>{void load()},[])
  async function submit(e:FormEvent){
    e.preventDefault()
    setBusy(true)
    setNotice('')
    const {error}=await supabase.from('lessons').insert({course_id:course,semester,title:title.trim(),description:description.trim(),bunny_video_id:video.trim()||null,duration_minutes:duration?Number(duration):null,status:'published',is_preview:isPreview})
    if(error)setNotice('تعذّرت إضافة الدرس: '+error.message)
    else{setTitle('');setDescription('');setVideo('');setDuration('');setIsPreview(false);setNotice('تمت إضافة الدرس.');await load()}
    setBusy(false)
  }
  async function removeLesson(lesson:TeacherLesson){
    const confirmed=window.confirm(translateText('حذف الدرس «'+lesson.title+'» من المنصة؟ سيُحذف معه تقدّم الطلاب وملفاته المرتبطة. سيبقى الفيديو الأصلي في Bunny Stream، ويمكن حذفه من هناك يدويًا.',document.documentElement.lang==='en'?'en':'ar'))
    if(!confirmed)return
    const {error}=await supabase.from('lessons').delete().eq('id',lesson.id)
    if(error){setNotice('تعذّر حذف الدرس: '+error.message);return}
    setNotice('تم حذف الدرس من المنصة. الفيديو الأصلي ما زال في Bunny Stream.')
    await load()
  }
  const filteredLessons=lessons.filter(lesson=>(lesson.title+' '+lesson.description).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  return <section className="admin-section teacher-videos">
    <div className="teacher-section-head"><div><h2>الفيديوهات والدروس</h2><p>أضف درسًا جديدًا أو ابحث عن درس واحذفه من المنصة.</p></div><span className="teacher-count">{lessons.length} درس</span></div>
    <form className="course-form" onSubmit={submit}>
      {courses.length===1?<div className="readonly-course"><small>المادة</small><b>{courses[0].title}</b></div>:<label>المادة<select required value={course} onChange={e=>setCourse(e.target.value)}><option value="">اختر المادة</option>{courses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>}
      <label>الفصل الدراسي<select value={semester} onChange={e=>setSemester(e.target.value as Semester)}><option value="semester_one">الفصل الأول</option><option value="semester_two">الفصل الثاني</option></select></label>
      <label>عنوان الدرس<input required value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label>وصف الدرس<input value={description} onChange={e=>setDescription(e.target.value)}/></label>
      <label>معرّف فيديو Bunny<input required value={video} onChange={e=>setVideo(e.target.value)}/><small>أدخل GUID الخاص بالفيديو فقط، وليس رابط المشاهدة.</small></label>
      <label>مدة الدرس بالدقائق<input type="number" min="1" value={duration} onChange={e=>setDuration(e.target.value)}/></label>
      <label className="preview-checkbox"><input type="checkbox" checked={isPreview} onChange={e=>setIsPreview(e.target.checked)}/> إتاحة هذا الفيديو مجانًا كمعاينة قبل التسجيل والاشتراك</label>
      <button className="button button-dark" disabled={busy||!course}>{busy?'جارٍ الحفظ…':<><Plus size={15}/> إضافة الدرس</>}</button>
    </form>
    {lessons.length>0&&<label className="teacher-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث عن درس أو وصفه"/></label>}
    {filteredLessons.length?<div className="exam-admin-list lesson-admin-list">{filteredLessons.map(lesson=><article className="exam-admin-row" key={lesson.id}><div><b><Play size={14}/>{lesson.title}</b><small>{lesson.courses?.title||'اللغة الإنجليزية'} · {lesson.duration_minutes||'—'} دقيقة · {lesson.is_preview?'معاينة مجانية':'ضمن الاشتراك'} · {lesson.status==='published'?'منشور':'مسودة'}</small></div><button type="button" className="button button-light button-small delete-action" onClick={()=>removeLesson(lesson)}><Trash2 size={14}/> حذف الدرس</button></article>)}</div>:<div className="empty-state">{lessons.length?'لا توجد دروس تطابق البحث.':'لم تتم إضافة دروس بعد.'}</div>}
    {notice&&<div className={notice.startsWith('تعذّر')||notice.startsWith('تعذّرت')?'form-error':'success-message'} role="status">{notice}</div>}
  </section>
}
function PortalDashboard({user,courses}:{user:SessionUser;courses:Course[]}){const now=useClock(),[profile,setProfile]=useState<StudentProfile|null>(null),[enrolled,setEnrolled]=useState<{course_id:string;status:string;study_plan:string;expires_at:string|null;courses:{title:string}|null}[]>([]);useEffect(()=>{supabase.from('profiles').select('full_name,whatsapp_number,phone_number,school_name,governorate,academic_branch,status').eq('id',user.id).single().then(({data})=>setProfile(data as StudentProfile|null));supabase.from('semester_subscriptions').select('course_id,status,semester,grace_until,courses(title)').eq('student_id',user.id).then(({data})=>setEnrolled((data??[]).map(item=>{const active=item.status==='completed'||(item.status==='active'&&(!item.grace_until||Date.parse(item.grace_until)>Date.now()));return {course_id:item.course_id,status:active?'approved':item.status==='active'?'suspended':item.status,study_plan:item.semester,expires_at:item.status==='active'?item.grace_until:null,courses:item.courses}}) as unknown as typeof enrolled))},[user.id]);const statusCopy:Record<string,[string,string]>={pending_payment:['حسابك جاهز لاختيار الباقة','اختر الفصل الدراسي وأرسل وصل الدفع عبر جوال باي.'],payment_submitted:['وصل الدفع قيد المراجعة','سيراجع الأستاذ الوصل ويعتمد اشتراكك قريبًا.'],approved:['تم تفعيل اشتراكك','افتح المادة وابدأ متابعة دروسك.'],rejected:['يحتاج الوصل إلى مراجعة','تواصل مع الأستاذ أو أرسل وصلًا واضحًا.'],suspended:['الحساب موقوف مؤقتًا','تواصل مع الأستاذ عبر الدعم الفني.']};const [heading,subheading]=statusCopy[profile?.status??'pending_payment']??statusCopy.pending_payment;const approved=enrolled.filter(item=>item.status==='approved'&&(!item.expires_at||Date.parse(item.expires_at)>now.getTime()));const name=profile?.full_name||String(user.user_metadata?.full_name??'طالب'),paymentCourse=courses.find(item=>isUuid(item.id));return <main className="portal-dashboard"><section className="portal-banner"><div><div className="portal-kicker">أكاديمية الشافعي · التوجيهي الفلسطيني</div><h1>مسا الخير، {name} <span>👋</span></h1><p>{now.toLocaleDateString(formatLocale(),{weekday:'long',day:'numeric',month:'long',year:'numeric'})}<b> · </b>{now.toLocaleTimeString(formatLocale(),{hour:'2-digit',minute:'2-digit'})}</p></div><div className="paper-plane"><Send size={42}/></div><span className="dotted-path">〰〰〰</span><span className="portal-mascot">📚</span></section><StudentAnnouncements userId={user.id}/><section className="portal-metrics"><article><span>حصصي المفعّلة</span><b>{approved.length}</b><small>مادة جاهزة للدراسة</small><i/></article><article><span>دروسي المكتملة</span><b>0</b><small>كل خطوة تقرّبك لهدفك</small><i/></article><article><span>اختباراتي</span><b>0</b><small>اختبارات بانتظارك</small><i/></article></section><section className="portal-progress"><div className="portal-section-title"><div><small>متابعة خطتك</small><h2>تقدّمك الدراسي</h2></div><strong>0%</strong></div><div className="progress-landscape"><span className="progress-mascot">🌱</span><div><b>{heading}</b><small>{subheading}</small></div><div className="progress-circle">0%</div></div><div className="progress-caption"><span>{approved.length} اشتراك مفعّل</span><span>{courses[0]?.lessons?.length??0} دروس في المادة</span></div></section><section id="subjects" className="portal-subjects"><div className="portal-section-title"><div><small>خطة دراستك</small><h2>مادتي الدراسية</h2></div><Link to="/courses">استكشف المادة <ArrowLeft size={14}/></Link></div>{approved.length?courses.filter(c=>approved.some(e=>e.course_id===c.id)).map((c,i)=><CourseCard key={c.id} course={c} index={i}/>):<div className="portal-empty"><span>📘</span><b>{enrolled.length?'اشتراكك بانتظار موافقة الأستاذ':'ما في اشتراك مفعّل لسه'}</b><small>{enrolled.length?'راح تظهر المادة هون بعد اعتماد وصل الدفع.':'اختار مادة الإنجليزي وباقة الفصل لحتى تبدأ.'}</small><Link className="button button-dark button-small" to={paymentCourse?`/payment/${paymentCourse.id}`:'/courses'}>{enrolled.length?'تفاصيل الاشتراك':'اختيار الباقة'} <ArrowLeft size={14}/></Link></div>}</section><div className="portal-lower"><section id="library" className="portal-small-panel"><h2><Library size={17}/> مكتبتي</h2><p>ملخصات ومواد المقرر تظهر هنا بعد تفعيل الاشتراك.</p></section><section id="exams" className="portal-small-panel"><h2><FileQuestion size={17}/> اختباراتي</h2><p>ستظهر الاختبارات والنتائج في هذا القسم.</p></section></div><section className="portal-account"><div className="portal-section-title"><div><small>ملف الطالب</small><h2>بيانات التواصل</h2></div><Link to="/support">تعديل البيانات عبر الدعم</Link></div><div className="portal-account-grid"><span>واتساب<b>{profile?.whatsapp_number||'—'}</b></span><span>المدرسة<b>{profile?.school_name||'—'}</b></span><span>المحافظة<b>{profile?.governorate||'—'}</b></span><span>الفرع<b>{profile?.academic_branch||'—'}</b></span></div></section><SupportForm user={user}/><SupportHistory user={user}/></main>}



function StudentSettingsPage({user,theme,onThemeChange,language,onLanguageChange}:{user:SessionUser;theme:'light'|'dark';onThemeChange:(theme:'light'|'dark')=>void;language:Language;onLanguageChange:(language:Language)=>void}){const [profile,setProfile]=useState<StudentProfile|null>(null);useEffect(()=>{supabase.from('profiles').select('full_name,whatsapp_number,phone_number,school_name,governorate,academic_branch,status').eq('id',user.id).single().then(({data})=>setProfile(data as StudentProfile|null))},[user.id]);return <main className="page-main"><div className="eyebrow">إعدادات الحساب</div><h1 className="page-title">حسابي الشخصي</h1><div className="settings-preferences-grid"><section className="appearance-settings"><div className="appearance-settings-copy"><span className="appearance-settings-icon">{theme==='dark'?<Moon size={20}/>:<Sun size={20}/>}</span><div><h2>مظهر المنصة</h2><p>{theme==='dark'?'الوضع الداكن مفعّل. يُحفظ اختيارك على هذا الجهاز.':'الوضع الفاتح مفعّل. يمكنك تفعيل الداكن من الزر.'}</p></div></div><button type="button" className={`theme-toggle${theme==='dark'?' is-on':''}`} role="switch" aria-checked={theme==='dark'} aria-label={theme==='dark'?'تعطيل الوضع الداكن':'تفعيل الوضع الداكن'} onClick={()=>onThemeChange(theme==='dark'?'light':'dark')}><span/></button></section><section className="appearance-settings language-settings"><div className="appearance-settings-copy"><span className="appearance-settings-icon"><Languages size={20}/></span><div><h2>لغة المنصة</h2><p>اختر لغة المنصة.</p></div></div><div className="language-choice" role="group" aria-label="تبديل اللغة" data-no-translate><button type="button" className={language==='ar'?'selected':''} aria-pressed={language==='ar'} onClick={()=>onLanguageChange('ar')}>العربية</button><button type="button" className={language==='en'?'selected':''} aria-pressed={language==='en'} onClick={()=>onLanguageChange('en')}>English</button></div></section></div><section className="portal-account"><div className="portal-account-grid"><span>الاسم الكامل<b>{profile?.full_name||'—'}</b></span><span>واتساب<b>{profile?.whatsapp_number||'—'}</b></span><span>رقم الهاتف<b>{profile?.phone_number||'—'}</b></span><span>المدرسة<b>{profile?.school_name||'—'}</b></span><span>المحافظة<b>{profile?.governorate||'—'}</b></span><span>الفرع<b>{profile?.academic_branch||'—'}</b></span><span>حالة الحساب<b>{profile?.status||'—'}</b></span></div></section><AccountControls user={user}/></main>}

function StudentDashboard({user,courses}:{user:SessionUser;courses:Course[]}){const courseId=courses.find(course=>isUuid(course.id))?.id??'';return <><StudentSemesterBilling userId={user.id} courseId={courseId}/><PortalDashboard user={user} courses={courses}/></>} 

