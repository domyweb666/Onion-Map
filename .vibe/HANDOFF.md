# Handoff: 洋蔥地圖包成 iOS、手札畫風第一版做完，畫風要再往色鉛筆探索地圖走

> 產出時間：2026-11-07 16:50
> 前一會話的最後狀態，給下一個會話接續用

## ✅ 這次完成了什麼

- clone domyweb666/Onion-Map 到 `E:\洋蔥地圖\Onion-Map`，讀完原型（H3 六角格迷霧地圖、MapLibre 羊皮紙底圖、速度判定交通方式、模擬模式）
- 用 Capacitor 8 包成 iOS app：背景定位 plugin、紀錄存 Documents、分享面板匯出、上次在記錄就自動續錄、Info.plist 權限文字、羊皮紙 icon 與啟動畫面。分支 `ios-capacitor`，PR #1 → main，CI 綠，未簽署 IPA 拆開驗過
- 寫 `docs/iOS建置說明.md`（AltStore／Codemagic／GitHub Actions 三條裝機路）與 `docs/產品與技術路線分析.md`（功能增刪、三層自建地圖、畫風清單）
- 手札畫風第一版：手寫字型辰宇落雁體、雙線墨筆道路、建築排線、AWS 地形陰影、河名沿河、鐵路枕木、頁框與指北。分支 `journal-style`，PR #2 → ios-capacitor。瀏覽器實測台北 z12／z15／z17、陽明山 z13、迷霧開著餵步行軌跡的成品畫面
- CI：GitHub Actions 每次 push 編譯檢查＋未簽署 IPA；手動觸發上 TestFlight；`codemagic.yaml` 自動簽署版。這份 handoff 同一個 commit 加了 `build-simulator` job（產模擬器用的 .app，給 limrun），還沒跑過

## 🚧 還沒做完 / 待決定

- **草稿手繪 POC 成立（分支 `style-v2`，網址加 `?sketch=1`）**：多米看了第二版說不像他要的「探索的草稿手繪風」，路也不用畫那麼精準。根因是 MapLibre 樣式只能換色換粗細，線永遠精準均勻、每條巷子都畫。POC 改用 Rough.js 在一層 multiply 的畫布上自己畫：只取主要道路、河、水域、公園森林，螢幕座標 Douglas–Peucker 簡化（公差 5px）再抖線，水與植被排線填色，迷霧全螢幕淡排線再用 destination-out 挖掉已探索區，已探索綠排線加墨邊；地名、路牌、「?」、聚落圖示留給 MapLibre 畫在底下。z13 一張畫 90 到 150ms，停下才重畫、拖動時 CSS 位移。多米還沒說要不要全面改。全面改的話：把 sketch 模式變預設、調 `SK`（tol／rough／bow）、水域圖磚接縫處理、森林改畫樹圖示、把 fill-pattern 那套第二版圖層拿掉、手機實測效能
- 畫風第二版第一輪已做出來（分支 `style-v2`，疊在 journal-style 上）：迷霧灰色鉛筆排線加散落的「?」、已探索綠排線、黃色道路與綠白路牌、樹圖示森林、草地筆觸、藍排線湖泊與波浪河流、山頂圖示、聚落小房子／教堂／城堡、筆記本咖啡邊框、全圖鉛筆顆粒、比例尺、標題日期、圖例面板。還沒做：使用者標記圖示（旗、星、帳篷、洞窟）、醫院等重要區域、捷運「M」、「部分探索（黃）」的定義、把程式畫的佔位圖示換成多米自己畫的 sprite。多米給的參考圖描述留在下面
- 真機／模擬器測試一次都沒跑過。多米指示用 limrun（雲端 iOS 模擬器），流程在下面
- 資料模型改版（軌跡點上限 6 萬、整包 JSON 重寫）：給別人用之前要做，自己測可以先不管
- 飛行判定要加「這段是搭飛機嗎」的確認與撤銷
- PR #1、#2 都沒合併。順序：#1 先。#2 的 base 是 ios-capacitor，#1 合併並刪分支後 GitHub 會把 #2 轉到 main；沒轉就 `gh pr edit 2 --base main`

