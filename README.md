# devIndi

The home for devIndi's apps: small utilities made with AI. A static home page
(ShiftDrop featured first, the other apps listed as "in testing"), one "about this
app" page per app, and a privacy policy + terms per app. Every page shares one
black-and-white design system in `assets/site.css` (Geist, Geist Mono, Instrument
Serif; no gradients). Navigation follows one hierarchy: **home → app page → privacy policy**.

```
devIndi/
├── index.html              home page — ShiftDrop first, then the apps in testing
├── assets/                 site.css (shared styles for every public page) + favicon.svg
├── feedback.html           shared feedback form (all apps, one inbox)
├── chatpata/
│   ├── index.html          about Chatpata
│   ├── privacy.html
│   └── terms.html
├── lantern/
│   ├── index.html          about Lantern
│   ├── privacy.html
│   └── terms.html
├── connect/
│   ├── index.html          about Connect
│   ├── privacy.html
│   └── terms.html
├── resonance/
│   ├── index.html          about Resonance
│   ├── privacy.html
│   └── terms.html
├── waypoint/
│   ├── index.html          about Waypoint
│   ├── privacy.html
│   └── terms.html
├── shiftdrop/              ShiftDrop (Windows app) — about/download page, privacy, terms, icon.png
│   ├── index.html          download links point at the GitHub Release `shiftdrop-v1.0.0`
│   ├── privacy.html        (the installer is >100 MB, too big to commit; it lives on the release)
│   └── terms.html
├── shotly/                 Shotly (Windows screenshot app), coming soon: teaser page only
│   ├── index.html          animated CSS mock-ups (capture, redact, search); no downloads yet
│   └── icon.svg            also teased on the home page in the "Coming up" section
├── spendtracker/           unlisted admin tool: AI Spend Tracker prototype
│   ├── index.html          (reached via admin/dashboard.html; data lives in IndexedDB)
│   └── tools/pull.mjs      pulls the Anthropic Console cost report locally (its API blocks browsers)
├── worksheets/             unlisted admin tool: Class Manager (paper prompts for Claude)
│   ├── index.html          runs on devindi.in; reads the folder via the laptop service on localhost:4777
│   ├── server/             serve.mjs reads D:\Tushars\Students; install-startup.ps1 starts it at sign-in
│   ├── skills/             sync-class-logs + prep-tomorrow skill sources (keep the JSON files current)
│   └── docs/               PRD.md and folder-contract.md (the JSON files Claude keeps current)
└── CNAME                   custom domain for GitHub Pages (devindi.in)
```

No build step, no dependencies — plain HTML/CSS, fonts loaded from Google Fonts.
Open `index.html` directly in a browser to preview locally.

## Publishing to devindi.in via GitHub Pages

See the step-by-step guide in the project chat, or follow these steps:

1. Create a new **public** GitHub repo (e.g. `devindi-web`), don't initialize it with
   a README.
2. From this folder:
   ```bash
   git remote add origin https://github.com/<your-username>/devindi-web.git
   git branch -M main
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages** → Source: `Deploy from a branch` → Branch: `main`,
   folder `/ (root)` → Save.
4. Still on that page, under **Custom domain**, enter `devindi.in` → Save. (The
   `CNAME` file in this repo already declares it, so GitHub should pre-fill it.)
5. At your domain registrar for `devindi.in`, add these DNS records:
   - Four `A` records on the apex (`@`) pointing to:
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - One `CNAME` record for `www` pointing to `<your-username>.github.io`
6. Wait for DNS to propagate (minutes to a few hours), then back in
   **Settings → Pages**, tick **Enforce HTTPS** once it becomes available.

Update `reach@devindi.in` in the HTML if you'd rather use a different address — that
inbox needs to actually exist (or forward somewhere) once the site is live.

Each app page also links to a `terms.html`, with a small tab toggle at the top of
both the terms and privacy pages so visitors can flip between them.

## Feedback form (`feedback.html`)

One shared feedback page for every app, linked from the home page and from each
app's own page (with `?app=<Name>` pre-selecting the right option in the dropdown).
Submissions POST to [FormSubmit](https://formsubmit.co) — a free, no-signup
form-to-email relay — which emails each submission to `reach@devindi.in`.

**One-time setup required:** the *first* submission FormSubmit ever receives for
`reach@devindi.in` triggers a confirmation email to that address. Someone with
access to that inbox needs to click the confirmation link once — after that,
every future submission is delivered automatically, no further action needed.

To point submissions at a different address, change the URL in the `fetch(...)`
call inside `feedback.html`'s `<script>` block
(`https://formsubmit.co/ajax/reach@devindi.in`).

## Website analytics (`analytics/`, `admin/analytics.html`)

Every public page (and the admin sign-in screen) loads `analytics/config.js` +
`analytics/track.js`, which send pageviews, sources, device info, clicks, time on
page, scroll depth, form submits, JS errors, admin sign-ins and session recordings
(rrweb, inputs masked) to Supabase. Pages behind the admin login only log an
`admin_view`. Results show in **Admin → Website Analytics**.

One-time setup:

1. Run `analytics/supabase-setup.sql` in the Supabase **SQL Editor**.
2. Copy the Project URL and anon/publishable key from **Project Settings → API** into `analytics/config.js`.

The Analytics page reads with that public key, so there's no second sign-in. Trade-off:
the key is in this public repo, so anyone could read the analytics data and recordings.
Add the two `<script>` tags to any new public page. Track a custom action with
`devindiAnalytics.track('name', { any: 'props' })`, or add `data-track="name"` to an element.
