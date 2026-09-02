# 環境申請與設定

依序完成,做完 `.env`(見根目錄 `.env.example`)就填得齊。

## A. LINE Developers Console（身分串接的地基）

> ⚠️ 關鍵:Messaging API 與 LINE Login 兩個 channel 必須建在**同一個 Provider**。
> 同一使用者在不同 Provider 會拿到不同 userId,跨 Provider 無法辨識同一人 —
> 司機從 LIFF 拿到的 userId 必須與 webhook 收到的一致,搶單識別才成立。
> 且 channel 建好後**不能搬 Provider**,一開始就要放對。

1. 登入 developers.line.biz。
2. 建立(或選用)一個 **Provider**;下面兩個 channel 都建在這裡。
3. **Messaging API channel**(對應你的官方帳號)
   - Basic settings 記下 **Channel secret** → `LINE_CHANNEL_SECRET`
   - Messaging API 分頁 Issue **Channel access token** → `LINE_CHANNEL_ACCESS_TOKEN`
   - 先開啟 Use webhook(URL 待後端部署好再填)
4. **LINE Login channel**(同一 Provider;App type 選 Web app)
   - ⚠️ LIFF 只能掛在 LINE Login / MINI App channel,不能掛 Messaging API channel。
   - Basic settings 的 **Linked bots** → 指到上面的 Messaging API channel。
5. **建立 LIFF app**(在 LINE Login channel → LIFF 分頁 → Add)
   - Size = Full;Endpoint URL 先填暫時值;Scopes 勾 **profile + openid**;Bot-link = On
   - 記下 **LIFF ID** → `LIFF_ID`
6. OA 加進駕駛群組後,從 webhook 事件抓 **groupId** → `DRIVER_GROUP_ID`

### 回應模式
到 LINE Official Account Manager 後台,把回應設定切到**聊天機器人(Bot)模式**,
webhook 才收得到訊息。若帳號現靠真人回覆,切換會影響現有用法,先評估。

### 權限
若 Provider/channel 是他人所有,你要能建/看到 channel,須為該 **Provider 的成員**;
只當 OA 後台管理員不足。

## B. Supabase
1. 建專案 → 取 `SUPABASE_URL`、service key → `SUPABASE_SERVICE_KEY`
2. SQL Editor 執行 `db/schema.sql`(會 `create extension postgis`)
3. 開啟 RLS;service key 僅後端使用,不入 git

## C. Claude API
1. 取 `ANTHROPIC_API_KEY`(解析用,建議 Haiku 等級輕量模型)

## D. Google Maps Platform
1. 建專案、取 `GOOGLE_MAPS_API_KEY`
2. 先啟用 **Geocoding API**(算距離必要)
3. 之後要精準車程/ETA,再於同專案啟用 Distance Matrix / Directions(同一把 key)

## E. Redis
1. Railway 或其他供應商開一個 Redis → `REDIS_URL`(BullMQ 收集視窗計時用)
