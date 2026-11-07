# Handoff: 洋蔥地圖包成 iOS、畫風做了三輪，草稿手繪 POC 成立，等多米拍板全面改

> 產出時間：2026-11-07 17:45
> 前一會話的最後狀態，給下一個會話接續用

## ✅ 這次完成了什麼

- clone domyweb666/Onion-Map 到 `E:\洋蔥地圖\Onion-Map`，讀完原型（H3 六角格迷霧地圖、MapLibre、速度判定交通方式、模擬模式）
- 用 Capacitor 8 包成 iOS app：背景定位 plugin、紀錄存 Documents、分享面板匯出、上次在記錄就自動續錄、Info.plist 權限文字、icon 與啟動畫面。分支 `ios-capacitor`，PR #1 → main，CI 綠，未簽署 IPA 拆開驗過
- 寫 `docs/iOS建置說明.md`（AltStore／Codemagic／GitHub Actions 三條裝機路）與 `docs/產品與技術路線分析.md`
- 畫風第一版（鋼筆手札）：手寫字型辰宇落雁體、雙線墨筆、建築排線、地形陰影。分支 `journal-style`，PR #2 → ios-capacitor
- 畫風第二版第一輪（色鉛筆探索地圖，用 MapLibre fill-pattern 做）：迷霧排線加「?」、綠排線已探索、黃路與路牌、樹圖示、山頂、聚落圖示、筆記本邊框、顆粒、比例尺、標題日期、圖例面板。分支 `style-v2`，疊在 journal-style 上。多米看了說不像他要的
- 草稿手繪 POC（Rough.js）：網址加 `?sketch=1`，MapLibre 只管圖資、鏡頭、迷霧的洞、地名路牌；路、河、水域、植被、迷霧改在一層 multiply 畫布上用 Rough.js 手畫。瀏覽器實測台北 z13 與 z15，多米看過截圖，方向對了
- CI：GitHub Actions 編譯檢查＋未簽署 IPA，`build-simulator` job 產模擬器 .app（給 limrun），手動 TestFlight；`codemagic.yaml` 自動簽署。`lim` CLI 已裝、未登入

## 🚧 還沒做完 / 待決定

- **草稿模式要不要全面改**：多米還沒拍板。要的話：把 sketch 模式變預設並拆掉第二版的 fill-pattern 圖層；水域在圖磚接縫處排線對不齊（可改成先合併同 id 的多邊形，或水域只畫排線不畫邊）；森林改畫樹圖示（Rough.js 畫幾何或貼 sprite）；z12 以下畫幾條路；手機實測重畫時間與拖動滑順度；迷霧上的「?」與地名要不要也改手畫
- 真機／模擬器一次都沒測。流程：Actions 抓 `onion-simulator-app` → `lim login` → `lim ios create` → `lim ios sync App.app` → `lim ios screenshot`，定位模擬走 `lim ios simctl`
- 資料模型改版（軌跡點上限 6 萬、整包 JSON 重寫）：給別人用之前要做
- 飛行判定要加確認與撤銷
- PR #1、#2 沒合併；`style-v2` 兩個 commit 在本機沒 push。合併順序 #1 → #2 → style-v2

## 📌 關鍵決策（這次定下來的，下次別再爭論）

- 技術路線 Capacitor 包單檔 HTML，不重寫；換 SwiftUI 的觸發條件在分析文件 2.3
- Bundle ID `org.domyweb.onion`；資料檔 `Documents/onion-map.json`；上次在記錄就自動續錄
- 字型：中文字用 `localIdeographFontFamily` 在裝置上畫；英數標點自產 glyph，缺的區段用 Noto Sans 補；256 個區段檔都要在，缺一個整張圖磚的向量圖層全丟
- **MapLibre 樣式表調不出手繪感**：線永遠精準均勻、每條巷子都畫、圖樣規律平鋪。濾鏡皮只能加抖動墨邊顆粒，改不了畫太多畫太準（模擬圖給多米看過）。要草稿手繪，就自己畫：Rough.js 疊一層畫布，只挑主要道路與河，先簡化再抖
- 多米要的感覺：探索遊戲的草稿手繪，路不用精準，參考圖是色鉛筆的「台中探索地圖 v0.1」（描述在下面）
- 模擬模式正式版要藏；飛行判定要能撤銷
- `fonts/` 與 glyph 用 `.gitattributes` 標 binary；`build.js` 不用 `fs.cpSync`（Node 24 在中文路徑會靜默退出）
- 多米有付費 Apple Developer、沒有 Mac、Windows 11；真機測試用 limrun

