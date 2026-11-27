/* Builds one printable ticket (DOM) in the original Gaana Tambola layout. */
window.GT_CARD = (grid, no, code) => {
  const songs = {};
  for (const [n, title, movie] of window.GT_DATA.songs) songs[n] = { title, movie };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = document.createElement('div');
  el.className = 'tk';
  let html = `<div class="tk-head"><span class="t">GAANA TAMBOLA</span>`
    + `<span class="name">Name: ________________________________</span><span class="no">Ticket No. ${esc(window.GT_TICKETS.label(code, no))}</span></div><div class="cells">`;
  for (const row of grid) for (const n of row) {
    html += n ? `<div><b>${n}</b><span class="song">${esc(songs[n].title)}</span><span class="film">${esc(songs[n].movie)}</span></div>` : '<div class="blank"></div>';
  }
  el.innerHTML = html + '</div>';
  return el;
};
