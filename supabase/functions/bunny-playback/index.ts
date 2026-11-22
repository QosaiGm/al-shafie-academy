import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
function sessionIdFromAuthorization(value: string | null) {
  try {
    const payload = value?.replace(/^Bearer\s+/i, '').split('.')[1]
    if (!payload) return null
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/')
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
    return (JSON.parse(decoded).session_id as string | undefined) ?? null
  } catch { return null }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let body: { lesson_id?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }
  const { lesson_id } = body
  if (typeof lesson_id !== 'string') return json({ error: 'Invalid lesson identifier' }, 400)

  const { data: lesson } = await db.from('lessons')
    .select('id,course_id,semester,bunny_video_id,status,is_preview')
    .eq('id', lesson_id).maybeSingle()
  if (!lesson || lesson.status !== 'published' || !lesson.bunny_video_id) return json({ error: 'Lesson unavailable' }, 404)
  const videoId = lesson.bunny_video_id.trim()
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(videoId)) {
    return json({ error: 'Invalid Bunny video ID. Use the video GUID only, not a URL.' }, 422)
  }

  let user: { id: string } | null = null
  const authorization = req.headers.get('Authorization')
  if (authorization) {
    const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data, error } = await caller.auth.getUser()
    if (!error && data.user) user = data.user
  }

  // Preview videos are intentionally available before signup; paid lessons
  // still require a real, approved student session and active enrollment.
  if (!lesson.is_preview) {
    if (!user) return json({ error: 'سجّل الدخول واشترك لمشاهدة هذا الدرس.' }, 401)
    const [{ data: profile }, { data: subscription }, { data: device }] = await Promise.all([
      db.from('profiles').select('role,status').eq('id', user.id).maybeSingle(),
      db.from('semester_subscriptions').select('status,installments_paid,grace_until').eq('student_id', user.id).eq('course_id', lesson.course_id).eq('semester', lesson.semester).maybeSingle(),
      db.from('device_registrations').select('session_id').eq('student_id', user.id).maybeSingle(),
    ])
    if (!profile) return json({ error: 'Student profile not found.' }, 403)
    if (!['teacher', 'admin'].includes(profile.role)) {
      if (!device?.session_id || device.session_id !== sessionIdFromAuthorization(authorization)) return json({ error: 'تواصل مع الأستاذ لإعادة السماح بتسجيل الدخول.' }, 403)
      if (profile.status !== 'approved') return json({ error: 'حسابك بانتظار موافقة الأستاذ.' }, 403)
      if (!subscription) return json({ error: 'سجّل واشترك في هذا الفصل لمشاهدة الدرس.' }, 403)
      const fullyPaid = subscription.status === 'completed' && subscription.installments_paid === 3
      const withinGrace = subscription.status === 'active' && subscription.installments_paid > 0 && subscription.grace_until && Date.parse(subscription.grace_until) >= Date.now()
      const { data: submittedInstallment } = !fullyPaid && subscription.installments_paid < 3 && subscription.grace_until
        ? await db.from('payment_submissions').select('id').eq('student_id', user.id).eq('course_id', lesson.course_id).eq('study_plan', lesson.semester).eq('installment_number', subscription.installments_paid + 1).eq('status', 'submitted').lte('created_at', subscription.grace_until).limit(1).maybeSingle()
        : { data: null }
      if (!fullyPaid && !withinGrace && !submittedInstallment) return json({ error: 'توقف الوصول لهذا الفصل لانتهاء مهلة القسط. أرسل الوصل وانتظر مراجعة الأستاذ.' }, 403)
    }
  }

  const libraryId = Deno.env.get('BUNNY_LIBRARY_ID')
  const tokenKey = Deno.env.get('BUNNY_TOKEN_AUTH_KEY')
  if (!libraryId || !tokenKey) return json({ error: 'Video service is not configured.' }, 503)
  const expiration = Math.floor(Date.now() / 1000) + 300
  const token = await sha256Hex(`${tokenKey}${videoId}${expiration}`)
  return json({
    embed_url: `https://player.mediadelivery.net/embed/${libraryId}/${videoId}?token=${token}&expires=${expiration}`,
    expires_at: expiration,
    is_preview: Boolean(lesson.is_preview),
  })
})

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