## 📌 關鍵決策（這次定下來的，下次別再爭論）

- 技術路線：Capacitor 包單檔 HTML，不重寫。換 SwiftUI 的觸發條件在分析文件 2.3
- Bundle ID `org.domyweb.onion`；資料檔 `Documents/onion-map.json`；上次在記錄就自動續錄
- 字型：中文字用 `localIdeographFontFamily` 在裝置上畫，不產中文 glyph；英數標點自產 glyph，缺的區段用 Noto Sans 補。256 個區段檔都要在，缺一個 MapLibre 會把整張圖磚的向量圖層全丟掉
- 「自己搭地圖」的定義是三層：幾何借 OSM＋DEM 但不顯示現成地名、揭露靠走、名字與日記自己寫（分析文件第 3 節）
- 模擬模式正式版要藏；飛行判定要能撤銷
- `fonts/` 與 glyph 用 `.gitattributes` 標 binary；`build.js` 不用 `fs.cpSync`（Node 24 在中文路徑會靜默退出 127）
- 多米有付費 Apple Developer 帳號、沒有 Mac、用 Windows 11（人蔘修煉那案也是這樣定的）

## 🎨 畫風第二版的目標（參考圖只在上一個會話，這裡用文字描述）

一本筆記本攤開：左頁是圖例，右頁是「台中探索地圖 v0.1　2026.11.07」。整體是色鉛筆／蠟筆質感，米白紙、深咖啡色的筆記本邊框，所有線條帶鉛筆顆粒。

- 迷霧：灰色斜線排線蓋住未探索區，上面散著手寫的「?」。已探索＝淡綠色斜線罩著，部分探索＝黃色斜線。探索邊界是不規則的手撕邊
- 道路：主要道路黃色填色加墨色雙線；高速公路灰色雙線；路牌是圓角方框寫 113、129、112，省道是綠色圓圈寫 3，另有 74
- 河流：藍色鉛筆波浪線。湖泊：藍色斜線填色
- 森林：一棵一棵的樹圖示（闊葉圓樹、針葉三角樹）散在綠色鉛筆塗抹上。草地：綠色短斜線。山：灰色鉛筆排線畫的山形
- 聚落：小房子圖示（民宅一間、村莊三間並排）、教堂（十字塔）、城堡（城垛）當城市中心；捷運站橘底白字「M」；重要區域（醫院）紅色斜線框加「H」
- 使用者標記：旗子＝興趣點、星星＝寶藏、帳篷＝營地、洞窟
- 頁面元素：左上標題框與日期、圖例（地圖符號、探索狀態兩組）、右上指北 N、右下比例尺 0 1 2 3 km

跟第一版的差別：第一版是鋼筆寫生（畫真實 OSM 建築輪廓、細墨線），第二版要的是抽象化的探險遊戲地圖：建築不畫輪廓改用聚落圖示、森林用樹圖示、線條有色鉛筆顆粒、迷霧有質感不是空白紙。

可行作法，全在 MapLibre 裡，引擎不用動：

- 迷霧：`fog` 圖層的 fill-pattern 換成灰色排線 tile；另加一個 GeoJSON 點圖層畫「?」，用手寫字型的 text-field，點用 H3 粗格子算在視窗內、排除已探索的
- 已探索：`explored` 多疊一層綠色排線 pattern；`freq` 可改成黃／綠分「部分探索／已探索」
- 道路：`road-paper` 內層顏色依 class 改黃色（主要）與灰色（高速）
- 路牌：`transportation_name` 的 `ref` 欄位做 symbol 圖層，icon-text-fit 加可拉伸的方框圖；省道換綠圓
- 森林與草地：`landcover` 用樹圖示與短斜線的 fill-pattern tile；山頂用 `mountain_peak` 圖層放山形圖示加名字
- 聚落：建築輪廓只留 z16 以上且更淡；`place` 點圖層依 class 放房子／村莊／城堡圖示
- 鉛筆顆粒：線圖層改 line-pattern 的鉛筆筆觸 tile；全圖疊一層 `mix-blend-mode: multiply` 的紙紋噪點 div
- 比例尺：`maplibregl.ScaleControl` 改 CSS；圖例做成面板；標題框放「{地名}探索地圖 v0.1」與日期
- 圖示先用 canvas 畫簡單幾何當佔位，之後換多米自己畫的 PNG／SVG sprite

