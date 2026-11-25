// --- 授權：設定 › 關於 › 授權。清單與全文由 build.js 從檔案組進 #licData（內容在 vendor/licenses/index.js） ---
(() => {
  const row = $('btnLic'), src = $('licData'); if (!row || !src) return;
  let data = null, items = [], at = 0; // at：清單捲到哪，從全文回來要在原地
  const load = () => { if (!data) { data = JSON.parse(src.textContent); items = data.groups.flatMap(g => g.items); } };
  const on = () => !!$('licSheet') && !$('sheetHost').hidden;
  const show = (title, back, html) => {
    const b = openSheet('<div id="licSheet"><div class="licBar">' +
      (back ? '<button class="licBtn" id="licBack"><svg class="chev" aria-hidden="true"><use href="#i-chev"/></svg>授權</button>' : '<span></span>') +
      '<button class="licBtn" data-close>關閉</button></div>' +
      '<h2 id="licT" tabindex="-1">' + esc(title) + '</h2>' + html + '</div>');
    b.setAttribute('aria-labelledby', 'licT');
    return b;
  };

  function list(focus) {
    let n = 0;
    const b = show('授權', false, data.groups.map(g => '<div class="section"><h3>' + esc(g.t) + '</h3><div class="group">' +
      g.items.map(i => '<button class="row" data-lic="' + n++ + '"><span class="lines"><span class="ttl">' + esc(i.name) + '</span><span class="meta">' + esc(i.lic) + '</span></span><svg class="chev" aria-hidden="true"><use href="#i-chev"/></svg></button>').join('') +
      '</div></div>').join(''));
    const rows = b.querySelectorAll('[data-lic]');
    rows.forEach(r => r.onclick = () => { at = b.scrollTop; detail(+r.dataset.lic); });
    if (focus >= 0) { b.scrollTop = at; rows[focus].focus({ preventScroll: true }); } else $('licT').focus({ preventScroll: true });
  }
  function detail(k) {
    const i = items[k];
    const b = show(i.name, true, '<p class="licAbout">' + esc(i.lic) + '<br>' + esc(i.about) + '</p>' +
      (i.urls.length ? '<div class="group">' + i.urls.map(u => '<a class="row" href="' + esc(u) + '" target="_blank" rel="noopener"><span class="lbl">' + esc(u.replace(/^https?:\/\/(www\.)?|\/$/g, '')) + '</span><svg class="chev" aria-hidden="true"><use href="#i-chev"/></svg></a>').join('') + '</div>' : '') +
      i.parts.map(([h, x]) => '<div class="section">' + (h ? '<h3>' + esc(h) + '</h3>' : '') + '<div class="licText">' + esc(data.texts[x]) + '</div></div>').join(''));
    b.querySelector('#licBack').onclick = () => list(k);
    $('licT').focus({ preventScroll: true });
  }

  row.onclick = () => { load(); list(); };
  document.addEventListener('onion:sheetclosed', () => {
    if ($('sheetBody').getAttribute('aria-labelledby') !== 'licT') return;
    $('sheetBody').removeAttribute('aria-labelledby');
    if (!on()) row.focus({ preventScroll: true });
  });
})();
