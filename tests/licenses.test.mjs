// node --test tests/licenses.test.mjs　授權頁：每一項都有全文、版本對得上、打包進 index.html 沒弄壞頁面
// index.html 是 npm run build 的產物，改了授權內容要先 build 再跑這支
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), L = require('../vendor/licenses');
const at = p => new URL('../' + p, import.meta.url), text = p => fs.readFileSync(at(p), 'utf8').replace(/\r\n/g, '\n');
const data = L.collect(), items = data.groups.flatMap(g => g.items), raw = L.groups().flatMap(g => g.items);
const html = text('index.html');
const full = name => { const i = items.find(x => x.name.startsWith(name)); assert.ok(i, name); return i.parts.map(p => data.texts[p[1]]).join('\n'); };

test('每一項都有名稱、授權種類、說明、全文，連結都是 https', () => {
  assert.ok(items.length >= 18);
  assert.equal(new Set(items.map(i => i.name)).size, items.length, '名稱不重複');
  for (const i of items) {
    assert.ok(i.name && i.lic && i.about && i.parts.length, i.name);
    for (const [, x] of i.parts) assert.ok(data.texts[x].trim().length > 100, i.name + ' 的全文是空的或太短');
    for (const u of i.urls) assert.match(u, /^https:\/\/[^\s"'<>]+$/);
    assert.doesNotMatch(i.name + i.lic + i.about, /[—–]|不是.*而是/, i.name);
  }
});

test('npm 套件：版本跟 node_modules 一樣；package.json 的依賴與 build.js 打包的都有列', () => {
  for (const r of raw) for (const p of [r.pkg, ...(r.also || [])].filter(Boolean)) {
    const v = JSON.parse(text('node_modules/' + p + '/package.json')).version;
    assert.ok(items.some(i => i.name === r.name + ' ' + v), p + ' ' + v);
  }
  const listed = new Set(raw.flatMap(r => [r.pkg, ...(r.also || [])]));
  const need = new Set(Object.keys(JSON.parse(text('package.json')).dependencies));
  for (const m of text('build.js').matchAll(/node_modules\/((?:@[^/'"]+\/)?[^/'"]+)\//g)) need.add(m[1]);
  for (const p of need) assert.ok(listed.has(p), p + ' 沒有列在授權頁');
});

test('iOS 的 Swift 套件都有列，版本對得上', () => {
  const pk = text('node_modules/@capacitor/filesystem/Package.swift');
  const remote = ['ios/App/CapApp-SPM/Package.swift', ...['@capacitor/filesystem', '@capacitor/share', '@capacitor-community/background-geolocation'].map(p => 'node_modules/' + p + '/Package.swift')]
    .flatMap(f => [...text(f).matchAll(/url:\s*"https:\/\/github\.com\/([^"]+?)(?:\.git)?"/g)].map(m => m[1]));
  assert.deepEqual([...new Set(remote)].sort(), ['ionic-team/capacitor-swift-pm', 'ionic-team/ion-ios-filesystem'], '多了新的 Swift 套件，授權頁要補');
  const v = /ion-ios-filesystem\.git",\s*exact:\s*"([^"]+)"/.exec(pk)[1];
  assert.ok(items.some(i => i.name === 'IONFilesystemLib ' + v));
  const cdv = /CORDOVA_VERSION_MIN_REQUIRED __CORDOVA_(\d+_\d+_\d+)/.exec(text('node_modules/@capacitor/ios/CapacitorCordova/CapacitorCordova/Classes/Public/CDVAvailability.h'))[1].replaceAll('_', '.');
  assert.ok(L.vendored['cordova-ios-' + cdv + '-LICENSE.txt'], 'Cordova 換到 ' + cdv);
});

test('MapLibre 打包進來的套件一個不漏', () => {
  const map = JSON.parse(text('node_modules/maplibre-gl/dist/maplibre-gl.js.map')), have = new Set(L.MAPLIBRE_PARTS.map(p => p[0]));
  const inside = new Set(map.sources.map(s => /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(s)?.[1]).filter(Boolean));
  assert.ok(inside.size > 10);
  for (const p of inside) assert.ok(have.has(p), p);
  for (const s of ['MapLibre contributors', 'Copyright (c) 2020, Mapbox', 'Evan Wallace', 'Mike Bostock']) assert.ok(full('MapLibre GL JS').includes(s), s);
  assert.ok(full('MapLibre 用到的套件').includes('Gary Court'), 'murmurhash-js 的授權在 README');
});

test('資料來源：地形的來源逐條都在，內政部照規定的寫法', () => {
  const t = full('Terrain Tiles');
  for (const s of ['ArcticDEM', 'Geoscience Australia', 'offene Daten Österreichs', 'Open Government\n  Licence – Canada', 'EU-DEM layers', 'ETOPO1', 'INEGI, Continental relief, 2016', 'Land Information New\n  Zealand', '© Kartverket', '© Environment Agency', 'U.S. Geological Survey']) assert.ok(t.includes(s), s);
  const m = full('鄉鎮市區界線');
  for (const s of ['內政部國土測繪中心', '鄉鎮市區界線(TWD97經緯度)', '此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。', '政府資料開放授權條款：https://data.gov.tw/license']) assert.ok(m.includes(s), s);
  assert.ok(items.some(i => i.urls.includes('https://www.openstreetmap.org/copyright')));
  assert.ok(items.some(i => i.urls.includes('https://www.openmaptiles.org/')));
});

test('index.html 裡的授權跟現在的檔案一樣，辰宇落雁體的 OFL 全文在裡面', () => {
  const m = /<script type="application\/json" id="licData">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, '找不到 licData');
  assert.ok(!m[1].includes('<'), '內文的 < 要換掉');
  assert.ok(!html.includes('@@LICENSES@@'));
  const got = JSON.parse(m[1]);
  assert.deepEqual(got, data, '授權內容改過，先跑 npm run build');
  const ofl = text('fonts/OnionHand-OFL.txt').trim();
  assert.ok(got.texts.includes(ofl)); assert.ok(ofl.includes('SIL OPEN FONT LICENSE Version 1.1') && ofl.includes('OTHER DEALINGS IN THE'));
});

test('改過的字型不沿用保留的名字（OFL 第 3 條）', () => {
  const dir = new URL('../fonts/', import.meta.url);
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    assert.ok(!/luoyan|落雁/i.test(f), f);
    if (f.endsWith('.pbf')) assert.ok(!/luoyan/i.test(fs.readFileSync(new URL(f.split(path.sep).join('/'), dir), 'latin1')), f);
  }
});

test('index.html 沒有被授權內文弄壞', () => {
  const n = (s, re) => (s.match(re) || []).length, src = text('src/index.src.html');
  // 拿掉授權之後，script 標籤的數目不變：授權只多了 src 裡寫好的那一個
  const bare = html.replace(/(id="licData">)[\s\S]*?(<\/script>)/, '$1$2');
  for (const re of [/<script\b/g, /<\/script>/g, /<style\b/g, /<\/style>/g, /<!--/g, /<\/body>/g]) assert.equal(n(html, re), n(bare, re), String(re));
  assert.equal(n(src, /id="licData"/g), 1); assert.equal(n(src, /id="btnLic"/g), 1);
  assert.equal(n(html, /id="licData"/g), 1); assert.equal(n(html, /id="btnLic"/g), 1);
  assert.ok(html.trimEnd().endsWith('</html>'));
  // 內文裡真的有 </script> 也不會跑出來
  assert.ok(!JSON.stringify('</script><!--').replace(/</g, '\\u003c').includes('<'));
  // 主程式還在授權後面，而且語法沒壞
  const app = html.slice(html.indexOf('id="licData"')), js = /<script>\n?([\s\S]*)<\/script>\s*<\/body>/.exec(app);
  assert.ok(js); new Function(js[1]);
});
