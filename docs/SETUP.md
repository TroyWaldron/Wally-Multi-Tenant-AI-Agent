# Setting Wally up for real

Work through these in order. Each step leaves the app working.

## 1. Supabase

1. Create a project at supabase.com (name it `wally`, region closest to the
   Caribbean is `us-east-1`).
2. In **SQL Editor**, paste and run
   `supabase/migrations/20260927000001_wally_core.sql`.
   (Or with the CLI: `supabase link` then `supabase db push`.)
3. In **Authentication > URL Configuration**, set the Site URL to your
   Vercel URL and add `https://YOUR-DOMAIN/auth/callback` as a redirect URL.
4. From **Project Settings > API**, copy the project URL, the `anon` key and
   the `service_role` key for step 2.

## 2. Vercel

1. Import the GitHub repo as a new Vercel project (framework: Next.js).
2. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PLATFORM_ADMIN_EMAILS` = your email
   - `ANTHROPIC_API_KEY` (or set it later in Settings)
3. Deploy, open the site, choose **Email me a sign-in link**, and sign in.
   You become platform admin automatically.
4. Go to **Business** and press **Set up Sunsational Tobago**.

## 3. n8n

1. In n8n, import `n8n/wally-router.json`.
2. In its **Verify & route** node, paste a long random secret. Put the same
   secret in Wally under **Settings > n8n > Shared secret**.
3. In **Owner message**, set the owner's WhatsApp number. In both WhatsApp
   HTTP nodes, replace `PASTE_PHONE_NUMBER_ID` and pick a Header Auth
   credential with `Authorization: Bearer <WhatsApp access token>`.
4. Activate the workflow and copy its production webhook URL into
   **Settings > n8n > n8n webhook URL**. Press **Send test event**.
5. Optional: import `n8n/sunsational-bridge.json` so Sunsational's own
   events (bookings, payments, leads) count as outcomes in Wally. Point
   Sunsational's `N8N_WEBHOOK_URL` at it, or add its HTTP node to the
   workflow Sunsational already calls.

The router answers two agent workflows today, both using Sunsational's
public endpoints: `check_availability` (GET `/api/availability`) and
`create_enquiry` (POST `/api/inquiries`). Any other workflow name returns a
polite "not built yet" so the agent hands over instead of guessing.

## 4. WhatsApp (one Meta app for every client)

1. In Wally **Settings > WhatsApp**, set a verify token (any string) and the
   Meta app secret.
2. In Meta's app dashboard, set the webhook URL to
   `https://YOUR-DOMAIN/api/webhooks/whatsapp` with the same verify token,
   and subscribe to `messages`.
3. In **Channels & Embed**, add a WhatsApp channel with the business's
   `phone_number_id`. Messages to that number now reach its agent, and
   replies go out through n8n.

## 5. Website widget

Copy the one-line snippet from **Channels & Embed** into the site, before
`</body>`. For the Sunsational Next.js site that is a `<Script>` tag in the
root layout. The widget only appears when a live agent has the Website
channel switched on.