## 🎨 多米的參考圖（圖只在上一個會話，這裡用文字描述）

一本筆記本攤開：左頁圖例，右頁「台中探索地圖 v0.1　2026.11.07」。色鉛筆質感、米白紙、深咖啡色筆記本邊框、線條帶鉛筆顆粒。迷霧是灰色斜線排線加手寫「?」；已探索淡綠斜線，部分探索黃斜線；探索邊界是不規則手撕邊。主要道路黃色填色加墨色雙線，高速公路灰色雙線；路牌圓角方框寫 113、129、112，省道綠圓圈寫 3。河流藍色鉛筆波浪線，湖泊藍色斜線。森林是一棵棵闊葉與針葉樹，草地綠色短斜線，山是灰色鉛筆排線的山形。聚落用小房子（一間、三間）、教堂、城堡；捷運橘底白字「M」；醫院紅色斜線框加「H」。使用者標記：旗子興趣點、星星寶藏、帳篷營地、洞窟。頁面有標題框、日期、圖例、指北 N、比例尺。

## 📂 下個會話最重要的檔案

- `src/index.src.html` ← 唯一程式來源。最後面 `SKETCH` 區塊是草稿模式（`SK = { tol, rough, bow }` 三個參數決定多潦草）；「地圖樣式」區塊是第二版的 MapLibre 圖層；`IMAGES` 是 canvas 畫的圖樣與圖示；迷霧與軌跡圖層在 `map.on('load')`
- `build.js` ← 輸出 `index.html` 與 `www/`，內嵌 capacitor.js 與 rough.js，複製 `fonts/`
- `.vibe/HANDOFF.md`（這份）、`docs/產品與技術路線分析.md`、`docs/iOS建置說明.md`
- `.github/workflows/ios.yml` ← build-check、build-simulator（未驗）、testflight（手動）
- 記憶：`C:\Users\fcharlie\.claude\projects\E------\memory\onion-map-ios-capacitor.md`

## 🔧 瀏覽器實測的技巧

- Claude 的瀏覽器面板在背景時 rAF 不跑，MapLibre 載不進 style。網址加 `?testrender=1` 改用計時器驅動（app 內建鉤子）。不要用「先 setStyle」那套，會洗掉執行期加的圖層
- 截圖：開一個 30 行的本機 POST 伺服器（上個會話的 scratchpad/snapserver.py，會話結束就沒了），頁面裡 `map._render(performance.now())` 後把 MapLibre canvas 畫到 2D canvas，草稿模式再把 `window.sketchCanvas` 用 multiply 疊上去，toBlob 後 POST。整頁含介面用截圖工具就行（testrender 開著才不逾時）
- `window.map`、`feed()`、`render(true)`、`engine.clear()`、`drawSketch()`、`SK` 都掛在全域

## ⏭️ 下一步從哪繼續

1. 讀這份。看 `gh pr checks 2` 綠不綠
2. 問多米：草稿模式全面改嗎？要的話從 `style-v2` 開 `sketch-default` 分支，照「還沒做完」第一條的清單做，先做預設開啟＋水域接縫＋森林樹圖示三樣，做完截圖給多米看再往下
3. 不要的話就 limrun 模擬器測試（多米先 `lim login`）
4. 都做完再談資料模型改版與飛行撤銷

## 🗑️ 這次會話的雜訊（下次別重新討論）

- 第一版鋼筆手札與第二版 fill-pattern 色鉛筆都被 POC 取代，別再往那兩條路調
- 濾鏡皮討論結束：濾鏡只能加質感
- 產整套中文 glyph 是白做的，中文字本機畫
- 背景分頁截圖逾時與 style 載不進來，根因是 rAF，已用 `?testrender=1` 解
- Codemagic 與 GitHub Actions 簽署都寫好了，不用再比較
