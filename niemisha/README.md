# Niemisha Sharma — Artist & Curator

Personal site built to the *Website Kickstart Brief* (warm, intellectual, editorial, contemporary).

It lives at `devindi.in/niemisha/` while it's being designed. It's fully self-contained: nothing in this folder
uses devIndi's styles, scripts or analytics, and every link is relative. To move it, copy this folder's
contents to the root of the new repo.

## Pages

Home · Practice (`practice.html`, `project.html?id=…`) · Curating (`curating.html`, `exhibition.html?id=…`) ·
Writing & Research (`writing.html`, `entry.html?slug=…`) · About + CV (`about.html`) · Contact (`contact.html`).

## Editing content

Everything is in `js/data.js`, laid out like the brief's content model (§12). Every record is currently a
placeholder marked `placeholder: true`. The brief rules out invented titles and generated images, so empty image
slots show "to be supplied". Remove `placeholder: true` from each record once it's verified; the "To select" tags
and the draft banner disappear by themselves. The Practice and Curating intro paragraphs are in their HTML files.

## Before launch (brief §14)

- Replace every placeholder record, the email, and the intro paragraphs; add images under `images/`.
- Add the CV PDF (e.g. `cv/Niemisha_Sharma_CV.pdf`) and set `cv` in `js/data.js`.
- Decide whether the contact form should send through a form service, or whether opening the visitor's email app is enough.
- Remove the `noindex` line from each page's `<head>`, add a sitemap, and add a `CNAME` file with the domain.
