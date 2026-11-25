// 設定 › 關於 › 授權 的內容。全文一律從檔案讀，不手抄：
//   npm 套件讀 node_modules 裡的 LICENSE；npm 沒有的（Swift 套件、字型、資料）放在這個資料夾，下面 vendored 記從哪裡抓的
// build.js 打包時呼叫 toJSON()，塞進 index.html 的 #licData；tests/licenses.test.mjs 也用它
// 加套件、換版本時：改這裡，跑 npm run build 和 npm run test:app
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
const nm = (pkg, file) => read('node_modules/' + pkg + '/' + (file || 'LICENSE'));
const here = file => read('vendor/licenses/' + file);
const ver = pkg => JSON.parse(read('node_modules/' + pkg + '/package.json')).version;

// 這個資料夾裡每一份從哪裡抓的（2026-11-25）
const vendored = {
  'ion-ios-filesystem-2.0.1.txt': 'https://raw.githubusercontent.com/ionic-team/ion-ios-filesystem/2.0.1/LICENSE',
  'cordova-ios-4.5.4-LICENSE.txt': 'https://raw.githubusercontent.com/apache/cordova-ios/4.5.4/LICENSE',
  'cordova-ios-4.5.4-NOTICE.txt': 'https://raw.githubusercontent.com/apache/cordova-ios/4.5.4/NOTICE',
  'emscripten-1.38.43.txt': 'https://raw.githubusercontent.com/emscripten-core/emscripten/1.38.43/LICENSE',
  'noto-sans-OFL.txt': 'https://raw.githubusercontent.com/openmaptiles/fonts/master/noto-sans/LICENSE',
  'openmaptiles.txt': 'https://raw.githubusercontent.com/openmaptiles/openmaptiles/master/LICENSE.md',
  'openfreemap.txt': 'https://raw.githubusercontent.com/hyperknot/openfreemap/main/LICENSE.md',
  'ODbL-1.0.txt': 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/ODbL-1.0.txt',
  'CC-BY-4.0.txt': 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/CC-BY-4.0.txt',
  'terrain-tiles-attribution.txt': 'https://raw.githubusercontent.com/tilezen/joerd/master/docs/attribution.md',
  'taiwan-atlas-2021.9.20.txt': 'https://registry.npmjs.org/taiwan-atlas/-/taiwan-atlas-2021.9.20.tgz 裡的 package/LICENSE',
  'OGDL-Taiwan-1.0.txt': 'https://data.gov.tw/license 的網頁內文'
};

