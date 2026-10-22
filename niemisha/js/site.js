// Shared header, footer, generated artwork and page rendering for niemisha.curator.
(function () {
  const S = window.SITE, WORKS = window.WORKS, POSTS = window.POSTS;
  const page = document.body.dataset.page;
  let io; // scroll-reveal observer, created on first use
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel) => document.querySelector(sel);

  // ---------- generated "paintings" (placeholders until real images exist) ----------
  function rng(seed) {
    let a = seed * 9973 + 12345;
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function blob(r, cx, cy, rad, points) {
    const pts = [];
    for (let i = 0; i < points; i++) {
      const ang = (i / points) * Math.PI * 2;
      const rr = rad * (0.72 + r() * 0.5);
      pts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]);
    }
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    let d = `M${mid(pts[points - 1], pts[0]).map((n) => n.toFixed(1)).join(" ")}`;
    for (let i = 0; i < points; i++) {
      const p = pts[i], m = mid(p, pts[(i + 1) % points]);
      d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
    }
    return d + "Z";
  }
  function art(item, w = 400, h = 500) {
    if (item.image) return `<img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy" style="width:100%;aspect-ratio:${w}/${h};object-fit:cover">`;
    const r = rng(item.seed || 1), [bg, a, b, c] = item.palette;
    const big = blob(r, w * (0.35 + r() * 0.3), h * (0.38 + r() * 0.2), Math.min(w, h) * 0.36, 7);
    const mid = blob(r, w * (0.3 + r() * 0.4), h * (0.6 + r() * 0.15), Math.min(w, h) * 0.22, 6);
    const sx = w * (0.15 + r() * 0.7), sy = h * (0.15 + r() * 0.2), sr = 10 + r() * 22;
    let line = `M${w * 0.1} ${h * (0.82 + r() * 0.08)}`;
    for (let i = 1; i <= 4; i++) line += ` S${w * (0.1 + i * 0.2 - 0.1)} ${h * (0.78 + r() * 0.14)} ${w * (0.1 + i * 0.2)} ${h * (0.8 + r() * 0.1)}`;
    const id = "g" + (item.seed || 1) + "-" + w;
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(item.title)}" preserveAspectRatio="xMidYMid slice">
      <defs><filter id="${id}"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${item.seed}"/><feColorMatrix values="0 0 0 0 .3 0 0 0 0 .22 0 0 0 0 .15 0 0 0 .22 0"/><feComposite in2="SourceGraphic" operator="in"/></filter></defs>
      <rect width="${w}" height="${h}" fill="${bg}"/>
      <path d="${big}" fill="${a}" opacity=".92"/>
      <path d="${mid}" fill="${b}" opacity=".9" style="mix-blend-mode:multiply"/>
      <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${sr.toFixed(1)}" fill="${c}"/>
      <path d="${line}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" opacity=".8"/>
      <rect width="${w}" height="${h}" fill="${bg}" filter="url(#${id})"/>
    </svg>`;
  }

  // ---------- header & footer ----------
  const navItems = [["work.html", "Work", ["work", "piece"]], ["journal.html", "Journal", ["journal", "post"]], ["about.html", "About", ["about"]]];
  $("#head").outerHTML = `<header class="site-head"><div class="wrap">
      <a class="mark" href="index.html">${esc(S.name.toLowerCase())}<span class="dot"></span><small>${esc(S.role)}</small></a>
      <nav class="nav" aria-label="Main">${navItems.map(([href, label, pages]) =>
        `<a href="${href}"${pages.includes(page) ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
    </div></header>`;
  $("#foot").outerHTML = `<footer class="site-foot"><div class="wrap">
      <div class="hello">
        <a href="about.html#contact"><p class="kicker">Have a project, a space or an object in mind?</p><h2>Say <em>hello</em> →</h2></a>
        <span class="hand">thank you for looking ✿</span>
      </div>
      <div class="small">
        <span>© ${new Date().getFullYear()} ${esc(S.name)} · ${esc(S.location)}</span>
        <span><a href="mailto:${esc(S.email)}">${esc(S.email)}</a>${S.instagram ? ` · <a href="${esc(S.instagram)}" rel="noopener">Instagram</a>` : ""}</span>
      </div>
    </div></footer>`;

  // ---------- building blocks ----------
  const card = (w) => `<a class="card reveal" href="piece.html?id=${encodeURIComponent(w.id)}" data-kind="${w.kind}">
      <div class="frame">${art(w)}</div>
      <div class="meta"><h3>${esc(w.title)}</h3><span>${w.year}</span></div>
      <p class="sub">${esc(w.medium)}</p></a>`;
  const wide = (w) => `<a class="wide reveal" href="piece.html?id=${encodeURIComponent(w.id)}">
      <div class="frame">${art(w, 520, 380)}</div>
      <div><span class="pill curated">Curated · ${w.year}</span><h3 style="margin-top:14px">${esc(w.title)}</h3>
      <p>${esc(w.blurb)}</p><span class="arrow-link">See the project →</span></div></a>`;
  const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const postRow = (p) => `<li class="reveal"><a href="post.html?slug=${encodeURIComponent(p.slug)}">
      <time datetime="${p.date}">${fmtDate(p.date)}</time>
      <div><h3>${esc(p.title)}</h3><p>${esc(p.excerpt)}</p></div><span class="go" aria-hidden="true">→</span></a></li>`;
  const notFound = (what, back, label) => `<section class="page-head"><a class="back" href="${back}">← ${label}</a><h1>That ${what} <em>wandered off.</em></h1></section>`;

  // ---------- pages ----------
  const made = WORKS.filter((w) => w.kind === "made"), curated = WORKS.filter((w) => w.kind === "curated");

  if (page === "home") {
    $("#scatter").insertAdjacentHTML("afterbegin", made.slice(0, 3).map((w) => `<div class="tile">${art(w)}</div>`).join(""));
    $("#latest").innerHTML = made.slice(0, 3).map(card).join("");
    $("#curated").innerHTML = curated.slice(0, 2).map(wide).join("");
    $("#posts").innerHTML = POSTS.slice(0, 3).map(postRow).join("");
  }

  if (page === "work") {
    const grid = $("#works"), chips = document.querySelectorAll(".chip");
    const show = (kind) => {
      grid.innerHTML = WORKS.filter((w) => kind === "all" || w.kind === kind).map(card).join("");
      chips.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.kind === kind)));
      watch();
    };
    chips.forEach((c) => c.addEventListener("click", () => { show(c.dataset.kind); history.replaceState(null, "", c.dataset.kind === "all" ? "work.html" : "#" + c.dataset.kind); }));
    show(["made", "curated"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "all");
  }

  if (page === "piece") {
    const id = new URLSearchParams(location.search).get("id"), i = WORKS.findIndex((w) => w.id === id), w = WORKS[i];
    const el = $("#piece");
    if (!w) { el.innerHTML = notFound("piece", "work.html", "All work"); }
    else {
      document.title = `${w.title} · ${S.name}`;
      const prev = WORKS[(i - 1 + WORKS.length) % WORKS.length], next = WORKS[(i + 1) % WORKS.length];
      el.innerHTML = `<section class="page-head"><a class="back" href="work.html${w.kind === "curated" ? "#curated" : ""}">← All work</a></section>
        <div class="piece">
          <div class="frame">${art(w, 480, 600)}</div>
          <div>
            <span class="pill ${w.kind}">${w.kind === "made" ? "Made" : "Curated"}</span>
            <h2 style="margin-top:16px">${esc(w.title)}</h2>
            <dl><dt>Year</dt><dd>${w.year}</dd><dt>${w.kind === "made" ? "Medium" : "Format"}</dt><dd>${esc(w.medium)}</dd><dt>${w.kind === "made" ? "Size" : "Where"}</dt><dd>${esc(w.size)}</dd></dl>
            <div class="prose">${w.body.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
            <div class="pager"><a class="arrow-link" href="piece.html?id=${prev.id}">← ${esc(prev.title)}</a><a class="arrow-link" href="piece.html?id=${next.id}">${esc(next.title)} →</a></div>
          </div>
        </div>`;
    }
  }

  if (page === "journal") $("#posts").innerHTML = POSTS.map(postRow).join("");

  if (page === "post") {
    const slug = new URLSearchParams(location.search).get("slug"), p = POSTS.find((x) => x.slug === slug);
    const el = $("#post");
    if (!p) { el.innerHTML = notFound("note", "journal.html", "Journal"); }
    else {
      document.title = `${p.title} · ${S.name}`;
      el.innerHTML = `<section class="page-head"><a class="back" href="journal.html">← Journal</a>
          <p class="kicker"><time datetime="${p.date}">${fmtDate(p.date)}</time></p><h1 style="font-size:clamp(40px,6.5vw,84px)">${esc(p.title)}</h1>
          <p class="lede">${esc(p.excerpt)}</p></section>
        <article class="prose" style="padding-bottom:40px">${p.body.map((t) => `<p>${esc(t)}</p>`).join("")}</article>`;
    }
  }

  if (page === "about") {
    $("#portrait").innerHTML = art({ title: "Portrait placeholder", seed: 7, palette: ["#efe4d4", "#ecbcaa", "#c96a4b", "#2e2622"] }, 400, 460);
    $("#mail").href = "mailto:" + S.email;
    $("#mail").textContent = S.email;
    // The form just opens the visitor's email app with the message filled in; nothing is stored or sent by the site.
    $("#contactForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target, subject = `Hello from ${f.name.value.trim() || "someone"}`;
      location.href = `mailto:${S.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(f.message.value)}`;
    });
  }

  // ---------- gentle reveal on scroll ----------

  function watch() {
    const items = document.querySelectorAll(".reveal:not(.in)");
    if (!("IntersectionObserver" in window)) { items.forEach((n) => n.classList.add("in")); return; }
    io = io || new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    items.forEach((n, i) => { n.style.transitionDelay = (i % 3) * 90 + "ms"; io.observe(n); });
  }
  watch();
})();
