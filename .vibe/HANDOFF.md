# Handoff：分支 paint-cli，程式與整合驗證做完，剩雲端模擬器走一遍

> 產出時間：2026-11-25 02:25
> repo 是公開的。不要把真實軌跡、電腦裡的檔名、帳號寫進 git

## 多米這次要的

1. 地圖畫風走 CLI：手機掃電腦上的 QR 配對，電腦用 Codex CLI 叫 ChatGPT 畫，圖傳回手機
2. 一次做完：一日地圖卡進 app（含小後端）、IG 4:5、真實軌跡試一張、頭尾剪 300 公尺預設開、地點命名與停留主動問、匯入 GPX 與 Google 時間軸、離線地圖、印章、Widget、Live Activity、拆四種退役畫法

沒要做：TestFlight、飛機誤判撤銷（多米沒點）

## ✅ 已完成（都在 paint-cli）

- 前一個會話：拆模組、日卡、AI 底圖、配對、電腦版與雲端版畫圖服務、地點、印章、匯入、離線、小工具、即時動態
- dffffff 大量足跡不卡頓（6 萬格：z8 636→26ms、z14 約 1.5 秒→0.1 秒）；匯入與備份併成「匯入足跡或備份」；還原備份先驗格式、先寫新的再刪舊的、手繪地圖與日卡留著；相框葉子不再變黑；README、建置說明、npm test
- d1fde37 CI 改走 npm run test:app，沒 Pillow 就略過
- c0cbf7b 整合驗證修正：十萬格還原 23 秒→3 秒、足跡與選一天分段列、44 點按區、畫圖不重畫同一張、密碼換過顯示重新配對、日卡地名只取現行行政區並避開框
- ccd5666 抽屜內容長時被壓扁裁掉（選一天捲不到底）修好
- 瀏覽器整條走過：ONION_FAKE=1 配對、送畫、收圖、四框兩比例、各種失敗路徑；備份、清除、還原在真 IndexedDB 驗過

## 📌 關鍵決策

- 電腦版與雲端版同一套 API，提示詞放服務端；送出去的底稿沒有路線、沒有字
- 底圖是黑霧加色鉛筆地圖，台北圖幅與 AI 底圖疊在上面，z13.6 起淡出
- 板子位置固定不動；路線用放大範圍避開板子
- ChatGPT Go 畫一張約 3%，每次畫之前都先問一句
- 霧與走過的次數只算視野外擴半屏；z<11 合併成小於 1.5 像素的上層格

## ⏭️ 下一步從哪繼續

看 `gh run list --branch paint-cli` 與 tools/limrun/shots/，把 I 做完

## 🧩 剩下的工作

- [x] K 卡頓　[x] L 匯入整併　[x] G 相框　[x] F 整合驗證　[x] H 配對畫圖實走　[x] J 文件
- [ ] I 雲端編譯三個 job 全綠；更新 tools/limrun/test.mjs 到現在的介面並走一遍（日卡、即時動態、設定頁抽屜、深色、重開），測完刪機器｜tools/limrun/test.mjs、有問題才改 src

## 🚀 TestFlight（2026-11-25 下午，步驟在 docs/上架指南.md）

- 已有 6 個 secret：APPLE_TEAM_ID、ASC_KEY_ID、ASC_ISSUER_ID、ASC_PRIVATE_KEY、兩個 profile。兩個 profile 驗過：bundle id、App Group、Apple Distribution 憑證都對，2027-10-31 到期
- 差多米放 IOS_P12_BASE64、IOS_P12_PASSWORD（私鑰與密碼，AI 不經手）。要用到期日 2027-10-31 那張憑證的 .p12
- ios.yml 的 testflight job 開頭會檢查 8 個 secret；金鑰改讀 ASC_PRIVATE_KEY。這個 job 還沒跑過
- 本機 commit 還沒 push。放齊後先問多米，再 push paint-cli、觸發 `gh workflow run ios.yml -R domyweb666/Onion-Map --ref paint-cli -f testflight=true`
- App Store Connect 有沒有建 App 紀錄還沒確認
- 設定 › 關於的「支援」「隱私權政策」連到 domyweb.org/tools/onion/，網頁還沒上線，多米說先不放

## 🙋 要多米給或決定

- 真實軌跡：從手機匯出 Google 時間軸或洋蔥備份，放 repo 外面
- 雲端後端部署：Cloudflare 帳號、OpenAI 金鑰與花費上限、每天幾張
- TestFlight 前置：App Group `group.org.domyweb.onion`、bundle id `org.domyweb.onion.widget`、兩個 profile（都辦好了，見上面 TestFlight）
- 印章 23 個要不要刪
- 手機實掃 QR、真 AI 底圖一張（會用額度）還沒試
- 待確認的小決定：地圖頁統計牌拿掉航線段數（375 寬放不下）、足跡先列 60 天、匯入的日子不問停留點、國外地名照舊、已畫好的舊卡老地名要重畫才換

## ⚠️ 已知沒驗

真機全部沒測：離屏地圖、對位速度、分享、掃碼、區網 http、iOS 15 弱連結、卡頓改善在 iPhone 上的數字。
匯入沒拿真實匯出檔試過。離線圖磚存 WKWebView 的 IndexedDB，會不會進 iCloud 備份沒查；行動網路也會補圖磚。
備份不含畫好的圖。城堡框署名靠近盾牌、會壓到一點葉子；範圍很大的卡沒有區名。
server/painter 沒跟上「畫好沒拿走再送給同號」。tools/daycard/overlay_frame.py 還是整片染框。

## 別動

daycard/2026-11-07/card_1080.png、draft.png 的改動與 sheets/taipei/painted_v*.png、painted_cli.png 是更早會話留的，沒進 commit。

## 🗑️ 雜訊

- Bash 工具不要用 `python -`；gh、git push 後面接 `</dev/null`；雙反斜線會被折成一個，含正則的改用 Edit
- 127.0.0.1:8787 與 localhost:8787 是不同來源，測假資料用 127.0.0.1，別動 localhost 的資料