// maplibre-gl.js 裡打包進去的套件：照 maplibre-gl.js.map 的來源清單（quickselect 是先打包在 style-spec 裡的）。
// 打包當時各是哪一版查不到，所以只列名稱。[套件, 授權檔]
const MAPLIBRE_PARTS = [
  ['@mapbox/geojson-rewind', 'LICENSE.txt'], ['@mapbox/point-geometry', 'LICENSE'], ['@mapbox/tiny-sdf', 'LICENSE.txt'], ['@mapbox/unitbezier', 'LICENSE'],
  ['@mapbox/vector-tile', 'LICENSE.txt'], ['@mapbox/whoots-js', 'LICENSE.md'], ['@maplibre/maplibre-gl-style-spec', 'LICENSE.txt'], ['earcut', 'LICENSE'],
  ['geojson-vt', 'LICENSE'], ['gl-matrix', 'LICENSE.md'], ['ieee754', 'LICENSE'], ['kdbush', 'LICENSE'], ['murmurhash-js', 'README.md'], ['pbf', 'LICENSE'],
  ['potpack', 'LICENSE'], ['quickselect', 'LICENSE'], ['supercluster', 'LICENSE'], ['tinyqueue', 'LICENSE'], ['tslib', 'LICENSE.txt'], ['vt-pbf', 'LICENSE']
];
// murmurhash-js 沒有 LICENSE 檔，授權寫在 README 最後一節
function partText(pkg, file) {
  const t = nm(pkg, file); if (file !== 'README.md') return t;
  const i = t.indexOf('## License'); if (i < 0) throw new Error(pkg + ' 的 README 裡找不到授權');
  return t.slice(i).replace(/^## /, '');
}

// 地形資料要標的那一段：照 attribution.md 第一個 ``` 區塊，一個字不改
function terrain() {
  const t = here('terrain-tiles-attribution.txt'), m = /\*\*\*Required attribution:\*\*\*\n+```\n([\s\S]*?)\n```/.exec(t), i = t.indexOf('## The fine print');
  if (!m || i < 0) throw new Error('terrain-tiles-attribution.txt 的格式變了');
  return [['Required attribution', m[1]], ['The fine print', t.slice(i).replace(/^## The fine print\n+/, '')]];
}
// 縣市與鄉鎮界線：照政府資料開放授權條款第 1 版附件「顯名聲明」的三行
const MOI = '內政部國土測繪中心 2021 鄉鎮市區界線(TWD97經緯度)\n' +
  '此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。\n' +
  '政府資料開放授權條款：https://data.gov.tw/license';

// name 名稱、lic 授權、about 用在哪、urls 連結、parts [[小標, 全文]…]；npm 套件給 pkg，版本自己讀
const groups = () => [
  { t: '地圖資料', items: [
    { name: 'OpenStreetMap', lic: 'ODbL 1.0', about: '© OpenStreetMap contributors。道路、水、綠地、地名都來自這裡，資料依 Open Database License 授權。', urls: ['https://www.openstreetmap.org/copyright'], parts: [['ODbL 1.0', here('ODbL-1.0.txt')]] },
    { name: 'OpenMapTiles', lic: 'CC BY 4.0、BSD-3-Clause', about: '© OpenMapTiles。地圖資料的分類照它的規格。', urls: ['https://www.openmaptiles.org/'], parts: [['OpenMapTiles', here('openmaptiles.txt')], ['CC BY 4.0', here('CC-BY-4.0.txt')]] },
    { name: 'OpenFreeMap', lic: 'MIT', about: '地圖從這裡下載。', urls: ['https://openfreemap.org'], parts: [['', here('openfreemap.txt')]] },
    { name: 'Terrain Tiles', lic: '每個來源不同', about: '山的陰影用這份高度資料畫，從 AWS 的公開資料下載。', urls: ['https://registry.opendata.aws/terrain-tiles/', 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md'], parts: terrain() },
    { name: '鄉鎮市區界線', lic: '政府資料開放授權條款第 1 版', about: '用來算走過哪些縣市和鄉鎮。界線經過簡化。', urls: ['https://data.gov.tw/dataset/7441', 'https://data.gov.tw/license'], parts: [['顯名聲明', MOI], ['授權條款', here('OGDL-Taiwan-1.0.txt')]] },
    { name: 'taiwan-atlas 2021.9.20', lic: 'MIT', about: '鄉鎮市區界線是從它整理好的檔案轉的。', urls: ['https://github.com/dkaoster/taiwan-atlas'], parts: [['', here('taiwan-atlas-2021.9.20.txt')]] }
  ] },
  { t: '字型', items: [
    { name: '辰宇落雁體', lic: 'SIL OFL 1.1', about: '地圖和地圖卡上的手寫字。', urls: ['https://github.com/Chenyu-otf/chenyuluoyan_thin'], parts: [['', read('fonts/ChenYuluoyan-OFL.txt')]] },
    { name: 'Noto Sans', lic: 'SIL OFL 1.1', about: '外國文字的地名用這套。', urls: ['https://github.com/openmaptiles/fonts'], parts: [['', here('noto-sans-OFL.txt')]] }
  ] },
  { t: '程式', items: [
    { name: 'MapLibre GL JS', pkg: 'maplibre-gl', lic: 'BSD-3-Clause', about: '畫地圖。', urls: ['https://maplibre.org/'], parts: [['', nm('maplibre-gl', 'LICENSE.txt')]] },
    { name: 'MapLibre 用到的套件', lic: 'BSD、ISC、MIT、0BSD', about: '跟著 MapLibre GL JS 一起進來的 ' + MAPLIBRE_PARTS.length + ' 個套件。', urls: [], parts: MAPLIBRE_PARTS.map(([p, f]) => [p, partText(p, f)]) },
    { name: 'h3-js', pkg: 'h3-js', lic: 'Apache-2.0', about: '把地圖分成六角格。', urls: ['https://github.com/uber/h3-js'], parts: [['NOTICE', nm('h3-js', 'NOTICE')], ['LICENSE', nm('h3-js')]] },
    { name: 'Emscripten', lic: 'MIT、NCSA', about: 'h3-js 用它做出來的。', urls: ['https://emscripten.org/'], parts: [['', here('emscripten-1.38.43.txt')]] },
    { name: 'Capacitor', pkg: '@capacitor/core', also: ['@capacitor/ios'], lic: 'MIT', about: '把網頁包成 iPhone app。', urls: ['https://capacitorjs.com'], parts: [['', nm('@capacitor/core')]] },
    { name: 'Apache Cordova iOS', lic: 'Apache-2.0', about: 'Capacitor 的 iOS 版裡有它的程式。', urls: ['https://github.com/apache/cordova-ios'], parts: [['NOTICE', here('cordova-ios-4.5.4-NOTICE.txt')], ['LICENSE', here('cordova-ios-4.5.4-LICENSE.txt')]] },
    { name: 'Capacitor Filesystem', pkg: '@capacitor/filesystem', lic: 'MIT', about: '存檔。', urls: ['https://github.com/ionic-team/capacitor-filesystem'], parts: [['', nm('@capacitor/filesystem')]] },
    { name: 'IONFilesystemLib 2.0.1', lic: 'MIT', about: 'Capacitor Filesystem 用到的。', urls: ['https://github.com/ionic-team/ion-ios-filesystem'], parts: [['', here('ion-ios-filesystem-2.0.1.txt')]] },
    { name: 'Capacitor Share', pkg: '@capacitor/share', lic: 'MIT', about: '分享。', urls: ['https://github.com/ionic-team/capacitor-plugins'], parts: [['', nm('@capacitor/share')]] },
    { name: 'Background Geolocation', pkg: '@capacitor-community/background-geolocation', lic: 'MIT', about: '背景定位。', urls: ['https://github.com/capacitor-community/background-geolocation'], parts: [['', nm('@capacitor-community/background-geolocation')]] }
  ] }
];

// → { groups:[{t, items:[{name, lic, about, urls, parts:[[小標, texts 的第幾個]…]}]}], texts:[全文…] }（一樣的全文只存一份）
function collect() {
  const texts = [], idx = new Map();
  const put = s => { if (!s) throw new Error('有一份授權是空的'); if (!idx.has(s)) { idx.set(s, texts.length); texts.push(s); } return idx.get(s); };
  const out = groups().map(g => ({ t: g.t, items: g.items.map(i => {
    const v = i.pkg && ver(i.pkg);
    for (const p of i.also || []) if (ver(p) !== v || nm(p) !== nm(i.pkg)) throw new Error(p + ' 跟 ' + i.pkg + ' 的版本或授權不一樣，要分開列');
    return { name: i.name + (v ? ' ' + v : ''), lic: i.lic, about: i.about, urls: i.urls, parts: i.parts.map(([h, s]) => [h, put(s)]) };
  }) }));
  return { groups: out, texts };
}
// 放進 <script type="application/json">：把 < 換掉，內文就算有 </script> 或 <!-- 也不會弄壞頁面
const toJSON = () => JSON.stringify(collect()).replace(/</g, '\\u003c');

module.exports = { collect, toJSON, groups, vendored, MAPLIBRE_PARTS, ver };
