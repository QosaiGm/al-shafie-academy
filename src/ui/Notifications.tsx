import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BookOpen, FileQuestion, Megaphone, Video } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatLocale } from './localization'

type FeedKind='lesson'|'exam'|'book'|'announcement'
type FeedItem={id:string;kind:FeedKind;title:string;body:string;created_at:string;target:string}
type Announcement={id:string;title:string;body:string;created_at:string}
type FeedRow={id:string;title:string;body?:string|null;created_at:string}

function initialSeenAt(userId:string){
  const key=`alshafie-notifications-seen-${userId}`
  try{const saved=window.localStorage.getItem(key);if(saved)return saved;const initial=new Date(Date.now()-24*60*60*1000).toISOString();window.localStorage.setItem(key,initial);return initial}catch{return new Date(Date.now()-24*60*60*1000).toISOString()}
}

export function NotificationsBell({user}:{user:{id:string}}){
  const navigate=useNavigate(),root=useRef<HTMLDivElement>(null)
  const [open,setOpen]=useState(false),[items,setItems]=useState<FeedItem[]>([]),[unread,setUnread]=useState(0),[seenAt,setSeenAt]=useState(()=>initialSeenAt(user.id)),[loading,setLoading]=useState(false)
  useEffect(()=>{setSeenAt(initialSeenAt(user.id))},[user.id])
  const refresh=useCallback(async()=>{
    setLoading(true)
    const cutoff=new Date(Date.now()-30*24*60*60*1000).toISOString()
    const [lessons,exams,books,announcements]=await Promise.all([
      supabase.from('lessons').select('id,title,created_at').eq('status','published').gte('created_at',cutoff).order('created_at',{ascending:false}).limit(12),
      supabase.from('exams').select('id,title,created_at').eq('published',true).gte('created_at',cutoff).order('created_at',{ascending:false}).limit(12),
      supabase.from('course_library_resources').select('id,title,created_at').gte('created_at',cutoff).order('created_at',{ascending:false}).limit(12),
      supabase.from('academy_announcements').select('id,title,body,created_at').eq('published',true).gte('created_at',cutoff).order('created_at',{ascending:false}).limit(12)
    ])
    const lessonItems=((lessons.data??[]) as FeedRow[]).map(row=>({id:`lesson-${row.id}`,kind:'lesson' as const,title:row.title,body:'تم رفع درس جديد',created_at:row.created_at,target:`/lesson/${row.id}`}))
    const examItems=((exams.data??[]) as FeedRow[]).map(row=>({id:`exam-${row.id}`,kind:'exam' as const,title:row.title,body:'تم نشر اختبار جديد',created_at:row.created_at,target:'/exams'}))
    const bookItems=((books.data??[]) as FeedRow[]).map(row=>({id:`book-${row.id}`,kind:'book' as const,title:row.title,body:'تمت إضافة كتاب أو ملف دراسي',created_at:row.created_at,target:'/library'}))
    const announcementItems=((announcements.data??[]) as FeedRow[]).map(row=>({id:`announcement-${row.id}`,kind:'announcement' as const,title:row.title,body:row.body||'إعلان جديد من الأستاذ',created_at:row.created_at,target:'/dashboard'}))
    const all=[...lessonItems,...examItems,...bookItems,...announcementItems].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,20)
    setItems(all)
    setUnread(all.filter(item=>Date.parse(item.created_at)>Date.parse(seenAt)).length)
    setLoading(false)
  },[seenAt])
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),45000);return()=>window.clearInterval(timer)},[refresh,user.id])
  useEffect(()=>{if(!open)return;const closeOutside=(event:PointerEvent)=>{if(root.current&&!root.current.contains(event.target as Node))setOpen(false)};document.addEventListener('pointerdown',closeOutside);return()=>document.removeEventListener('pointerdown',closeOutside)},[open])
  function toggle(){
    if(open){setOpen(false);return}
    setOpen(true)
    void refresh().then(()=>{
      const nextSeen=new Date().toISOString()
      try{window.localStorage.setItem(`alshafie-notifications-seen-${user.id}`,nextSeen)}catch{}
      setSeenAt(nextSeen);setUnread(0)
    })
  }
  function visit(item:FeedItem){
    setOpen(false)
    if(item.kind==='announcement'){
      navigate('/dashboard')
      window.setTimeout(()=>document.getElementById('announcements')?.scrollIntoView({behavior:'smooth',block:'center'}),120)
    }else navigate(item.target)
  }
  return <div className="notifications-root" ref={root}>
    <button type="button" className="notifications-trigger" aria-label="الإشعارات" aria-expanded={open} title="الإشعارات" onClick={toggle}>
      <Bell size={17}/>{unread>0&&<span className="notification-count">{unread>9?'9+':unread}</span>}
    </button>
    {open&&<section className="notification-popover" aria-label="الإشعارات الأخيرة"><header><div><b>الإشعارات</b><small>الدروس والاختبارات والملفات والإعلانات الجديدة</small></div><span>{unread>0?`${unread} جديد`:'محدّث'}</span></header>{loading&&!items.length?<p className="notification-empty">جارٍ تحميل الإشعارات…</p>:items.length?<div className="notification-list">{items.map(item=>{const Icon=item.kind==='lesson'?Video:item.kind==='exam'?FileQuestion:item.kind==='book'?BookOpen:Megaphone;return <button type="button" className={`notification-item${Date.parse(item.created_at)>Date.parse(seenAt)?' is-unread':''}`} key={item.id} onClick={()=>visit(item)}><span className="notification-icon"><Icon size={16}/></span><span className="notification-copy"><b>{item.title}</b><small>{item.body}</small><time>{new Date(item.created_at).toLocaleString(formatLocale(),{dateStyle:'short',timeStyle:'short'})}</time></span></button>})}</div>:<p className="notification-empty">لا توجد تحديثات جديدة حاليًا.</p>}</section>}
  </div>
}

export function StudentAnnouncements({userId}:{userId:string}){
  const [items,setItems]=useState<Announcement[]>([])
  const refresh=useCallback(async()=>{const {data}=await supabase.from('academy_announcements').select('id,title,body,created_at').eq('published',true).order('created_at',{ascending:false}).limit(5);setItems((data??[]) as Announcement[])},[])
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),60000);return()=>window.clearInterval(timer)},[refresh,userId])
  return <section className="announcements-panel" id="announcements"><div className="announcement-heading"><div><span className="announcement-heading-icon"><Megaphone size={17}/></span><div><small>آخر التحديثات</small><h2>الإعلانات</h2></div></div><span>{items.length} إعلان</span></div>{items.length?<div className="student-announcement-list">{items.map(item=><article className="student-announcement" key={item.id}><div><b>{item.title}</b><time>{new Date(item.created_at).toLocaleString(formatLocale(),{dateStyle:'medium',timeStyle:'short'})}</time></div><p>{item.body}</p></article>)}</div>:<p className="announcements-empty">ما في إعلانات جديدة حاليًا. راجع هذا القسم لأي تحديث من الأستاذ.</p>}</section>
}
