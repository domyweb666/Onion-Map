// 把 src/index.src.html 裡的佔位符換成程式庫，輸出單一檔案
//   index.html      → GitHub Pages 直接發佈（網頁版）
//   www/index.html  → Capacitor 打包進 iOS app 用（之後跑 npx cap sync ios）
// 用法：npm install && npm run build
const fs = require('fs');
let h = fs.readFileSync('src/index.src.html', 'utf8');
const put = (key, file) => {
  if (!h.includes(key)) throw new Error('src/index.src.html 裡找不到佔位符 ' + key);
  h = h.split(key).join(fs.readFileSync(file, 'utf8'));
};
put('/*@@MAPLIBRE_CSS@@*/', 'node_modules/maplibre-gl/dist/maplibre-gl.css');
put('/*@@H3_JS@@*/', 'node_modules/h3-js/dist/h3-js.umd.js');
put('/*@@MAPLIBRE_JS@@*/', 'node_modules/maplibre-gl/dist/maplibre-gl.js');
// Capacitor 的瀏覽器版橋接（約 9KB）。在網頁上只是個空殼；在 iOS app 裡接到原生 plugin。
put('/*@@CAPACITOR_JS@@*/', 'node_modules/@capacitor/core/dist/capacitor.js');
// Rough.js：手繪抖線與排線填色（草稿模式用，約 40KB）
put('/*@@ROUGH_JS@@*/', 'node_modules/roughjs/bundled/rough.js');
// Domy Design 的代號 → CSS 變數。介面只准用 var(--d-*)，數值的唯一來源是 vendor/domy-design/tokens.json
// （改代號先跑 node tools/sync-domy-tokens.js，不要手改 CSS）
const DOMY_THEME = 'gold';
const domyCSS = (() => {
  const T = JSON.parse(fs.readFileSync('vendor/domy-design/tokens.json', 'utf8')), th = T.themes[DOMY_THEME];
  const kebab = s => s.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
  const colors = scheme => {
    const c = { ...T.neutral[scheme], canvas: T.canvas[th.canvas][scheme], ...th[scheme] };
    return Object.entries(c).map(([k, v]) => '--d-' + kebab(k) + ':' + v).join(';');
  };
  const v = [];
  for (const [k, t] of Object.entries(T.type)) v.push('--d-' + kebab(k) + ':' + t.weight + ' ' + t.size + 'px/' + t.lineHeight + 'px var(--d-font)');
  for (const [k, n] of Object.entries(T.space)) v.push('--d-space-' + k + ':' + n + 'px');
  for (const [k, n] of Object.entries(T.radius)) v.push('--d-radius-' + k + ':' + n + 'px');
  for (const [k, n] of Object.entries(T.size)) v.push('--d-size-' + kebab(k) + ':' + n + 'px');
  for (const [k, e] of Object.entries(T.elevation)) v.push('--d-elev-' + k + ':0 ' + e.offsetY + 'px ' + e.blur + 'px rgba(var(--d-shadow-rgb),' + e.opacity + ')');
  v.push('--d-press-scale:' + T.motion.pressScale, '--d-pressed-opacity:' + T.motion.pressedOpacity,
    '--d-press-ms:' + T.motion.pressDuration + 'ms', '--d-transition-ms:' + T.motion.transition + 'ms');
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',');
  return ':root{--d-font:-apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif;' + v.join(';') + ';' + colors('light') +
    ';--d-shadow-rgb:' + rgb(T.neutral.light.shadow) + ';color-scheme:light}' +
    '@media (prefers-color-scheme:dark){:root:not([data-theme=light]){' + colors('dark') + ';--d-shadow-rgb:' + rgb(T.neutral.dark.shadow) + ';color-scheme:dark}}' +
    ':root[data-theme=dark]{' + colors('dark') + ';--d-shadow-rgb:' + rgb(T.neutral.dark.shadow) + ';color-scheme:dark}' +
    '/* domy-design v' + T.version + ' · theme ' + DOMY_THEME + ' */';
})();
if (!h.includes('/*@@DOMY_CSS@@*/')) throw new Error('src/index.src.html 裡找不到佔位符 /*@@DOMY_CSS@@*/');
h = h.split('/*@@DOMY_CSS@@*/').join(domyCSS);
h = h.split('@@DOMY_VER@@').join(JSON.parse(fs.readFileSync('vendor/domy-design/tokens.json', 'utf8')).version);
fs.writeFileSync('index.html', h);
fs.mkdirSync('www', { recursive: true });
fs.writeFileSync('www/index.html', h);
// 手寫字型（woff2）與英數／標點的 glyph 也要進 app（fs.cpSync 在 Windows 的中文路徑上會悄悄掛掉，自己複製）
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const a = from + '/' + name, b = to + '/' + name;
    fs.statSync(a).isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
};
copyDir('fonts', 'www/fonts');
if (fs.existsSync('assets/sprites')) copyDir('assets/sprites', 'www/assets/sprites'); // 貼紙（材質只有離線拼圖幅用，不進 app）
if (fs.existsSync('assets/admin')) copyDir('assets/admin', 'www/assets/admin'); // 行政區界線（製圖的探索度用）
if (fs.existsSync('assets/frames')) { // 製圖用的邊框（只要 PNG；同名 json 是離線預覽用的）
  fs.mkdirSync('www/assets/frames', { recursive: true });
  for (const n of fs.readdirSync('assets/frames')) if (n.endsWith('.png')) fs.copyFileSync('assets/frames/' + n, 'www/assets/frames/' + n);
}
if (fs.existsSync('tiles')) copyDir('tiles', 'www/tiles'); // 畫好的圖幅切成的圖磚
console.log('index.html + www/index.html built,', h.length, 'bytes');
