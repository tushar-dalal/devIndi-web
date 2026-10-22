// Shared header, footer and page rendering for Niemisha Sharma's site. Content comes from js/data.js.
(function () {
  const S = window.SITE, P = window.PRACTICE, C = window.CURATING, W = window.WRITING, A = window.ABOUT;
  const page = document.body.dataset.page;
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const qs = (k) => new URLSearchParams(location.search).get(k);
  let io; // scroll-reveal observer, created on first use
  document.documentElement.classList.add("js");

  const anyPlaceholder = [...P, ...C, ...W, A].some((r) => r.placeholder) || !S.heroImage.src;
  const ph = (r) => (r && r.placeholder ? ` <span class="ph-tag">To select</span>` : "");

  // An image slot: the real image, or a labelled empty box. Never a generated stand-in (brief §06).
  const img = (im, label) => im && im.src
    ? `<div class="img"><img src="${esc(im.src)}" alt="${esc(im.alt || "")}" loading="lazy"></div>`
    : `<div class="img empty"><span>${esc(label || (im && im.kind) || "Image")} · to be supplied</span></div>`;
  const fig = (im) => `<figure class="reveal">${img(im, im.kind)}${im.caption ? `<figcaption>${im.kind ? `<b>${esc(im.kind)}.</b> ` : ""}${esc(im.caption)}</figcaption>` : ""}</figure>`;
  const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const year = (d) => d.slice(0, 4);
  const statusLabel = { note: "Working note", draft: "Draft", excerpt: "Excerpt" };
  const list = (items) => `<ul class="cv-list">${items.map((x) => `<li><span class="yr">${esc(x.years)}</span><span>${esc(x.text)}</span></li>`).join("")}</ul>`;
  const notFound = (back, label) => `<section class="page-head"><a class="crumb" href="${back}">← ${label}</a><h1>This page <em>isn't here.</em></h1><p class="lede">It may have moved. The link above goes back to the index.</p></section>`;

  // ---------- header / footer ----------
  const NAV = [
    ["index.html", "Home", ["home"]],
    ["practice.html", "Practice", ["practice", "project"]],
    ["curating.html", "Curating", ["curating", "exhibition"]],
    ["writing.html", "Writing & Research", ["writing", "entry"]],
    ["about.html", "About", ["about"]],
    ["contact.html", "Contact", ["contact"]],
  ];
  $("#head").outerHTML =
    `<a class="skip" href="#main">Skip to content</a>` +
    (anyPlaceholder ? `<div class="draft-bar">Design preview: titles, texts and images marked “To select” are placeholders for Niemisha's real work.</div>` : "") +
    `<header class="site-head"><div class="wrap">
      <a class="mark" href="index.html"><b>${esc(S.name)}</b><small>${esc(S.descriptor)}</small></a>
      <button class="menu-btn" aria-expanded="false" aria-controls="nav">Menu</button>
      <nav class="nav" id="nav" aria-label="Main">${NAV.map(([h, l, p]) => `<a href="${h}"${p.includes(page) ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
    </div></header>`;
  const cvLink = S.cv ? `<a href="${esc(S.cv)}" download>Download CV${S.cvUpdated ? ` (updated ${esc(S.cvUpdated)})` : ""}</a>` : `<span>CV coming soon</span>`;
  $("#foot").outerHTML = `<footer class="site-foot"><div class="wrap">
      <div class="invite"><h2>${esc(S.invite).replace("glad", "<em>glad</em>")}</h2><a class="btn line" style="color:#f7f1e7;box-shadow:inset 0 0 0 1px #f7f1e7" href="contact.html">Get in touch →</a></div>
      <div class="foot-grid">
        <div><p class="serif" style="font-size:22px;color:#f7f1e7;margin:0">${esc(S.name)}</p><p class="meta" style="margin:4px 0 16px">${esc(S.descriptor)}</p>
          <a href="mailto:${esc(S.email)}">${esc(S.email)}</a></div>
        <ul>${NAV.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join("")}</ul>
        <ul><li>${cvLink}</li>${S.socials.map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a></li>`).join("")}</ul>
      </div>
      <div class="foot-small"><span>© ${new Date().getFullYear()} ${esc(S.name)}. Images © the artist unless credited otherwise.</span><span>This site uses no tracking or cookies.</span></div>
    </div></footer>`;

  const btn = $(".menu-btn"), nav = $("#nav");
  btn.addEventListener("click", () => { const open = nav.classList.toggle("open"); btn.setAttribute("aria-expanded", String(open)); btn.textContent = open ? "Close" : "Menu"; });
  const head = $(".site-head");
  addEventListener("scroll", () => head.classList.toggle("scrolled", scrollY > 8), { passive: true });

  // ---------- shared building blocks ----------
  const SIZES = ["lg", "md offset", "md", "lg offset"]; // rows of 7+5 and 5+7 columns, for varied image scale
  const workTile = (p, i) => `<a class="work reveal ${SIZES[i % 4]}" href="project.html?id=${encodeURIComponent(p.id)}" data-cat="${esc(p.category)}">
      ${img(p.images[0], p.images[0] && p.images[0].kind)}
      <div class="info"><h3>${esc(p.title)}${ph(p)}</h3><p class="meta">${esc(p.years)} · ${esc(p.category)}</p></div></a>`;
  const feature = (c) => `<a class="feature reveal" href="exhibition.html?id=${encodeURIComponent(c.id)}">
      ${img(c.images[0], "Installation view")}
      <div><p class="label">${esc(c.role)} · ${esc(c.year)}</p><h3>${esc(c.title)}${ph(c)}</h3><p>${esc(c.summary)}</p>
        <dl class="facts"><dt>Venue</dt><dd>${esc(c.venue)}, ${esc(c.city)}</dd><dt>Role</dt><dd>${esc(c.role)}</dd></dl>
        <p style="margin:20px 0 0"><span class="more">Read about the exhibition →</span></p></div></a>`;
  const entryHref = (e) => (e.url ? esc(e.url) : `entry.html?slug=${encodeURIComponent(e.slug)}`);
  const entryRow = (e) => `<li class="reveal"><a href="${entryHref(e)}"${e.url ? ' rel="noopener"' : ""}>
      <span class="type">${esc(e.type)}${statusLabel[e.status] ? `<br><span class="tag ${e.status === "draft" ? "draft" : ""}">${statusLabel[e.status]}</span>` : ""}</span>
      <div><h3>${esc(e.title)}${ph(e)}${e.url ? " ↗" : ""}</h3><p>${esc(e.summary)}</p><p class="meta" style="margin-top:6px">${esc(e.context)}</p></div>
      <span class="yr">${year(e.date)}</span></a></li>`;
  const findRef = (r) => r.kind === "practice"
    ? (() => { const p = P.find((x) => x.id === r.id); return p && { href: `project.html?id=${p.id}`, label: p.title, kind: "Artistic practice" }; })()
    : (() => { const c = C.find((x) => x.id === r.id); return c && { href: `exhibition.html?id=${c.id}`, label: c.title, kind: "Curatorial project" }; })();

  // ---------- pages ----------
  if (page === "home") {
    $("#heroImg").innerHTML = `<figure>${img(S.heroImage, "Hero image")}<figcaption>${esc(S.heroImage.caption)}</figcaption></figure>`;
    if (S.years) $("#years").textContent = "Selected work / " + S.years;
    $("#homeWorks").innerHTML = P.slice(0, 4).map(workTile).join("");
    $("#homeCurating").innerHTML = C.slice(0, 3).map(feature).join("");
    const note = W.find((e) => e.question) || W[0];
    $("#inquiry").innerHTML = `<div><p class="label"><span class="n">04</span>Current inquiry</p>${note.placeholder ? '<span class="ph-tag">To select</span>' : ""}</div>
      <div><blockquote>${esc(note.question || note.summary)}</blockquote><p style="margin-top:24px"><a class="more" href="${entryHref(note)}">Read the note →</a></p></div>`;
    $("#homeWriting").innerHTML = W.slice(0, 3).map(entryRow).join("");
    $("#aboutImg").innerHTML = img(A.portrait, "Portrait or studio image (optional)");
    $("#aboutShort").innerHTML = `${esc(A.short)}${ph(A)}`;
  }

  if (page === "practice") {
    const cats = [...new Set(P.map((p) => p.category))];
    const grid = $("#works"), bar = $("#filters");
    if (cats.length > 1) {
      bar.innerHTML = ["All", ...cats].map((c) => `<button class="filter" data-cat="${esc(c)}" aria-pressed="${c === "All"}">${esc(c)}</button>`).join("");
      bar.addEventListener("click", (e) => {
        const b = e.target.closest(".filter"); if (!b) return;
        bar.querySelectorAll(".filter").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        render(b.dataset.cat);
      });
    }
    const render = (cat) => { grid.innerHTML = P.filter((p) => cat === "All" || p.category === cat).map(workTile).join(""); watch(); };
    render("All");
  }

  if (page === "project") {
    const i = P.findIndex((x) => x.id === qs("id")), p = P[i], el = $("#main");
    if (!p) el.innerHTML = notFound("practice.html", "Practice");
    else {
      document.title = `${p.title} · ${S.name}`;
      const related = P.filter((x) => x !== p).slice(0, 2);
      el.innerHTML = `<div class="wrap">
        <section class="page-head" style="padding-bottom:0"><a class="crumb" href="practice.html">← Artistic Practice</a></section>
        <div class="detail-head">
          <div><p class="label">${esc(p.category)}</p><h1>${esc(p.title)}${ph(p)}</h1><p class="lede" style="margin-top:18px">${esc(p.summary)}</p></div>
          <div class="metablock"><dl><dt>Year</dt><dd>${esc(p.years)}</dd><dt>Medium</dt><dd>${esc(p.medium)}</dd>${p.series ? `<dt>Series</dt><dd>${esc(p.series)}</dd>` : ""}</dl></div>
        </div>
        <div class="lead">${fig(p.images[0])}</div>
        <div class="sequence">${p.images.slice(1).map(fig).join("")}</div>
        <section class="reading"><div><p class="label">About the work</p></div>
          <div class="prose">${p.statement.map((t) => `<p>${esc(t)}</p>`).join("")}
          ${p.credits.length ? `<ul class="credits">${p.credits.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}</div></section>
        <section class="related"><div class="head-row"><h2>Related <em>work</em></h2><a class="more" href="practice.html">Back to all work →</a></div>
          <div class="works">${related.map((r, k) => workTile(r, k + 1)).join("")}</div></section>
      </div>`;
    }
  }

  if (page === "curating") $("#features").innerHTML = C.map(feature).join("");

  if (page === "exhibition") {
    const c = C.find((x) => x.id === qs("id")), el = $("#main");
    if (!c) el.innerHTML = notFound("curating.html", "Curatorial Practice");
    else {
      document.title = `${c.title} · ${S.name}`;
      const writing = W.filter((e) => (e.related || []).some((r) => r.kind === "curating" && r.id === c.id));
      el.innerHTML = `<div class="wrap">
        <section class="page-head" style="padding-bottom:0"><a class="crumb" href="curating.html">← Curatorial Practice</a></section>
        <div class="detail-head">
          <div><p class="label">${esc(c.role)} · ${esc(c.year)}</p><h1>${esc(c.title)}${ph(c)}</h1><p class="lede" style="margin-top:18px">${esc(c.summary)}</p></div>
          <div class="metablock"><dl>
            <dt>Role</dt><dd>${esc(c.role)}</dd><dt>Dates</dt><dd>${esc(c.dates)}</dd><dt>Venue</dt><dd>${esc(c.venue)}, ${esc(c.city)}</dd>
            ${c.artists.length ? `<dt>Artists</dt><dd>${c.artists.map(esc).join(", ")}</dd>` : ""}
            ${c.collaborators.length ? `<dt>With</dt><dd>${c.collaborators.map(esc).join(", ")}</dd>` : ""}
          </dl></div>
        </div>
        <div class="lead">${fig(c.images[0])}</div>
        <section class="reading"><div><p class="label">Curatorial text</p></div>
          <div class="prose">${c.text.map((t) => `<p>${esc(t)}</p>`).join("")}</div></section>
        <div class="sequence">${c.images.slice(1).map(fig).join("")}</div>
        <section class="reading"><div><p class="label">Credits &amp; links</p></div><div>
          ${c.credits.length ? `<ul class="credits">${c.credits.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="meta">Credits to be added.</p>`}
          ${c.links.map((l) => `<p><a href="${esc(l.url)}" rel="noopener">${esc(l.label)} ↗</a></p>`).join("")}
          ${writing.map((e) => `<p><a href="${entryHref(e)}">${esc(e.type)}: ${esc(e.title)} →</a></p>`).join("")}
        </div></section>
        <section class="related" style="padding-bottom:0"><div class="head-row"><a class="more" href="curating.html">← All curatorial projects</a><a class="more" href="about.html#cv">CV &amp; contact →</a></div></section>
      </div>`;
    }
  }

  if (page === "writing") $("#entries").innerHTML = W.map(entryRow).join("");

  if (page === "entry") {
    const e = W.find((x) => x.slug === qs("slug")), el = $("#main");
    if (!e) el.innerHTML = notFound("writing.html", "Writing & Research");
    else {
      document.title = `${e.title} · ${S.name}`;
      const rel = (e.related || []).map(findRef).filter(Boolean);
      el.innerHTML = `<div class="wrap">
        <section class="page-head"><a class="crumb" href="writing.html">← Writing &amp; Research</a>
          <p class="label">${esc(e.type)}${statusLabel[e.status] ? ` · <span class="tag ${e.status === "draft" ? "draft" : ""}">${statusLabel[e.status]}</span>` : ""}</p>
          <h1 class="measure">${esc(e.title)}${ph(e)}</h1>
          <p class="meta" style="margin-top:16px"><time datetime="${e.date}">${fmtDate(e.date)}</time> · ${esc(e.context)}</p></section>
        <article class="prose">${e.question ? `<p class="serif" style="font-size:26px;line-height:1.3">${esc(e.question)}</p>` : ""}${e.body.map((t) => `<p>${esc(t)}</p>`).join("")}</article>
        ${rel.length ? `<section class="related"><p class="label">Related</p>${rel.map((r) => `<p style="margin:0 0 8px"><span class="meta">${r.kind}:</span> <a href="${r.href}">${esc(r.label)} →</a></p>`).join("")}</section>` : ""}
      </div>`;
    }
  }

  if (page === "about") {
    $("#portrait").innerHTML = `<figure>${img(A.portrait, "Portrait or studio image (optional)")}</figure>`;
    $("#bio").innerHTML = `${esc(A.short)}${ph(A)}`;
    $("#practiceText").textContent = A.practice;
    $("#curatorialText").textContent = A.curatorial;
    $("#education").innerHTML = list(A.education);
    $("#experience").innerHTML = list(A.experience);
    $("#selected").innerHTML = list(A.selected);
    $("#cvBtn").outerHTML = S.cv ? `<a class="btn" href="${esc(S.cv)}" download>Download CV (PDF)</a>` : `<span class="btn line" aria-disabled="true" style="cursor:default">CV coming soon</span>`;
  }

  if (page === "contact") {
    $("#mail").href = "mailto:" + S.email;
    $("#mail").textContent = S.email;
    const form = $("#contactForm"), status = $("#status");
    const fields = ["name", "email", "type", "message"];
    const check = (f) => {
      const el = form[f], v = el.value.trim();
      let msg = "";
      if (!v) msg = "Please fill this in.";
      else if (f === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = "Please enter a valid email address.";
      el.setAttribute("aria-invalid", String(!!msg));
      $("#err-" + f).textContent = msg;
      return !msg;
    };
    fields.forEach((f) => form[f].addEventListener("blur", () => check(f)));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      status.className = "status";
      if (form.website.value) return; // honeypot: bots fill hidden fields
      const ok = fields.map(check).every(Boolean);
      if (!ok) { status.textContent = "Some fields need attention."; status.className = "status bad show"; form.querySelector('[aria-invalid="true"]').focus(); return; }
      const body = `${form.message.value.trim()}\n\n— ${form.name.value.trim()} (${form.email.value.trim()})`;
      location.href = `mailto:${S.email}?subject=${encodeURIComponent(form.type.value + " enquiry")}&body=${encodeURIComponent(body)}`;
      status.textContent = `Your email app should now open with your message ready to send. If it didn't, please write to ${S.email}.`;
      status.className = "status ok show";
    });
  }

  // ---------- subtle reveal ----------
  function watch() {
    const items = document.querySelectorAll(".reveal:not(.in)");
    if (!("IntersectionObserver" in window)) { items.forEach((n) => n.classList.add("in")); return; }
    io = io || new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -5% 0px" });
    items.forEach((n) => io.observe(n));
  }
  watch();
})();
