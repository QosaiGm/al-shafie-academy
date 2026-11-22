# Al-Shafie Academy

Arabic-first learning platform for Al-Shafie Academy's Palestinian Tawjihi English course. The site is built with React, TypeScript and Vite. Supabase provides authentication, database, storage and Edge Functions; Bunny Stream serves protected lessons.

## Run locally

1. Install Node.js 20 or newer and pnpm.
2. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Run `pnpm install` and `pnpm dev`.
4. Open the local URL printed by Vite.

`pnpm build` runs the TypeScript check and creates the production site in `dist/`.

## Publish with Cloudflare Pages

The source repository should remain private. Create a private GitHub repository, push this project, then connect that repository in Cloudflare Pages using **Workers & Pages → Create application → Pages → Connect to Git**.

Set the Pages build configuration:

- Framework preset: **Vite**
- Root directory: `/`
- Build command: `pnpm install --frozen-lockfile && pnpm build`
- Build output directory: `dist`
- Environment variable `NODE_VERSION`: `20`
- Environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`: the Supabase project URL and publishable anon key

Use the HTTPS `*.pages.dev` address first. Add a custom domain in Cloudflare later if you have one. Each push to `main` then builds and publishes the site automatically. Do not enable GitHub Pages for this repository.

## Finish production configuration

After the first Pages deployment, configure each production URL before inviting students:

1. In Supabase Authentication → URL Configuration, set the deployed HTTPS origin as the Site URL and add the deployed origin and callback paths to Redirect URLs. Keep localhost entries only for development.
2. In Google Cloud Console, add the deployed HTTPS origin to the OAuth client's authorized JavaScript origins. Keep the Supabase callback URL as its authorized redirect URI.
3. Set the production site URL in Bunny Stream's allowed referrers for the video library.
4. Confirm the Supabase database has the current migrations, especially `202611200002_semester_installments.sql` and `202611200003_full_semester_payment.sql`. The latter supports either paying the whole semester at once or paying it in three installments. Each semester is subscribed to separately.
5. Confirm the required Supabase Edge Functions are deployed and their private Bunny credentials are configured in Supabase Function Secrets. Never put the Bunny token key, Supabase service-role key, OAuth client secret or SMTP credentials in `VITE_*` variables.
6. Run a live acceptance pass on the production URL: email and Google sign-in, first-device approval and teacher reset, both semester payment options, receipt submission and teacher review, second-semester access separation, the three-day installment grace period, lesson playback, exams, library, announcements and account deletion controls.

The frontend Supabase anon key is a public client key and will be present in the built JavaScript. Database access must remain protected by the configured Supabase Row Level Security policies and Edge Functions.

## Supabase and Bunny

Database migrations are in `supabase/migrations/`; Edge Functions are in `supabase/functions/`. Apply migrations only in order and only after checking which are already installed in the live database. Do not paste TypeScript or Edge Function source into Supabase SQL Editor.

Set Bunny library credentials only as Supabase Edge Function secrets. The client stores only the Bunny video ID; the `bunny-playback` function checks the signed-in student's access and returns a short-lived playback URL.
