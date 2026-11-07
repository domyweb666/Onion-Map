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
if (fs.existsSync('tiles')) copyDir('tiles', 'www/tiles'); // 畫好的圖幅切成的圖磚
console.log('index.html + www/index.html built,', h.length, 'bytes');
