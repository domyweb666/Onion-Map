// 從 domy-design repo 抓最新的 tokens.json 進來（CI 拿不到私人 repo，所以複製一份進 vendor/）
// 用法：node tools/sync-domy-tokens.js [domy-design 的路徑，預設 ../../domy-design]
const fs = require('fs'), path = require('path');
const src = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '..', 'domy-design'), 'tokens', 'tokens.json');
const dst = path.join(__dirname, '..', 'vendor', 'domy-design', 'tokens.json');
const t = JSON.parse(fs.readFileSync(src, 'utf8'));
fs.writeFileSync(dst, fs.readFileSync(src));
console.log('domy tokens v' + t.version + ' →', dst);
