// --- 資料：備份、匯入、清除 ---
function refreshData() {
  const s = engine.state();
  $('dCells').textContent = Object.keys(s.cells).length.toLocaleString() + ' 個';
  $('dPts').textContent = Object.values(s.days).reduce((a, d) => a + d.n, 0).toLocaleString() + ' 個';
  $('dFl').textContent = s.flights.length + ' 段';
  $('dataInfo').textContent = NATIVE
    ? '資料存在這支手機的洋蔥 app 裡，會跟著 iCloud 的手機備份走；刪掉 app 就沒了，記得定期匯出備份。'
    : '資料只存在這支手機的瀏覽器裡，清除 Safari 網站資料就會消失，記得定期下載備份。';
  const c = $('btnClear'); c.dataset.arm = ''; c.querySelector('.lbl').textContent = '清除全部紀錄';
}
$('btnExport').onclick = async () => {
  const json = JSON.stringify(await exportAll()), name = 'onion-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  if (NATIVE) {
    // WKWebView 裡 a.download 沒作用：先寫到暫存資料夾，再開 iOS 分享面板（可存到「檔案」、AirDrop、傳給自己）
    try {
      await FS.writeFile({ path: name, data: json, directory: 'CACHE', encoding: 'utf8' });
      const { uri } = await FS.getUri({ path: name, directory: 'CACHE' });
      await SHARE.share({ title: '洋蔥備份 ' + name, url: uri });
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('匯出失敗：' + (e.message || e)); }
    return;
  }
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
$('fileImport').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try { await importAll(JSON.parse(await file.text())); render(true); refreshData(); document.dispatchEvent(new Event('onion:restored')); toast('已匯入備份'); }
  catch (err) { toast('這個檔案讀不了'); }
  e.target.value = '';
};
$('btnClear').onclick = () => {
  const b = $('btnClear');
  if (!b.dataset.arm) { b.dataset.arm = '1'; b.querySelector('.lbl').textContent = '再按一次，確定全部清掉'; return; }
  wipeAll().then(() => { document.dispatchEvent(new Event('onion:wiped')); render(true); refreshData(); toast('已清除'); });
};
