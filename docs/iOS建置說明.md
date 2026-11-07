# 洋蔥 iOS 版：沒有 Mac 也能裝到 iPhone

網頁版的死穴是 Safari 一離開前景就停止定位。iOS 版用 Capacitor 把同一份網頁包進原生殼，定位改走 CoreLocation，螢幕關掉、手機收口袋都繼續畫。程式還是 `src/index.src.html` 那一份，網頁版與 app 版同一個來源，改一次兩邊都吃到。

這份講三件事：平常怎麼改、怎麼把 app 裝到自己的 iPhone、怎麼上 TestFlight。

## 哪個檔案管什麼

| 檔案 | 用途 |
|---|---|
| `src/index.src.html` | 唯一的程式來源。裡面用 `NATIVE` 這個變數分流：在 app 裡走原生 plugin，在瀏覽器裡走原本的網頁作法 |
| `build.js` | 把程式庫塞進單一 HTML，同時輸出 `index.html`（GitHub Pages）和 `www/index.html`（給 app） |
| `capacitor.config.json` | app 的識別碼 `org.domyweb.onion`、名稱、背景色。改 Bundle ID 從這裡改，再跑 `npx cap sync ios` |
| `ios/` | Xcode 專案。平常不用碰，只有 `ios/App/App/Info.plist`（權限文字）和 `Assets.xcassets`（icon、啟動畫面）會想改 |
| `.github/workflows/ios.yml` | GitHub 雲端建置：每次 push 編譯檢查＋產未簽署 IPA；手動觸發可上 TestFlight |
| `codemagic.yaml` | Codemagic 雲端建置：自動簽署、上 TestFlight |

app 裡多了三個原生 plugin，都在 `package.json`：

- `@capacitor-community/background-geolocation`：背景定位。網頁版的 `watchPosition` 換成它的 `addWatcher`
- `@capacitor/filesystem`：紀錄存成 app Documents 資料夾裡的 `onion-map.json`，會跟著 iCloud 手機備份走
- `@capacitor/share`：匯出備份時開 iOS 分享面板（WKWebView 裡 `a.download` 沒作用）

## 平常怎麼改

```bash
npm install
npm run build
```

改完 `src/index.src.html` 就 build。網頁版直接開 `index.html` 用「模擬」模式在桌上點地圖測。要讓 app 專案也拿到新版，多跑一行：

```bash
npx cap sync ios
```

這行在 Windows 上也能跑，它只是把 `www/` 複製進 Xcode 專案、更新 Swift 套件清單。真的編譯要 macOS，所以交給雲端。

## 裝到自己的 iPhone：三條路

| 路線 | 費用 | 適合 | 限制 |
|---|---|---|---|
| A. AltStore 自己裝 | 免費 | 自己一支手機先玩 | 7 天要重簽一次，一個 Apple ID 最多 3 個 app |
| B. Codemagic → TestFlight | Apple 開發者帳號 US$99/年 | 給朋友測、準備上架 | 要辦開發者帳號 |
| C. GitHub Actions → TestFlight | 同上 | 想自己掌握憑證的人 | 設定步驟最多 |

### A. AltStore（免費，最快看到成果）

GitHub Actions 每次 push 都會在雲端 Mac 編譯一次，產出 `onion-unsigned.ipa`。拿這個檔用 AltStore 裝進手機，AltStore 會用你的 Apple ID 幫它簽。

1. 把這個分支 push 上 GitHub，到 repo 的 Actions 頁看 iOS workflow 跑完（第一次約 10 到 15 分鐘，Swift 套件要下載）
2. 點進那次執行，最下面 Artifacts 下載 `onion-unsigned-ipa`，解壓得到 `onion-unsigned.ipa`
3. Windows 裝 AltServer（altstore.io），iPhone 用線接電腦，AltServer 會把 AltStore 裝進手機
4. 把 `onion-unsigned.ipa` 傳到手機（AirDrop 不行，用 iCloud Drive 或 LINE 傳給自己都可以），在 AltStore 的 My Apps 按 + 選這個檔
5. 第一次打開會說「不受信任的開發者」：設定 › 一般 › VPN 與裝置管理 › 信任你的 Apple ID

AltServer 跟手機在同一個 Wi-Fi 時會自動續簽，不用每 7 天手動弄。這條路不能給別人裝、不能上架，純粹自己測。

### B. Codemagic（推薦的正式路線）

Codemagic 會用 App Store Connect 的 API key 自動產生簽署憑證與描述檔，不用自己弄 .p12。免費額度每月 500 分鐘 Mac mini M2，洋蔥一次建置大約 10 到 15 分鐘。

