# devIndi

The home for devIndi's build kits — a static home page plus one privacy policy per
app, each themed to match that app's own design system.

```
devIndi/
├── index.html            home page — the build kit grid
├── chatpata/privacy.html
├── lantern/privacy.html
├── connect/privacy.html
├── resonance/privacy.html
├── waypoint/privacy.html
└── CNAME                 custom domain for GitHub Pages (devindi.in)
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

Update `privacy@devindi.in` and `hello@devindi.in` in the HTML if you'd rather use
different addresses — those inboxes need to actually exist (or forward somewhere)
once the site is live.
