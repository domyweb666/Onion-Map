// --- 手札頁面元素：鉛筆顆粒、標題日期、比例尺、圖例 ---
(function grain() { // 整頁疊一層淡淡的顆粒，用 multiply 混合，像色鉛筆畫在粗紙上
  const n = 96, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), d = g.createImageData(n, n);
  for (let i = 0; i < d.data.length; i += 4) { const v = 222 + Math.random() * 33; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0); $('grain').style.backgroundImage = 'url(' + c.toDataURL() + ')';
})();
map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');
function buildLegend() {
  const rows = [['沒去過（迷霧）', null, 'mist'], ['走過的路', null, 'track'], ['森林', 'trees', 'pattern'], ['草地、公園', 'grass', 'pattern'],
    ['湖泊、河流', 'water-hatch', 'pattern'], ['農田', 'farm', 'pattern'], ['主要道路', null, 'road'], ['高速公路', null, 'hwy'],
    ['村莊', 'village', 'icon'], ['城鎮', 'church', 'icon'], ['城市', 'castle', 'icon'], ['山頂', 'peak', 'icon']];
  $('legendRows').innerHTML = rows.map(([label, id, kind]) => {
    let sw;
    if (kind === 'pattern') { const c = tileCanvas(id); sw = '<i style="background-image:url(' + c.toDataURL() + ');background-size:' + (c.width / 2) + 'px ' + (c.height / 2) + 'px"></i>'; }
    else if (kind === 'icon') sw = '<i style="background:#F3ECDB url(' + tileCanvas(id).toDataURL() + ') center/auto 70% no-repeat"></i>';
    else sw = '<i class="' + kind + '"></i>';
    return '<div>' + sw + '<span>' + label + '</span></div>';
  }).join('');
}
$('btnLegend').onclick = () => { buildLegend(); $('legend').hidden = false; };
$('btnLegendClose').onclick = () => { $('legend').hidden = true; };
$('legend').onclick = e => { if (e.target === $('legend')) $('legend').hidden = true; };

