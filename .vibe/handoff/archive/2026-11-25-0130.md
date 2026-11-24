# Handoff：分支 paint-cli，五包程式都寫完，剩整合驗證、大量資料卡頓、文件

> 產出時間：2026-11-25 01:30
> repo 是公開的。不要把真實軌跡、電腦裡的檔名、帳號寫進 git

## 多米這次要的

1. 地圖畫風走 CLI：手機掃電腦上的 QR 配對，電腦用 Codex CLI 叫 ChatGPT 畫，圖傳回手機
2. 一次做完：一日地圖卡進 app（含小後端：金鑰、每日配額）、IG 4:5、真實軌跡試一張、頭尾剪 300 公尺預設開、地點命名與停留主動問、匯入 GPX 與 Google 時間軸、離線地圖、印章、Widget、Live Activity、拆四種退役畫法

沒要做：TestFlight、飛機誤判撤銷（多米沒點）

## ✅ 已完成（都在 paint-cli）

- f65b74e 拆退役畫法、主程式拆成 src/js 與 src/css 模組、預設黑霧、存檔改逐日分片（讀不到就鎖住不存）。瀏覽器測過重開留得住
- 04b48d6 tools/painter（電腦版，13 項測試過，真的用 Codex 畫過一張：157 秒、1024×1536、跟原圖位移約 4 像素）與 server/painter（Cloudflare Worker，17 項測試過，沒部署）
- 38ae745 iOS 掃碼外掛、小工具、即時動態、隱私清單、CI。雲端編譯第一次就綠（run 45445181380），小工具有包進 .app，自己的 Swift 零警告
- 577aa3d 地點、停留點提問、印章（33 項測試過）
- 8929e95、603e888 日卡、對位、AI 底圖、配對客戶端（17 項測試過），瀏覽器看過兩種比例四款框
- 包 D 匯入與離線（43 項測試過，瀏覽器封掉網路後看過的地方畫得出來）；存檔卡死的錯（沒東西可存時呼叫 flushSave 之後就全不存）已修，圖磚網址已改走 onion 協定。全部 node 測試 93 項過；瀏覽器驗過連續空存之後還存得進去、地圖走 onion 協定載得出來

## 📌 關鍵決策

- 電腦版與雲端版同一套 API，提示詞放服務端；送出去的底稿沒有路線、沒有字
- 底圖是黑霧加色鉛筆地圖，台北圖幅與 AI 底圖疊在上面，z13.6 起淡出
- 板子位置固定不動；路線用放大範圍（最多 1.3 倍，起終點被蓋才到 1.6）避開板子
- 「洋蔥第 N 層」改成「第 N 天出門」
- ChatGPT Go 額度：畫一張約 3%，一個月約三十張，所以每次畫之前都先問一句
- gpt-image-1 在 2026-10-23 關了，雲端版預設 gpt-image-2.6-sunburst（子代理查的，沒實叫過）

## 📂 最重要的檔案

- docs/模組約定.md ← 全域、掛點、API、分工
- src/js/00-engine.js、15-store.js、20-map.js、45-sheets.js
- tools/painter/README.md、server/painter/README.md
- tools/limrun/test.mjs ← 走流程腳本，給權限、餵走路

## ⏭️ 下一步從哪繼續

1. 先做 F：瀏覽器確認地圖還載得出來、存檔重開留得住
2. 照下面工作包往下做

## 🧩 剩下的工作

- [x] D 匯入、離線
- [ ] K 大量資料卡頓：6 萬格 render() 一次 6.4 秒（freq 佔 5.2 秒），匯入好幾年必踩。freq 與 revealCells 只算視野外擴半屏、moveend 重算；revealCells 先把 cellToParent 去重再 gridDisk（530→127ms）；addCell 的 cellToParent 可用 c.slice(0,7) 快取｜6 萬格 render 低於 0.3 秒｜src/js/20-map.js、00-engine.js｜無
- [ ] L 設定頁有「匯入以前的足跡」也認備份檔，原本的「匯入備份」列可拿掉；C、B 可以聽 onion:imported｜src/index.src.html、35-data.js、62、64、52｜無
- [ ] F 整合驗證：npm run build、全部 node --test、瀏覽器 375×812 走四頁淺深色，console 無錯誤｜截圖看過間距（不同性質至少 24）｜有問題才改｜依賴 K
- [ ] G 小修：50-card.js 的 loadFrame 把半透明像素都染焦褐，「花藤環繞」內側葉子變黑；getContext 加 willReadFrequently｜四款框看過｜src/js/50-card.js｜無
- [ ] H 電腦與瀏覽器整條實走：ONION_FAKE=1 開 tools/painter，app 配對、送畫、收圖、分享｜整條走通｜無｜依賴 F
- [ ] I push、看 CI、Limrun 走一遍（四頁、即時動態、日卡頁、設定頁；小工具清單在雲端模擬器是空的看不到）｜測完一定刪機器｜tools/limrun/test.mjs｜依賴 F、G
- [ ] J 文件：README、docs/iOS建置說明.md（secret 7 個改 8 個、App Groups 要勾、雲端後端上線時隱私清單與定位說明要改）、package.json 加 test 指令、記憶 onion-map 檔｜照多米的寫作守則｜依賴 I

## 🙋 要多米給或決定（最後一起問）

- 真實軌跡：從手機匯出 Google 時間軸或洋蔥備份，放 repo 外面
- 雲端後端部署：Cloudflare 帳號、OpenAI 金鑰與花費上限、每天幾張
- TestFlight 前置：App Group `group.org.domyweb.onion`、bundle id `org.domyweb.onion.widget`、兩個 profile
- 印章做了 23 個，比原本想的 12 到 16 多，要不要刪
- 手機實掃 QR、真 AI 底圖一張（會用額度）都還沒試

## ⚠️ 已知沒驗

匯入：沒拿真實匯出檔試過，Google 沒公開規格；200MB 以上只提示。離線：iOS 沒有 Wi-Fi 判斷，行動網路也會補圖磚；圖磚會不會進 iCloud 備份沒查。

iOS 真機全部沒測：離屏地圖、Worker 對位速度、分享、掃碼、區網 http、iOS 15 弱連結 ActivityKit。
AI 底圖沒有真成品；日卡真圖照新範圍畫還沒試。
印章只看已載入的圖磚，口袋裡走過的路要之後補發；新用戶累計不到 3 小時的點不算家，可能被問到家裡。
4:5 卡會出現「大安」這種老地名；2:3 左下「永和區」貼到框花紋。

## 別動

工作區的 daycard/2026-11-07/card_1080.png、draft.png 改動與 sheets/taipei/painted_v*.png 兩張未追蹤圖是更早會話留的，沒進 commit。daycard/app-preview/ 與 daycard/2026-11-07/painted_cli.png 是預覽，也沒進 commit。

## 🗑️ 雜訊

- Bash 工具不要用 `python -`（會等 stdin 卡住）；gh、git push 後面接 `</dev/null`