1. 辦 Apple Developer Program（developer.apple.com，US$99/年），等審核過
2. developer.apple.com › Certificates, Identifiers & Profiles › Identifiers › + › App IDs，Bundle ID 填 `org.domyweb.onion`（跟 `capacitor.config.json` 一樣；想換就兩邊都換）。Capabilities 不用勾，背景定位不是 capability
3. App Store Connect › 我的 App › + › 新的 App，選剛才的 Bundle ID，名稱「洋蔥」
4. App Store Connect › 使用者和存取權 › 整合 › App Store Connect API › 團隊金鑰 › 產生，角色選 App Manager，下載 .p8（只能下載一次，收好），記下 Key ID 和 Issuer ID
5. codemagic.io 用 GitHub 登入，Teams › Integrations › App Store Connect › 把 .p8、Key ID、Issuer ID 加進去，名稱填 `onion-asc`（跟 `codemagic.yaml` 裡 `integrations.app_store_connect` 一樣）
6. Codemagic 加入 Onion-Map 這個 repo，它會讀到 `codemagic.yaml`，選 `ios-testflight` 這個 workflow，選分支，Start new build
7. 跑完會自動送到 TestFlight。手機裝 TestFlight app，用同一個 Apple ID 登入就看得到

之後每次改完 push，到 Codemagic 按一次 build 就好。想讓它自動跑，在 Codemagic 的 workflow 設定裡開 trigger on push。

### C. GitHub Actions 簽署上傳（進階）

`.github/workflows/ios.yml` 裡的 `testflight` job 可以做到跟 Codemagic 一樣的事，但憑證要自己做、自己放進 GitHub Secrets。沒有 Mac 的話，憑證用 Windows 的 Git Bash 裡的 openssl 做：

```bash
openssl genrsa -out ios_distribution.key 2048
```

```bash
openssl req -new -key ios_distribution.key -out ios_distribution.csr -subj "/emailAddress=你的AppleID信箱/CN=Onion Distribution/C=TW"
```

到 developer.apple.com › Certificates › + › Apple Distribution，上傳 `ios_distribution.csr`，下載 `distribution.cer`，然後：

```bash
openssl x509 -in distribution.cer -inform DER -out distribution.pem -outform PEM
```

```bash
openssl pkcs12 -export -inkey ios_distribution.key -in distribution.pem -out ios_distribution.p12
```

匯出時會要你設密碼，記下來。接著在 developer.apple.com › Profiles › + › App Store Connect，選 `org.domyweb.onion` 和剛才那張憑證，下載 `.mobileprovision`。兩個檔都轉 base64：

```bash
base64 -w0 ios_distribution.p12 > p12.txt
```

```bash
base64 -w0 洋蔥.mobileprovision > profile.txt
```

repo › Settings › Secrets and variables › Actions，建這 7 個 secret：

| Secret | 內容 |
|---|---|
| `IOS_P12_BASE64` | `p12.txt` 的內容 |
| `IOS_P12_PASSWORD` | 匯出 .p12 時設的密碼 |
| `IOS_PROFILE_BASE64` | `profile.txt` 的內容 |
| `APPLE_TEAM_ID` | developer.apple.com › Membership details 的 Team ID（10 碼） |
| `ASC_KEY_ID` | App Store Connect API key 的 Key ID |
| `ASC_ISSUER_ID` | 同頁面的 Issuer ID |
| `ASC_API_KEY_P8` | .p8 檔整段文字（含 BEGIN／END 那兩行） |

然後 Actions › iOS › Run workflow，勾「上傳到 TestFlight」。每次執行的 build 號用 GitHub 的執行序號，不會撞號。

## 第一次打開 app 要注意

- 按「開始記錄」會跳定位權限，選「使用 App 時允許」就能開始畫
- 記錄一陣子後 iOS 會再問一次要不要改成「永遠允許」，選它，手機收進口袋才會繼續畫。沒選的話回到 app 才會繼續
- 背景記錄時狀態列會有藍色定位膠囊，點它可以回到洋蔥。這是 iOS 規定的，拿不掉
- 上次關掉 app 時還在記錄的話，下次打開會自動接著記
- 「資料 › 匯出備份」會開分享面板，存到「檔案」或 AirDrop 給電腦都行。匯入備份用同一個 JSON 檔

## 已知限制

- iOS 因為記憶體不夠把 app 殺掉的話，記錄會停，要再打開 app 才會續。目前的 plugin 不會自己喚醒 app。真的碰到再處理，解法是補一小段 Swift 用 significant location change 把 app 叫起來
- 整天背景記錄會吃電，實際跑一天再看數字。現在定位是走 4 公尺一個點、不自動暫停的設定，省電的調法在 `src/index.src.html` 的 `addWatcher` 那段
- 地圖圖磚來自 OpenFreeMap 的公開服務，沒有網路就只剩羊皮紙和你畫過的格子。離線圖磚是之後的事

## 想在手機上即時看修改（進階）

Capacitor 可以讓 app 不用內建的 `www/`，改載入你電腦上的開發伺服器。在 `capacitor.config.json` 加：

```json
"server": { "url": "http://你電腦的區網IP:8787", "cleartext": true }
```

然後重新建一次 app 裝到手機。之後電腦上改完 build，手機上的 app 重開就是新版，不用再重新建置。正式版記得把這段拿掉。
