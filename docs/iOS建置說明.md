# 洋蔥 iOS 版：沒有 Mac 也能裝到 iPhone

iOS 版用 Capacitor 把網頁包進原生殼，定位改走 CoreLocation，螢幕關掉、手機收口袋都繼續畫。網頁版和 app 版是同一份程式，改一次兩邊都吃到。

這份依序講：哪個檔案管什麼、平常怎麼改、Apple 後台要先做的事、怎麼裝到 iPhone 和上 TestFlight、雲端畫圖上線那天要改哪些東西。指令都在 Git Bash 打。

## 哪個檔案管什麼

| 檔案 | 用途 |
|---|---|
| `src/js`、`src/css`、`src/index.src.html` | 程式來源。`NATIVE` 這個變數分流：在 app 裡走原生外掛，在瀏覽器裡走網頁作法 |
| `build.js` | 接成單一 HTML，輸出 `index.html`（網頁版）和 `www/index.html`（app），字型、邊框、圖磚也一起複製進 `www/` |
| `capacitor.config.json` | app 的識別碼 `org.domyweb.onion`、名稱、背景色 |
| `ios/App/App/` | 主程式。`Info.plist` 是權限文字，`PrivacyInfo.xcprivacy` 是隱私清單，`OnionNativePlugin.swift` 是自己寫的外掛（掃 QR、小工具、即時動態） |
| `ios/App/OnionWidget/` | 小工具與即時動態，識別碼 `org.domyweb.onion.widget`，有自己的 `PrivacyInfo.xcprivacy` |
| `ios/App/Shared/` | 主程式和小工具共用的程式 |
| `.github/workflows/ios.yml` | GitHub 雲端建置：push 到 `main`、`ios-capacitor`、`paint-cli`、`work/` 開頭的分支會編譯並產出未簽署 IPA（只改 md 或 `docs/` 不跑）；手動觸發可上 TestFlight |
| `codemagic.yaml` | Codemagic 雲端建置，簽署後上 TestFlight |

主程式最低 iOS 15.0，小工具與即時動態最低 iOS 16.2。另外裝了三個現成的外掛，都在 `package.json`：

- `@capacitor-community/background-geolocation`：背景定位
- `@capacitor/filesystem`：紀錄存在 app 的 Documents 資料夾底下的 `onion/`，會跟著 iCloud 手機備份走
- `@capacitor/share`：匯出備份、分享卡片時開 iOS 分享面板

識別碼出現在好幾個地方，只改 `capacitor.config.json` 不夠。要換的話搜尋整個專案的 `org.domyweb.onion`，`project.pbxproj`、兩個 entitlements、`Info.plist`、`OnionShared.swift`、`OnionScannerViewController.swift`、`ios.yml`、`codemagic.yaml`、`tools/limrun/test.mjs` 都有。

## 平常怎麼改

```bash
npm install
npm run build
npm test
```

要在桌上試，用瀏覽器開網頁版，設定 › 測試 › 模擬模式打開，回地圖點。要讓 app 專案也拿到新版，多跑一行：

```bash
npx cap sync ios
```

這行在 Windows 上也能跑，它把 `www/` 複製進 Xcode 專案、更新 Swift 套件清單。真的編譯要 macOS，交給雲端。

## Apple 開發者後台要先做的事

走 TestFlight 才需要，AltStore 那條路不用。先辦好 Apple Developer Program（developer.apple.com，US$99/年）。順序不要換，後面的步驟會用到前面的東西。

1. developer.apple.com › Certificates, Identifiers & Profiles › Identifiers › + › App Groups，Identifier 填 `group.org.domyweb.onion`，說明隨便寫
2. Identifiers › + › App IDs › App，Bundle ID 選 Explicit，填 `org.domyweb.onion`。Capabilities 往下找到 App Groups 打勾，按旁邊的 Configure 選 `group.org.domyweb.onion`
3. 再做一次，Bundle ID 填 `org.domyweb.onion.widget`，一樣勾 App Groups、選同一個 group
4. App Store Connect › 我的 App › + › 新的 App，Bundle ID 選 `org.domyweb.onion`，名稱「洋蔥」。小工具不用另外建
5. App Store Connect › 使用者和存取權 › 整合 › App Store Connect API › 團隊金鑰 › 產生，角色選 App Manager。下載 .p8（只能下載一次，收好），記下 Key ID 和 Issuer ID

