// ===== 分頁：地圖一直在最底下活著（製圖要截它），其他三頁蓋在上面 =====
const PAGES = { steps: 'pgSteps', card: 'cardView', settings: 'pgSettings' };
let tab = 'map';
function go(next) {
  if (next === tab) return;
  if (tab === 'card') card.snap = null;
  tab = next; document.body.dataset.tab = next;
  for (const [k, id] of Object.entries(PAGES)) $(id).hidden = k !== next;
  document.querySelectorAll('#tabbar .tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === next));
  if (next === 'steps') renderSteps();
  else if (next === 'settings') refreshData();
  else if (next === 'card') enterCard();
  if (next !== 'map') $(PAGES[next]).scrollTop = 0;
  else map.resize();
  hook.tab.forEach(fn => fn(next));
}
document.querySelectorAll('#tabbar .tab').forEach(b => b.onclick = () => go(b.dataset.tab));
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

