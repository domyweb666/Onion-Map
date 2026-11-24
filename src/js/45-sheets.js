// ===== 畫好的底圖：疊在色鉛筆地圖上、霧的下面。拉太近時淡出，換回看得清街道的色鉛筆地圖 =====
// 內建的圖幅由 tools/sheet/cut_tiles.py 產生，bounds 抄 tiles/<sheet>/meta.json
const SHEETS = [
  { id: 'taipei', tiles: 'tiles/taipei/{z}/{x}/{y}.webp', bounds: [121.289062, 24.846565, 121.772461, 25.324167], minzoom: 9, maxzoom: 13 }
];
const SHEET_FADE = ['interpolate', ['linear'], ['zoom'], 13.6, 1, 14.4, 0];
const SHEET_TOP = 'freq'; // 底圖都插在這一層下面
function addSheets() {
  for (const s of SHEETS) {
    map.addSource('sheet-' + s.id, { type: 'raster', tiles: [s.tiles], tileSize: 256, bounds: s.bounds, minzoom: s.minzoom, maxzoom: s.maxzoom });
    map.addLayer({ id: 'sheet-' + s.id, type: 'raster', source: 'sheet-' + s.id, maxzoom: 14.5, paint: { 'raster-fade-duration': 0, 'raster-opacity': SHEET_FADE } }, SHEET_TOP);
  }
}
