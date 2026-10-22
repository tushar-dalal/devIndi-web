# niemisha.curator

Portfolio, journal and contact site for Niemisha, an artist and curator of art and objects.

It lives at `devindi.in/niemisha/` while it's being designed. It's fully self-contained: nothing in this folder
uses devIndi's styles, scripts or analytics, and every link is relative. To move it, copy this folder's
contents to the root of the new repo.

## Editing content

Everything is in `js/data.js`: site details (email, Instagram), works (`made` or `curated`) and journal posts.
Artwork is generated as a placeholder until a piece has `image: "images/…"`.

## Before launch

- Replace placeholder text and the email in `js/data.js`, and the bio in `about.html`.
- Add real images under `images/`.
- Remove the `noindex` line from each page's `<head>`.
- Add a `CNAME` file with the new domain.