建議先做迷霧排線加「?」、道路黃色、樹圖示三樣，這三樣最能一眼認出參考圖的味道。

## 📂 下個會話最重要的檔案

- `src/index.src.html` ← 唯一程式來源。style 在「地圖樣式」區塊；迷霧與軌跡圖層在 `map.on('load')` 裡；平台分流用 `NATIVE`
- `build.js` ← 輸出 `index.html` 與 `www/`，複製 `fonts/`
- `docs/產品與技術路線分析.md`、`docs/iOS建置說明.md`
- `.github/workflows/ios.yml` ← build-check（未簽署 IPA）、build-simulator（新加，未驗）、testflight（手動）
- `fonts/` ← 字型與 glyph，別手改
- 記憶：`C:\Users\fcharlie\.claude\projects\E------\memory\onion-map-ios-capacitor.md`

## 🧪 limrun（雲端 iOS 模擬器，多米指定用它做真機測試）

- CLI 已裝（`lim` 0.52.1，`npm install -g lim`）。還沒登入：`lim login` 或設 `LIM_API_KEY`，帳號由多米自己做，AI 不碰
- 流程：GitHub Actions 的 build-simulator job 產 artifact `onion-simulator-app`（App.app 壓成 zip）→ 下載解壓 → `lim ios create` 開一台模擬器 → `lim ios sync App.app` 裝進去（多台時加 `--id`）→ `lim ios launch-app`、`lim ios screenshot`、`lim ios app-log` 看畫面與 log → 定位模擬走 `lim ios simctl`（simctl 的 `location` 子命令可以設座標或跑一條路線，先看 `lim ios simctl --help`）
- lim 也有 `lim xcode build`，能在雲端 Xcode 直接建置，是 GitHub Actions 之外的另一條建置路；`lim skills install` 會把 Limrun 的 Claude Code skill 裝進來
- 模擬器能驗介面、字型、樣式、定位流程；背景耗電與系統殺 app 後的續錄要真機

## 🔧 瀏覽器實測的技巧（下次要截圖再用）

- Claude 的瀏覽器面板在背景時 requestAnimationFrame 不跑，MapLibre 的 style 載不進來。app 內建了測試鉤子：網址加 `?testrender=1` 會改用計時器驅動，之後 `feed()`、`render(true)`、`map.jumpTo` 都正常。不要再用「先 setStyle」那套，會把執行期加的圖層洗掉
- 截圖：`map._render(performance.now())` 之後把 canvas drawImage 到 2D canvas、toBlob、POST 到本機小伺服器（上個會話在 scratchpad 寫了 30 行的 snapserver.py，會話結束就沒了，重寫很快）
- `window.map` 掛在全域方便主控台調樣式；`feed()` 可直接餵假定位點；`engine.clear()` 清掉

## ⏭️ 下一步從哪繼續

1. 讀這份。看 PR #1、#2 的 CI 綠不綠：`gh pr checks 2`
2. 多米拍板草稿模式要不要全面改（開 `?sketch=1&testrender=1` 看），要的話照上面清單做；不然就 limrun 模擬器測試（多米先 `lim login`，再從 Actions 抓 onion-simulator-app）
3. 不管做哪個，從 journal-style 再開新分支（例如 style-v2、sim-test），不要直接堆在 PR #2

## 🗑️ 這次會話的雜訊（下次別重新討論）

- 產整套中文 glyph（一萬字跑了十分鐘）是白做的，中文字本機畫
- 背景面板截圖逾時與 style 載不進來，根因是 rAF，不是程式有錯
- 第一版的鋼筆寫生方向已被第二張參考圖取代，不用再往「寫生感」調
- Codemagic 與 GitHub Actions 簽署都寫好了，不用再比較
