const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
const missing = required.filter((name) => !process.env[name]?.trim())

if (missing.length) {
  console.error(`Missing required build environment variables: ${missing.join(', ')}`)
  process.exit(1)
}
