# Handoff：TestFlight 1.0（19）已上傳，等 Apple 處理與多米真機

> 產出時間：2026-11-25 15:40
> 分支 paint-cli。repo 是公開的。不要把真實軌跡、電腦裡的檔名與路徑、帳號、金鑰資訊寫進 git

## ✅ 這次完成了什麼

- 金鑰修好：`ASC_PRIVATE_KEY` 被擠成一行（內容完整），`ios/ci/asc_key.mjs` 還原成標準 PEM，還原不了會退到 `ASC_KEY_P8_BASE64`。測試在 tests/asc-key.test.mjs
- 上傳 job 開頭先驗金鑰、問 App Store Connect 有沒有這個 App，跑完刪金鑰檔
- run 45568611894：上傳 job 全綠，Apple 回 UPLOAD SUCCEEDED，build 19
- docs/上架指南.md 跟上

## 🚧 還沒做完

- 沒看過 App Store Connect 的處理結果（有沒有寄信說缺東西、出口合規有沒有跳），要多米看
- 內部測試群組還沒建，真機還沒測

## ⏭️ 下一步從哪繼續

1. 多米照 docs/上架指南.md 第五節建內部測試群組、裝起來，第六節 15 條逐條回
2. 有問題的修完，再 `gh workflow run ios.yml -R domyweb666/Onion-Map --ref paint-cli -f testflight=true` 出下一版。多米那句「上傳」用在 build 19，下一版要再問
3. 多米回了上架指南第一節四件事、點頭第七節之後，做工作包 B

## 📌 關鍵決策

- 兩個網頁（domyweb.org/tools/onion/）多米說還沒做好、先不放，他開口才上線。上線前 app 那兩列點了是 404
- 手動簽章（做法乙）；.p12 與密碼多米自己放，AI 不經手
- domyweb 的 GitHub Actions 預算用完，推 main 不會自動部署；要上線時先查線上是哪一版，`tool-sites-v2` 還沒併
- 給多米待選的四件事在 docs/上架指南.md 第一節（藏 AI 畫圖、只做 iPhone、名稱、地區），多米還沒回
- Apple 預告 2027 年 4 月起要 iOS 27 SDK 才能上傳，現在只是警告

## 📂 下個會話最重要的檔案

- docs/上架指南.md（第一、五、六、七節）
- .github/workflows/ios.yml（testflight job）、ios/ci/asc_key.mjs
- docs/模組約定.md（要改 src 才讀）

## 🧩 剩下的工作

- [x] A：修金鑰還原並重跑上傳｜Apple 收下 1.0（19）｜.github/workflows/ios.yml、ios/ci/asc_key.mjs｜無
- [ ] B：上架指南第七節「送審前」各項｜逐項完成並驗｜看那張表｜多米先點頭、第一節四件事先定
- [ ] C：多米真機回報的問題｜逐條修完再出一版｜看回報｜等多米

## 上一份交接還沒結的

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

- Bash 的 heredoc 會把雙反斜線折成一個，要反斜線用 chr(92)
- Bash 工具不要用 `python -`；gh、git push 後面接 `</dev/null`
- 測假資料用 127.0.0.1:8787，別動 localhost 的資料
