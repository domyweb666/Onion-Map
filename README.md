# 洋蔥 Onion Map

只畫出你去過的地方的地圖。走路、坐車、高鐵、飛機都會記錄，沒去過的地方是一張空白羊皮紙。

目前是網頁原型，用 iPhone Safari 開：https://domyweb666.github.io/onion-map/

## 怎麼用
- **模擬**：在桌上點地圖測試。第一下把你放在那裡，之後選步行／汽車／高鐵／飛機再點下一個地方。
- **開始記錄**：真的帶出門走。網頁版要保持螢幕開啟、Safari 在最前面。
- **資料**：下載或匯入備份。資料只存在這支手機的瀏覽器裡。

## 開發
程式寫在 `src/index.src.html`，改完執行：

```
npm install
npm run build
```

會把地圖程式庫（MapLibre、H3）打包進根目錄的 `index.html`，GitHub Pages 直接發佈這個檔案。

地圖資料：© OpenStreetMap contributors，圖磚由 OpenFreeMap 提供。地形陰影用 AWS Open Data 的 Terrain Tiles。

地名用手寫字型「辰宇落雁體」（SIL Open Font License 1.1），字型檔與授權在 `fonts/`。中文字由 MapLibre 在裝置上用這套字型畫，英數與標點用 `fonts/glyphs/` 裡自產的 glyph，缺的區段用 OpenFreeMap 的 Noto Sans 補。

## iOS app

同一份程式用 Capacitor 包成 iOS app，定位改走原生的背景定位，螢幕關掉也會繼續畫。`npm run build` 會多產一份 `www/index.html` 給 app 用，再跑 `npx cap sync ios` 同步進 `ios/` 的 Xcode 專案。

沒有 Mac 也能建置：GitHub Actions 每次 push 會在雲端 Mac 上編譯一次並產出未簽署的 IPA，可用 AltStore 裝到自己的 iPhone；要上 TestFlight 走 Codemagic 或 GitHub Actions 的簽署流程。細節在 `docs/iOS建置說明.md`。