`org.domyweb.onion` 以前登記過的話不用重建，點進去補勾 App Groups、選好 group 再存檔。改過 App Groups 之後，舊的 profile 就不能用了，要重做。

背景定位、相機、區域網路、即時動態只寫在 `Info.plist`，後台不用勾。即時動態沒有用推播，所以也不用推播金鑰。

接下來 B、C 選一條。兩條路都要兩個 profile，主程式一個、小工具一個，類型都是 App Store Connect。

## 裝到自己的 iPhone：三條路

| 路線 | 費用 | 適合 | 限制 |
|---|---|---|---|
| A. AltStore 自己裝 | 免費 | 自己一支手機先玩 | 7 天要重簽一次，一個 Apple ID 最多 3 個 app，小工具讀不到里程 |
| B. Codemagic → TestFlight | 要開發者帳號 | 給朋友測、準備上架 | 憑證與 profile 要先在 Codemagic 後台放好 |
| C. GitHub Actions → TestFlight | 要開發者帳號 | 想自己管憑證的人 | 設定步驟最多 |

### A. AltStore（免費，最快看到成果）

1. push 之後，到 repo 的 Actions 頁等 iOS workflow 跑完
2. 點進那次執行，最下面 Artifacts 下載 `onion-unsigned-ipa`，解壓得到 `onion-unsigned.ipa`
3. Windows 裝 AltServer（altstore.io），iPhone 用線接電腦，AltServer 會把 AltStore 裝進手機
4. 把 `onion-unsigned.ipa` 用 iCloud Drive 或 LINE 傳到手機，在 AltStore 的 My Apps 按 + 選這個檔
5. 第一次打開會說「不受信任的開發者」：設定 › 一般 › VPN 與裝置管理 › 信任你的 Apple ID

AltServer 跟手機在同一個 Wi-Fi 時會自動續簽。這條路不能給別人裝、不能上架。

這個 IPA 沒簽過，裡面沒有 App Group，主程式沒地方把里程交給小工具，小工具應該只會顯示「還沒有紀錄」（待確認，加了小工具之後還沒用 AltStore 裝過）。要看小工具走 TestFlight。

### B. Codemagic

免費額度每月 500 分鐘。

1. 用 GitHub 登入 codemagic.io，到 Team integrations › Developer Portal › Manage keys › Add key，填 Issuer ID、Key ID，上傳 .p8，名稱填 `onion-asc`（跟 `codemagic.yaml` 的 `integrations.app_store_connect` 一樣）
2. codemagic.yaml settings › Code signing identities › iOS certificates。已經有 Apple Distribution 憑證的 .p12 就上傳那張，沒有就按 Generate certificate，選剛才那把 key。新產的憑證檔和密碼只能下載一次，要收好。Apple 一個帳號最多 3 張發佈憑證
3. 回 developer.apple.com › Profiles › + › App Store Connect，替 `org.domyweb.onion` 和 `org.domyweb.onion.widget` 各做一個，憑證選第 2 步那張
4. 回 Codemagic 同一頁的 iOS provisioning profiles › Fetch profiles，兩個都選，按 Download selected
5. 加入 Onion-Map 這個 repo，選 `ios-testflight` 這個 workflow、選 `paint-cli` 分支，Start new build
6. 跑完會送到 TestFlight。手機裝 TestFlight，用同一個 Apple ID 登入就看得到

建置時在「確認小工具的 profile 有抓到」停住，就是第 4 步少了 `.widget` 那個。

### C. GitHub Actions 簽署上傳

`.github/workflows/ios.yml` 的 `testflight` 這個 job 做的事跟 Codemagic 一樣，憑證要自己放進 GitHub Secrets。

