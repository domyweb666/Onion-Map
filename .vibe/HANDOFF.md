# Handoff：分支 paint-cli，五包功能平行開發中（2026-11-25）

## 多米這次要的
1. 地圖畫風走 CLI：手機掃電腦上的 QR 配對，電腦用 Codex CLI 叫 ChatGPT 畫，圖傳回手機
2. 一次做完：一日地圖卡進 app（含小後端：金鑰、每日配額）、IG 4:5、真實軌跡試一張、頭尾剪 300 公尺預設開、地點命名與停留主動問、匯入 GPX 與 Google 時間軸、離線地圖、印章、Widget、Live Activity、拆四種退役畫法
MVP 還沒要做：TestFlight、飛機誤判撤銷（多米沒點）

## 已完成（主會話，commit f65b74e）
- src/index.src.html 拆成 src/js/*.js、src/css/*.css（build.js 照檔名順序接起來）
- 四種退役畫法與 roughjs 拆掉；預設改黑霧；台北圖幅疊在色鉛筆地圖上，z13.6 起淡出
- 存檔改逐日、分片（IndexedDB／Documents/onion/），讀不到就鎖住不存；備份 v2

## 進行中：五個子代理（分工與介面在 docs/模組約定.md）
A tools/painter、server/painter／B 日卡、對位、AI 底圖／C 地點、印章／D 匯入、離線／E iOS 原生與 CI
子代理不 commit 不 push。回來之後主會話要做：
1. 看 diff、處理「要主會話改的別人的檔」（D 會要改 20-map.js 的圖磚網址）
2. npm run build、node --test、瀏覽器 375x812 走四頁
3. commit、push paint-cli、看 CI（E 的 Swift 沒編譯過，預期要修）
4. Limrun 走一遍（tools/limrun/test.mjs，測完關機器）
5. 更新 README、docs/iOS建置說明.md、記憶

## 不能自己做、要問多米
- 雲端後端部署（Cloudflare、OpenAI 金鑰與花費上限）
- 真實軌跡：要多米從手機匯出 Google 時間軸或洋蔥備份，放 repo 外面，不進 git
- TestFlight 簽署與 App Group、widget bundle id

## 別動
工作區有 daycard/2026-11-07/card_1080.png、draft.png 的改動與 sheets/taipei/painted_v*.png 兩張未追蹤的圖，是更早的會話留的，沒進 commit
