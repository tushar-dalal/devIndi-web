// All of the site's content lives here. Edit this file to add works, curated projects and journal posts.
// Everything below is PLACEHOLDER text and generated artwork, to be swapped for Niemisha's real work.
//
// Artwork: until real photos exist, each piece shows a generated painting built from `seed` and `palette`.
// To use a real image, add  image: "images/your-file.jpg"  to the item (put the file in niemisha/images/).

window.SITE = {
  name: "Niemisha",
  role: "artist & curator",
  email: "hello@example.com", // TODO: replace with Niemisha's real email
  instagram: "",              // e.g. "https://instagram.com/…" — leave empty to hide
  location: "India",
};

// kind: "made" = her own artwork, "curated" = an exhibition or object collection she put together
window.WORKS = [
  {
    id: "afternoon-in-ochre", kind: "made", title: "Afternoon in Ochre", year: 2026,
    medium: "Gouache on handmade paper", size: "40 × 50 cm", seed: 11, palette: ["#ecbcaa", "#c96a4b", "#eccb7a", "#2e2622"],
    blurb: "Light falling across a kitchen floor, held for a moment.",
    body: [
      "This piece started as a sketch of the light on my grandmother's kitchen floor, the hour after lunch when everything goes quiet.",
      "I kept removing things until only the warmth was left: a shape for the window, a shape for the shadow, and the colour of the afternoon itself.",
    ],
  },
  {
    id: "small-weather", kind: "made", title: "Small Weather", year: 2026,
    medium: "Oil pastel and graphite", size: "30 × 30 cm", seed: 27, palette: ["#dfe3d3", "#9fae8c", "#7d5a6e", "#f7f0e6"],
    blurb: "A series about the moods that pass through a room.",
    body: [
      "Small Weather is a series of nine squares, each made in a single sitting.",
      "They're about the moods that pass through a room in a day: a little cloud of worry, a patch of sun, the stillness after a phone call.",
    ],
  },
  {
    id: "soft-architecture", kind: "made", title: "Soft Architecture", year: 2025,
    medium: "Clay, linen, pigment", size: "Variable", seed: 42, palette: ["#efe4d4", "#c96a4b", "#9fae8c", "#2e2622"],
    blurb: "Rooms you could hold in two hands.",
    body: [
      "Small clay rooms, each wrapped in dyed linen. I wanted to make buildings that felt like they could breathe.",
      "They were shown together on one long low table, so you had to bend down to look inside.",
    ],
  },
  {
    id: "the-blue-hour", kind: "made", title: "The Blue Hour", year: 2025,
    medium: "Watercolour", size: "21 × 29 cm", seed: 63, palette: ["#d9dde6", "#7d5a6e", "#ecbcaa", "#2e2622"],
    blurb: "Dusk, painted from memory, every evening for a month.",
    body: [
      "Thirty small paintings, one every evening for a month, always from memory and never from a photograph.",
      "Some days I remembered the sky. Some days I only remembered how it felt.",
    ],
  },
  {
    id: "found-and-kept", kind: "curated", title: "Found & Kept", year: 2026,
    medium: "Group exhibition · 14 artists", size: "Studio space, three weeks", seed: 88, palette: ["#f2e3c4", "#eccb7a", "#c96a4b", "#7d5a6e"],
    blurb: "An exhibition about the objects we can't throw away.",
    body: [
      "Found & Kept brought together fourteen artists and one question: what's the object you've carried through every move?",
      "Each artist showed a new work next to the object that inspired it. The objects turned out to be the quiet stars of the show.",
    ],
  },
  {
    id: "table-for-ten", kind: "curated", title: "Table for Ten", year: 2025,
    medium: "Object collection · ceramics & textiles", size: "Pop-up, one weekend", seed: 104, palette: ["#e7ead9", "#9fae8c", "#c96a4b", "#2e2622"],
    blurb: "Ten makers, one long table, everything on it for sale.",
    body: [
      "A single long dinner table, set with plates, cups, cloths and cutlery made by ten independent makers.",
      "Visitors could sit down, use everything, and take home what they loved.",
    ],
  },
];

window.POSTS = [
  {
    slug: "on-keeping-things", title: "On keeping things", date: "2026-10-04",
    excerpt: "Why I've started to think of curating as a kind of caretaking.",
    body: [
      "For a long time I thought of curating as choosing. Picking the best, leaving out the rest.",
      "Lately it feels more like caretaking. You're finding the right room, the right light and the right neighbours for something, so it can be seen properly.",
      "This post is a placeholder: Niemisha's real writing will go here.",
    ],
  },
  {
    slug: "a-month-of-dusk", title: "A month of dusk", date: "2026-08-19",
    excerpt: "Notes from painting the same sky thirty times.",
    body: [
      "The rule was simple: one painting every evening, from memory, no photographs.",
      "By the second week I'd stopped trying to get it right and started trying to get it true.",
      "This post is a placeholder: Niemisha's real writing will go here.",
    ],
  },
  {
    slug: "studio-notes-spring", title: "Studio notes, spring", date: "2026-04-02",
    excerpt: "Clay under my nails, a new table, and too many jars of pigment.",
    body: [
      "The studio moved this spring. Smaller room, bigger window, which is a trade I'd make every time.",
      "This post is a placeholder: Niemisha's real writing will go here.",
    ],
  },
];
