# Al-Shafie Academy

Arabic-first learning platform for Al-Shafie Academy's Palestinian Tawjihi English course. The site is built with React, TypeScript and Vite. Supabase provides authentication, database, storage and Edge Functions; Bunny Stream serves protected lessons.

## Run locally

1. Install Node.js 22.13.0 or newer and pnpm.
2. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Run `pnpm install` and `pnpm dev`.
4. Open the local URL printed by Vite.

`pnpm build` runs the TypeScript check and creates the production site in `dist/`.

## Publish with GitHub Pages

The public repository deploys the Vite app from `main` with the workflow in `.github/workflows/deploy-pages.yml`. The site URL is `https://qosaigm.github.io/al-shafie-academy/`.

In repository **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**. In **Settings → Secrets and variables → Actions**, add these repository secrets using the values from Supabase Project Settings → API:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (the public anon/publishable key, never the service-role key)

The workflow uses Node.js 22.13.0 to satisfy the repository's pinned pnpm version, installs from `pnpm-lock.yaml`, builds `dist/`, and deploys it. Each push to `main` triggers a new GitHub Pages deployment.

## Finish site configuration

After the first deployment, configure each site URL before inviting students:

1. In Supabase Authentication → URL Configuration, set the Site URL to `https://qosaigm.github.io/al-shafie-academy/` and add `https://qosaigm.github.io/al-shafie-academy/**` to Redirect URLs. Keep localhost entries only for development.
2. In Google Cloud Console, add `https://qosaigm.github.io` to the OAuth client's authorized JavaScript origins. Keep the Supabase callback URL as its authorized redirect URI.
3. Add `qosaigm.github.io` to Bunny Stream's allowed referrers for the video library.
4. Confirm the Supabase database has the current migrations, especially `202611200002_semester_installments.sql` and `202611200003_full_semester_payment.sql`. The latter supports either paying the whole semester at once or paying it in three installments. Each semester is subscribed to separately.
5. Confirm the required Supabase Edge Functions are deployed and their private Bunny credentials are configured in Supabase Function Secrets. Never put the Bunny token key, Supabase service-role key, OAuth client secret or SMTP credentials in `VITE_*` variables.
6. Run a live acceptance pass on the deployed URL: email and Google sign-in, first-device approval and teacher reset, test receipt submission and teacher review, second-semester access separation, installment handling, lesson playback, exams, library, announcements and account deletion controls. The current payment flow is for testing only.

This repository is public. Do not commit `.env`, Supabase service-role keys, Bunny token keys, OAuth client secrets, or SMTP credentials. The frontend Supabase anon key is a public client key and will be present in the built JavaScript; database access must remain protected by Supabase Row Level Security policies and Edge Functions.

## Supabase and Bunny

Database migrations are in `supabase/migrations/`; Edge Functions are in `supabase/functions/`. Apply migrations only in order and only after checking which are already installed in the live database. Do not paste TypeScript or Edge Function source into Supabase SQL Editor.

Set Bunny library credentials only as Supabase Edge Function secrets. The client stores only the Bunny video ID; the `bunny-playback` function checks the signed-in student's access and returns a short-lived playback URL.
