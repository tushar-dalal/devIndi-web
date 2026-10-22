// All of the site's content lives here, following the content model in the Website Kickstart Brief (§12).
//
// IMPORTANT: every record below is a PLACEHOLDER (marked `placeholder: true`). The brief is clear that the site
// must not invent artwork titles or use generated imagery, so these only show the layout. Replace each one with
// Niemisha's real, verified work, and delete `placeholder: true` once a record is final. The "To select" tags
// and the draft banner disappear on their own when nothing is marked as a placeholder.
//
// Images: put files in niemisha/images/ and set  src: "images/project-title_artwork-title_2025_view-01.webp".
// A missing `src` shows a quiet "image to be supplied" box, never a stand-in picture.

window.SITE = {
  name: "Niemisha Sharma",
  descriptor: "Artist & Curator",
  tagline: "Artistic practice, curatorial inquiry, and visual research.",
  years: "",                       // e.g. "2019–present" once confirmed (brief §06); empty hides it
  email: "hello@example.com",      // TODO: professional email
  cv: "",                          // e.g. "cv/Niemisha_Sharma_CV.pdf"; empty shows "CV coming soon"
  cvUpdated: "",                   // e.g. "October 2026"
  socials: [                       // professional profiles only; empty list hides them
    // { label: "Instagram", url: "https://instagram.com/…" },
  ],
  heroImage: { src: "", alt: "", caption: "Hero image: a real artwork or installation view, to be selected" },
  invite: "For exhibitions, research, writing or collaboration, I'd be glad to hear from you.",
};

// Artistic Practice — 3–5 projects or series at launch (brief §11).
// category: one of "Painting", "Printmaking", "Photography", "Installation", "Other". Filters only show categories in use.
window.PRACTICE = [
  {
    id: "painting-series", placeholder: true,
    title: "Painting series", years: "Year", category: "Painting",
    medium: "Medium · dimensions", series: "",
    summary: "One or two plain sentences on what the series is and where it started.",
    statement: [
      "A short introduction goes here, written in Niemisha's own voice. It should say what the work is and what prompted it, in concrete terms.",
      "A longer statement is optional and only needed when it adds context the images can't carry.",
    ],
    images: [
      { kind: "Artwork", caption: "Title, year. Medium, dimensions." },
      { kind: "Artwork", caption: "Title, year. Medium, dimensions." },
      { kind: "Detail", caption: "Detail of title, year." },
    ],
    credits: ["Photography: name"],
  },
  {
    id: "printmaking-series", placeholder: true,
    title: "Printmaking series", years: "Year", category: "Printmaking",
    medium: "Process · edition · dimensions",
    summary: "One or two plain sentences on the process and what it made possible.",
    statement: ["Project introduction to be written."],
    images: [
      { kind: "Artwork", caption: "Title, year. Process, edition, dimensions." },
      { kind: "Process", caption: "Process image, if it clarifies the work." },
    ],
    credits: [],
  },
  {
    id: "cyanotype-pinhole", placeholder: true,
    title: "Cyanotype and pinhole photography", years: "Year", category: "Photography",
    medium: "Cyanotype / pinhole photograph · dimensions",
    summary: "Include only if this remains representative of the current practice.",
    statement: ["Project introduction to be written."],
    images: [
      { kind: "Artwork", caption: "Title, year. Cyanotype on paper, dimensions." },
      { kind: "Artwork", caption: "Title, year. Pinhole photograph, dimensions." },
    ],
    credits: [],
  },
  {
    id: "light-installation", placeholder: true,
    title: "Installation on light", years: "Year", category: "Installation",
    medium: "Installation · materials · dimensions variable",
    summary: "Include only once the documentation and its current framing are approved.",
    statement: ["Project introduction to be written."],
    images: [
      { kind: "Installation view", caption: "Installation view, venue, year. Photo: name." },
      { kind: "Detail", caption: "Detail." },
    ],
    credits: ["Photography: name"],
  },
];

// Curatorial Practice — 2–4 projects with clear roles (brief §08). role must be accurate:
// "Curator", "Co-curator", "Curatorial assistant", "Contributor", …
window.CURATING = [
  {
    id: "exhibition-one", placeholder: true,
    title: "Exhibition title", role: "Curator", year: "Year",
    dates: "Opening – closing dates", venue: "Venue name", city: "City",
    artists: ["Artist name", "Artist name", "Artist name"],
    collaborators: [],
    summary: "One or two sentences on what the exhibition brought together, and why.",
    text: [
      "The approved curatorial statement goes here, with attribution. A calm reading column keeps it separate from the facts on the left.",
    ],
    images: [
      { kind: "Installation view", caption: "Installation view. Photo: name." },
      { kind: "Key work", caption: "Artist, title, year. Courtesy of the artist." },
      { kind: "Public programme", caption: "Public programme, date." },
    ],
    credits: ["Photography: name", "Design: name", "Institution: name"],
    links: [],
  },
  {
    id: "exhibition-two", placeholder: true,
    title: "Exhibition title", role: "Co-curator", year: "Year",
    dates: "Dates", venue: "Venue name", city: "City",
    artists: ["Artist name", "Artist name"],
    collaborators: ["Co-curator name"],
    summary: "One or two sentences. State the shared role plainly.",
    text: ["Curatorial text to be supplied."],
    images: [{ kind: "Installation view", caption: "Installation view. Photo: name." }],
    credits: [],
    links: [],
  },
];

// Writing & Research — 3–6 entries (brief §09).
// type: "Essay", "Catalogue text", "Research note", "Talk", "Publication", "Interview".
// status: "published", "note" (working note), "excerpt" or "draft". External texts: set `url` instead of `body`.
window.WRITING = [
  {
    slug: "essay", placeholder: true,
    title: "Essay title", type: "Essay", status: "published", date: "2026-01-01",
    context: "Publication name, issue", url: "",
    summary: "A sentence on the question the essay takes up.",
    body: ["Essay text, or set `url` to link to where it is published."],
    related: [{ kind: "practice", id: "painting-series" }],
  },
  {
    slug: "research-note", placeholder: true,
    title: "Research note title", type: "Research note", status: "note", date: "2026-01-01",
    context: "Working note", url: "",
    summary: "A short note from current research, as an invitation into the thinking behind the work.",
    question: "A current research question, phrased in a single sentence, goes here.",
    body: ["Short research note to be written."],
    related: [{ kind: "practice", id: "light-installation" }],
  },
  {
    slug: "catalogue-text", placeholder: true,
    title: "Catalogue text title", type: "Catalogue text", status: "published", date: "2025-01-01",
    context: "Exhibition catalogue, publisher", url: "",
    summary: "Written for an exhibition; name the exhibition and publisher.",
    body: ["Catalogue text, or a link to it."],
    related: [{ kind: "curating", id: "exhibition-one" }],
  },
];

// About (brief §10). Third person for the formal biography.
window.ABOUT = {
  placeholder: true,
  short: "Niemisha Sharma is an artist and curator. A short biography of 60–100 words goes here: what she makes, what she curates, and the questions running through both. It should be written in plain, specific language and match the CV.",
  portrait: { src: "", alt: "", caption: "Portrait or studio image (optional)" },
  practice: "A paragraph on the artistic practice: media, methods and current concerns.",
  curatorial: "A paragraph on curatorial interests: the kinds of exhibitions, artists and questions she works with.",
  education: [
    { years: "Year", text: "Degree, institution, city" },
  ],
  experience: [
    { years: "Year", text: "Role, organisation" },
  ],
  selected: [
    { years: "Year", text: "Exhibition, publication or collaboration" },
  ],
};
