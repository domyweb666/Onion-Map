# Handoff：多米先真機測幾天，還沒要上架

> 產出時間：2026-11-25 18:14
> 分支 paint-cli。repo 是公開的。不要把真實軌跡、電腦裡的檔名與路徑、帳號、金鑰資訊寫進 git

## ✅ 這次完成了什麼

- TestFlight 1.0（19）15:33 上傳成功（金鑰還原在 ios/ci/asc_key.mjs），裡面沒有下面這些
- 上架指南第七節第 4、5、6、7、11、12、13 項（commit 4723cc3）：User-Agent、地圖出處、授權頁、固定 Xcode 26、匯入頁、清除紀錄
- 拿掉自動補附近 10 公里的圖磚（多米同意，OpenFreeMap 條款），只留看過的與自己按的縣市下載。別加回來
- 落雁體改名 Onion Hand（OFL 不准改過的字型沿用原名）：fonts/OnionHand.woff2、fonts/glyphs/OnionHand、CSS 名 OnionHand。字形逐一比過沒變，測試會擋原名
- 順手：分享的圖補地圖出處。`MAP_CREDIT` 在 58-cardui.js；一日卡放不下時折兩行；「走過的地方」那張放在地圖最下緣
- 驗證：test:app 132 項全過；瀏覽器 375 寬淺色深色、四款框兩種尺寸、授權 18 項、清除紀錄都看過

## 🚧 還沒做完

- 真機沒驗：User-Agent 有沒有真的帶出去、iOS 暫存資料夾的匯出檔有沒有清掉、授權頁的 VoiceOver
- 多米還沒回：上架指南第一節四件事

## ⏭️ 下一步從哪繼續

1. 等多米真機回報（照 docs/上架指南.md 第六節），修問題。上架的事先停，不要催第一節四件事，也不要動第七節第 8、9 項（請 ChatGPT 畫、iPad 都先留著）
2. 出新版要多米先說好：`gh workflow run ios.yml -R domyweb666/Onion-Map --ref paint-cli -f testflight=true`。build 19 沒有 15:33 之後的改動

## 📌 關鍵決策

- 2026-11-25 多米：現在還沒要上架，先真機實測幾天再說
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

- [x] A：修金鑰還原並重跑上傳
- [x] B1：第七節第 4、5、6、7、11、12、13 項
- [ ] B2：第七節第 8、9 項｜逐項完成並驗｜看那張表｜先停，等多米說要上架
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
匯入沒拿真實匯出檔試過。離線圖磚存 WKWebView 的 IndexedDB，會不會進 iCloud 備份沒查。
備份不含畫好的圖。城堡框署名靠近盾牌、會壓到一點葉子；範圍很大的卡沒有區名。
server/painter 沒跟上「畫好沒拿走再送給同號」。tools/daycard/overlay_frame.py 還是整片染框。

## 別動

daycard/2026-11-07/card_1080.png、draft.png 的改動與 sheets/taipei/painted_v*.png、painted_cli.png 是更早會話留的，沒進 commit。

## 🗑️ 雜訊

- Bash 的 heredoc 會把雙反斜線折成一個，要反斜線用 chr(92)
- Bash 工具不要用 `python -`；gh、git push 後面接 `</dev/null`
- 測假資料用 127.0.0.1:8787，別動 localhost 的資料