1. 準備 Apple Distribution 憑證的 .p12。已經有一張就直接用，跳到第 2 步。沒有才照下面做：

   ```bash
   openssl genrsa -out ios_distribution.key 2048
   ```

   ```bash
   MSYS_NO_PATHCONV=1 openssl req -new -key ios_distribution.key -out ios_distribution.csr -subj "/emailAddress=你的AppleID信箱/CN=Onion Distribution/C=TW"
   ```

   到 developer.apple.com › Certificates › + › Apple Distribution，上傳 `ios_distribution.csr`，下載 `distribution.cer`，然後：

   ```bash
   openssl x509 -in distribution.cer -inform DER -out distribution.pem -outform PEM
   ```

   ```bash
   openssl pkcs12 -export -legacy -inkey ios_distribution.key -in distribution.pem -out ios_distribution.p12
   ```

   匯出時會要你設密碼，記下來。`-legacy` 要留著，新版 openssl 預設的加密方式，macOS 的鑰匙圈常常匯不進去。這些檔案都不要放進 repo。

2. developer.apple.com › Profiles › + › App Store Connect，做兩個，憑證都選第 1 步那張：App ID 選 `org.domyweb.onion` 的存成 `app.mobileprovision`，選 `org.domyweb.onion.widget` 的存成 `widget.mobileprovision`

3. 三個檔轉成 base64：

   ```bash
   base64 -w0 ios_distribution.p12 > p12.txt
   base64 -w0 app.mobileprovision > app.txt
   base64 -w0 widget.mobileprovision > widget.txt
   ```

4. repo › Settings › Secrets and variables › Actions，建這 8 個 secret：

   | Secret | 內容 |
   |---|---|
   | `IOS_P12_BASE64` | `p12.txt` 的內容 |
   | `IOS_P12_PASSWORD` | .p12 的密碼 |
   | `IOS_PROFILE_BASE64` | `app.txt` 的內容 |
   | `IOS_WIDGET_PROFILE_BASE64` | `widget.txt` 的內容 |
   | `APPLE_TEAM_ID` | developer.apple.com › Membership details 的 Team ID（10 碼） |
   | `ASC_KEY_ID` | App Store Connect API key 的 Key ID |
   | `ASC_ISSUER_ID` | 同頁面的 Issuer ID |
   | `ASC_PRIVATE_KEY` | .p8 檔整段文字（含 BEGIN／END 那兩行） |

5. 觸發。`main` 還沒有這個 workflow 檔，Actions 頁不會出現 Run workflow 按鈕，先用指令：

   ```bash
   gh workflow run ios.yml --ref paint-cli -f testflight=true
   ```

   併進 `main` 之後，就可以在 Actions › iOS › Run workflow 選分支、勾「上傳到 TestFlight」。build 號用 GitHub 的執行序號，不會撞號。

停在「安裝 provisioning profile」的話，log 會寫原因：

- 「少了 widget 的 profile secret」：`IOS_WIDGET_PROFILE_BASE64` 沒放
- 「profile 是給 … 的，要的是 …」：兩個 profile 貼反了
- 「沒有 App Group」：那個 App ID 沒勾 App Groups，或勾了之後沒重做 profile

## 雲端畫圖上線時要改的東西

現在只有「用電腦畫圖」，隱私清單寫的是沒有收集任何資料。雲端版上線後，底稿會送到 Cloudflare 和 OpenAI，下面每一項都要一起改，缺一項先不要送審。

1. 部署：照 `server/painter/README.md` 做，拿到網址，用裡面那行 `curl.exe` 確認回的是 `"kind":"cloud"`。一天幾張、OpenAI 花費上限先定好，那份也有列

2. 打開：`src/js/42-painter.js` 的 `PAINT_CLOUD_URL` 填上網址

3. 送出前講清楚、問過：Apple 審查準則 5.1.2(i) 要求，把個人資料交給第三方（包含第三方的 AI）之前，要講明白並取得同意。現在雲端那條路只問「會用掉一次畫圖額度」（日卡在 `src/js/52-daycard.js` 的 `dcAsk`，手繪地圖在 `src/js/47-basepaint.js`）。第一次用要多一張說明，寫底稿送到哪裡、交給 OpenAI 畫、放多久，按同意才送

4. 定位用途說明：`ios/App/App/Info.plist` 的 `NSLocationAlwaysAndWhenInUseUsageDescription` 現在寫「只會把一張沒有路線的地圖底圖送到你自己的電腦」，改成下面這句。`NSLocationWhenInUseUsageDescription` 只講紀錄存在手機，雲端也不送紀錄，不用改

   ```xml
   <string>選「永遠允許」，手機收進口袋、螢幕關掉時洋蔥才能繼續畫地圖。走過的紀錄只存在這支手機；請 AI 畫圖時，只會送出一張沒有路線的地圖底圖，送到你自己的電腦，或洋蔥的畫圖服務與 OpenAI。</string>
   ```

