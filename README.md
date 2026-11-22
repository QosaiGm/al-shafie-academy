# Al-Shafie Academy

Arabic-first learning platform for Al-Shafie Academy's Palestinian Tawjihi English course. The site is built with React, TypeScript and Vite. Supabase provides authentication, database, storage and Edge Functions; Bunny Stream serves protected lessons.

## Run locally

1. Install Node.js 20 or newer and pnpm.
2. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Run `pnpm install` and `pnpm dev`.
4. Open the local URL printed by Vite.

`pnpm build` runs the TypeScript check and creates the production site in `dist/`.

## Publish from the private GitHub repo with Netlify

Keep the source repository private and connect `QosaiGm/al-shafie-academy` to Netlify using **Add new project → Import an existing project → GitHub**. The repository is under a personal account, so Netlify's Free plan supports connecting it. Netlify's current Free plan has a hard monthly usage limit; check the current plan and remaining credits in its dashboard before inviting students.

`netlify.toml` checks the required Supabase settings before building, runs `pnpm build` and publishes `dist`. Netlify installs dependencies from `pnpm-lock.yaml`; `package.json` pins pnpm so the build uses the lockfile's expected package manager. In the Netlify site settings, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` using the matching values from the local `.env` file, then deploy. Each push to `main` rebuilds and deploys the site to its HTTPS `*.netlify.app` address. A custom domain is optional.

## Finish site configuration

After the first deployment, configure each site URL before inviting students:

1. In Supabase Authentication → URL Configuration, set the deployed HTTPS URL as the Site URL and add `https://YOUR-SITE.netlify.app/**` to Redirect URLs. Keep localhost entries only for development.
2. In Google Cloud Console, add the deployed HTTPS origin to the OAuth client's authorized JavaScript origins. Keep the Supabase callback URL as its authorized redirect URI.
3. Add `YOUR-SITE.netlify.app` to Bunny Stream's allowed referrers for the video library.
4. Confirm the Supabase database has the current migrations, especially `202611200002_semester_installments.sql` and `202611200003_full_semester_payment.sql`. The latter supports either paying the whole semester at once or paying it in three installments. Each semester is subscribed to separately.
5. Confirm the required Supabase Edge Functions are deployed and their private Bunny credentials are configured in Supabase Function Secrets. Never put the Bunny token key, Supabase service-role key, OAuth client secret or SMTP credentials in `VITE_*` variables.
6. Run a live acceptance pass on the deployed URL: email and Google sign-in, first-device approval and teacher reset, test receipt submission and teacher review, second-semester access separation, installment handling, lesson playback, exams, library, announcements and account deletion controls. The current payment flow is for testing only.

The frontend Supabase anon key is a public client key and will be present in the built JavaScript. Database access must remain protected by the configured Supabase Row Level Security policies and Edge Functions.

## Supabase and Bunny

Database migrations are in `supabase/migrations/`; Edge Functions are in `supabase/functions/`. Apply migrations only in order and only after checking which are already installed in the live database. Do not paste TypeScript or Edge Function source into Supabase SQL Editor.

Set Bunny library credentials only as Supabase Edge Function secrets. The client stores only the Bunny video ID; the `bunny-playback` function checks the signed-in student's access and returns a short-lived playback URL.
