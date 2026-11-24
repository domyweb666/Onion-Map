# 雲端畫圖

給沒有電腦的人用。介面跟 `tools/painter` 一樣，後面換成 Cloudflare Worker 加 OpenAI 的圖片編輯。目前只寫好、在本機測過，還沒有部署，也沒有真的叫過 OpenAI。

## 怎麼運作

手機送底稿上來，拿到一個號碼就可以斷線。每張圖有自己的 Durable Object，用 alarm 去叫 OpenAI，畫好把圖切成小塊存在它的 SQLite，手機再來問、來拿。滿 24 小時整個清掉，底稿畫完就先刪。

張數全部記在同一個 Durable Object（`PaintQuota`），一次只處理一個請求，所以總量不會超過。先扣再畫，畫失敗會還。

2026-11-25 查 Cloudflare 官方文件的依據：alarm 一次最多跑 15 分鐘，等 OpenAI 的時間不算計算時間；免費方案的 Worker 一次只有 10 毫秒計算時間，所以拆大圖放在 Durable Object（30 秒）；SQLite 一格最多 8MB，這裡切 1MB 一塊。用不到 R2，少開一樣東西。

## 要多米決定、要提供的

| 要什麼 | 說明 |
|---|---|
| Cloudflare 帳號 | 免費方案跑得起來 |
| OpenAI 金鑰 | 開一個只給這個用的專案，金鑰只給圖片的權限 |
| OpenAI 花費上限 | 在 OpenAI 後台替那個專案設每月上限。就算程式有洞，帳單也只到那裡 |
| 一個人一天幾張 | `DAILY_PER_DEVICE`，現在 1 |
| 全站一天幾張 | `DAILY_TOTAL`，現在 50 |
| 用哪個模型、多細 | `IMAGE_MODEL`、`IMAGE_QUALITY`，現在 `gpt-image-2.6-sunburst`、`medium` |

原本說好預設 `gpt-image-1`，可是 OpenAI 在 2026-10-23 把它關了，所以換成他們現在建議的 `gpt-image-2.6-sunburst`。另一個選擇是 `gpt-image-2.6-flare`，牌價一樣。

一張多少錢還不知道。2.6 照用量算（圖片輸入每百萬 token 8 美元、輸出 30 美元），官方頁面沒有寫一張的價錢。舊的 `gpt-image-1` 同尺寸 medium 是 0.063 美元，只能當大概的量級。部署後先畫兩三張，看 OpenAI 後台扣多少再決定一天幾張。

## 部署

`wrangler deploy` 放在中文路徑會失敗，而且不會報錯，看起來像成功。所以先複製到英文路徑再做（PowerShell）：

```
robocopy E:\洋蔥地圖\Onion-Map\server\painter C:\onion-painter /MIR /XD node_modules .wrangler dist
cd C:\onion-painter
npm install
npx wrangler login
npx wrangler secret put OPENAI_API_KEY
npx wrangler deploy
```

`secret put` 會問你金鑰，貼上去就好，不要寫進任何檔案。第一次它會問要不要先建一個 Worker，選要。

部署完印出來的網址，用這個確認真的上去了（代號隨便打，16 個字以上）：

```
curl.exe -H "X-Onion-Token: test-device-0000000001" https://onion-painter.<你的帳號>.workers.dev/ping
```

要看到 `"kind":"cloud"`。之後改張數或模型，改 `wrangler.jsonc` 的 `vars` 再部署一次。

## 擋了什麼

- 手機自己產生一組隨機代號當 `X-Onion-Token`，16 到 128 個英數字、`-`、`_`。伺服器只存它的雜湊。別人的代號拿不到你的圖。
- 每個代號每天 1 張，台北時間半夜換日，失敗不扣。一天最多試 5 次，免得有人一直送會失敗的圖。
- 全站每天 50 張，到了就回 429。代號可以亂造，所以最後擋住帳單的是這一條和 OpenAI 的花費上限。有人惡意洗的話，會把當天全站的張數用完。
- 同一個 IP 一分鐘最多送 6 次，超過回 429。這是各機房各自算的，擋亂按夠用。
- 同一張最多叫 OpenAI 兩次，第二次只有在它說很忙或連不上的時候。
- 還沒開始畫就取消會還張數，畫到一半取消不還。
- 畫太久（5 分鐘）算失敗、張數會還，可是 OpenAI 那邊可能已經算錢。
- 記錄檔只有狀態碼，沒有圖、沒有金鑰。

## 測試

```
npm install
npm test
```

在本機的 workerd 裡跑真的 Worker 和 Durable Object，只有 OpenAI 是假的。`npm run check` 只打包不部署。

提示詞的正本在 `tools/painter/prompts.mjs`，這裡的 `src/prompts.mjs` 是複本，`tools/painter` 的測試會比對兩份有沒有一樣。