5. 隱私清單：`ios/App/App/PrivacyInfo.xcprivacy` 的 `NSPrivacyCollectedDataTypes` 底下那行 `<array/>` 換成下面這段。小工具自己不連網路，它那份不用改

   ```xml
   <array>
   	<dict>
   		<key>NSPrivacyCollectedDataType</key>
   		<string>NSPrivacyCollectedDataTypeCoarseLocation</string>
   		<key>NSPrivacyCollectedDataTypeLinked</key>
   		<true/>
   		<key>NSPrivacyCollectedDataTypeTracking</key>
   		<false/>
   		<key>NSPrivacyCollectedDataTypePurposes</key>
   		<array>
   			<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
   		</array>
   	</dict>
   	<dict>
   		<key>NSPrivacyCollectedDataType</key>
   		<string>NSPrivacyCollectedDataTypeDeviceID</string>
   		<key>NSPrivacyCollectedDataTypeLinked</key>
   		<true/>
   		<key>NSPrivacyCollectedDataTypeTracking</key>
   		<false/>
   		<key>NSPrivacyCollectedDataTypePurposes</key>
   		<array>
   			<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
   		</array>
   	</dict>
   </array>
   ```

   報大略位置，是因為底稿就是使用者去過那一帶的地圖，成品會在伺服器放滿一天。報裝置 ID，是因為每支手機有一組隨機代號，伺服器用它的雜湊算張數。這是從嚴的填法，待確認，送審當天對一次 [Apple 的說明](https://developer.apple.com/app-store/app-privacy-details/)

6. App Store Connect 的 App 隱私權：勾跟第 5 步一樣的兩項，用途選 App 功能，不用於追蹤

7. 隱私權政策網頁：寫底稿送到哪裡、放多久，網址填進 App Store Connect

8. 設定頁：`src/js/42-painter.js` 的 `painterSettings`，沒配對會顯示「還沒配對」。有雲端之後沒配對也能畫，這列的字要一起改

9. 重新 build，走 B 或 C 上 TestFlight，用沒配對電腦的手機畫一張，確認第 3 步的說明有跳出來

## 第一次打開 app 要注意

- 按記錄鈕會跳定位權限，選「使用 App 時允許」就能開始畫
- 記錄一陣子後 iOS 會再問一次要不要改成「永遠允許」，選它，手機收進口袋才會繼續畫
- 背景記錄時狀態列會有藍色定位圖示，點它可以回到洋蔥，這是 iOS 規定的，拿不掉
- 上次關掉 app 時還在記錄的話，下次打開會自動接著記
- 第一次掃電腦的 QR 會問相機，連電腦會問區域網路，都按允許。按錯了到 iPhone 的設定裡找洋蔥打開
- 設定 › 資料 › 匯出備份，會開分享面板。要還原就走同一段的「匯入足跡或備份」，選那個 JSON 檔

## 已知限制

- iOS 因為記憶體不夠把 app 關掉的話，記錄會停，要再打開 app 才會續。解法是補一小段 Swift，用 significant location change 把 app 叫起來，還沒做
- 整天背景記錄會吃電，還沒實際跑一天看數字。現在是走 4 公尺一個點，要調在 `src/js/30-record.js` 的 `addWatcher` 那段
- 沒網路時只看得到存在手機裡的地圖（看過的、附近 10 公里、下載過的縣市）
- 系統最多讓即時動態留八小時，過了要打開一次 app 才會補上
- 這個分支還沒裝到真的 iPhone 上跑過，沒驗的清單在 `README.md`

## 想在手機上即時看修改

在 `capacitor.config.json` 加：

```json
"server": { "url": "http://你電腦的區網IP:8787", "cleartext": true }
```

電腦上用任何網頁伺服器把專案根目錄開在 8787 埠，app 重新建一次裝到手機。之後電腦上改完 build，手機上的 app 重開就是新版。正式版記得把這段拿掉。
