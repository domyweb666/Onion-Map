# Handoff：TestFlight 第一次上傳，簽章打包都過，卡在 API 金鑰格式

> 產出時間：2026-11-25 15:23
> 分支 paint-cli。repo 是公開的。不要把真實軌跡、電腦裡的檔名與路徑、帳號、金鑰資訊寫進 git

## ✅ 這次完成了什麼

- 寫了 docs/上架指南.md（含 TestFlight、送審前要補的清單、審查備註草稿）
- 設定 › 關於加「支援」「隱私權政策」；Info.plist 加「加入照片」說明；.gitignore 擋金鑰；兩個網頁的稿在 docs/網站頁/
- 兩個 profile 驗過（bundle id、App Group、憑證都對，2027-10-31 到期），8 個 secret 都在
- ios.yml 上傳 job 開頭檢查 8 個 secret，金鑰改讀 ASC_PRIVATE_KEY
- 推到 e4b61a3，觸發 run 45567246943（build 16）：JS 測試、編譯檢查、模擬器版、匯入憑證、裝 profile、Archive、匯出 IPA 全過，只有最後「上傳到 TestFlight」紅

## 🚧 還沒做完

- 上傳錯誤原文：`Failed to load AuthKey file. (-39) ... does not contain a valid authentication key.`
- secret 裡有 BEGIN PRIVATE KEY（開頭的檢查過了），所以是格式壞掉。推測是貼上時換行不見、變成一行（準則 2-24、12-4 記過一樣的事），沒有看過內容，待證實
- build 16 沒有傳上去，TestFlight 上還沒有任何版本

## ⏭️ 下一步從哪繼續

1. 改 .github/workflows/ios.yml 的「上傳到 TestFlight」：寫檔前把 ASC_PRIVATE_KEY 重排成標準 PEM（拿掉頭尾兩行與所有空白，每 64 字換行，再補頭尾），用 `openssl pkey -noout` 驗，不過就退到 ASC_KEY_P8_BASE64（多米後來也放了這個 secret）解 base64 再驗，都不過才報錯。只印形狀（行數、位元組數），不印內容。結尾 `if: always()` 刪金鑰檔。可參考人蔘修煉的 ios/ci/restore_asc_key.sh
2. 把這個驗證也搬到 job 最前面（「檢查 8 個 secret」那步），免得編完才知道
3. commit、push paint-cli、`gh workflow run ios.yml -R domyweb666/Onion-Map --ref paint-cli -f testflight=true`。多米 2026-11-25 說「上傳」，這次上傳的授權還在，修好重跑不用再問
4. 備案：請多米自己用指令從 .p8 檔重放 ASC_PRIVATE_KEY，換行就不會掉，再 `gh run rerun 45567246943 --failed`。金鑰內容 AI 不經手
5. 還可能卡的：App Store Connect 沒建 App（No suitable application records）、ASC_KEY_ID 對到別把金鑰（401）
6. 上傳過了：照 docs/上架指南.md 第五節請多米建內部測試群組，第六節真機驗

## 📌 關鍵決策

- 兩個網頁（domyweb.org/tools/onion/）多米說還沒做好、先不放，他開口才上線。上線前 app 那兩列點了是 404
- 手動簽章（做法乙）；.p12 與密碼多米自己放，AI 不經手
- domyweb 的 GitHub Actions 預算用完，推 main 不會自動部署；要上線時先查線上是哪一版，`tool-sites-v2` 還沒併
- 給多米待選的四件事在 docs/上架指南.md 第一節（藏 AI 畫圖、只做 iPhone、名稱、地區），多米還沒回

## 📂 下個會話最重要的檔案

- .github/workflows/ios.yml（testflight job）
- docs/上架指南.md（第四、七、十節）
- docs/模組約定.md（要改 src 才讀）

## 🧩 剩下的工作

- [ ] A：修金鑰還原並重跑上傳｜TestFlight 出現 1.0 的 build｜.github/workflows/ios.yml｜無
- [ ] B：上架指南第七節「送審前」各項｜逐項完成並驗｜看那張表｜多米先點頭、第一節四件事先定

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

- Bash 的 heredoc 會把雙反斜線折成一個，Python 腳本裡的 printf 反斜線會壞；比對字串避開反斜線
- Bash 工具不要用 `python -`；gh、git push 後面接 `</dev/null`
- 測假資料用 127.0.0.1:8787，別動 localhost 的資料
- ASC_KEY_P8_BASE64 是多出來的 secret，留著當備案
