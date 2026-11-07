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

地圖資料：© OpenStreetMap contributors，圖磚由 OpenFreeMap 提供。
