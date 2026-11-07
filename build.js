// 把 src/index.src.html 裡的佔位符換成程式庫，輸出單一檔案 index.html
// 用法：npm install && npm run build
const fs = require('fs');
let h = fs.readFileSync('src/index.src.html', 'utf8');
const put = (key, file) => { h = h.split(key).join(fs.readFileSync(file, 'utf8')); };
put('/*@@MAPLIBRE_CSS@@*/', 'node_modules/maplibre-gl/dist/maplibre-gl.css');
put('/*@@H3_JS@@*/', 'node_modules/h3-js/dist/h3-js.umd.js');
put('/*@@MAPLIBRE_JS@@*/', 'node_modules/maplibre-gl/dist/maplibre-gl.js');
fs.writeFileSync('index.html', h);
console.log('index.html built,', h.length, 'bytes');
