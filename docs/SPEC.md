# 叫車派單系統 — 技術設計文件

> 版本 v1.0 ｜ 給 Claude Code / IDE AI 開發用的總說明
> 搭配檔案:`schema.sql`(資料庫)、`flow.mermaid`(流程圖)

---

## 0. 這份文件怎麼用

把本資料夾三個檔放進 repo。給 AI coding agent 的指示順序:

1. 先讀本文件建立全貌與規格。
2. 在 Supabase 執行 `schema.sql` 建表(需啟用 PostGIS)。
3. 對照 `flow.mermaid` 實作各階段。
4. **§6 核心邏輯**是最容易做錯的地方,實作時逐條對照;**§8 安全**為硬性要求。

---

## 1. 專案概述

用 LINE 官方帳號把「叫車 → 派車 → 接單」自動化,提供司機接單系統與獎勵機制。

**本階段範圍(第一段:後台派單邏輯)**
- 乘客端:在 OA 用自然語言叫車,LLM 解析成結構化訂單。
- 派單:群組廣播 → 司機搶單 → 收集視窗選最近 → 原子指派。
- 完成後:會員記點/發券、司機短程獎勵、評價收集。

**非目標(本階段不做)**
- 即時車輛追蹤(LIFF 無背景定位;留待第二段原生 App)。
- 線上金流/自動扣款(MVP 線下收費)。
- 原生 App、LINE MINI App 認證功能(服務訊息、首頁曝光)。

---

## 2. 系統架構

```
乘客 (LINE OA + LIFF)                     司機 (群組 Flex + LIFF)
        │                                        │
        └──────────────► LINE Messaging API ◄────┘
                              │ webhook
                    ┌─────────▼──────────┐
                    │  後端 (Node/Express │
                    │      on Railway)    │
                    │  ─ webhook 處理      │
                    │  ─ LLM 解析          │
                    │  ─ 派單引擎          │
                    │  ─ 記點/獎勵         │
                    └───┬──────────┬──────┘
             ┌──────────┘          └───────────┐
    ┌────────▼─────────┐            ┌───────────▼──────────┐
    │ Supabase         │            │ 外部 API             │
    │ Postgres+PostGIS │            │ ─ Claude API (解析)  │
    │ Redis (視窗計時) │            │ ─ Google Geocoding   │
    └──────────────────┘            └──────────────────────┘
```

---

## 3. 技術棧與外部服務

| 用途 | 服務 | 費用 |
|---|---|---|
| 後端執行環境 | Railway (Node.js + Express) | 已用 |
| 資料庫 + 地理查詢 | Supabase (Postgres + **PostGIS**) | 已用 |
| 收集視窗計時(正式版) | Redis + BullMQ | 低成本 |
| 收發訊息/群組/@/推播 | LINE Messaging API | 免費(推播有額度) |
| 司機定位 + 身分 + 介面 | LINE LIFF | 免費 |
| 訊息解析(意圖+抽欄位) | Claude API（建議 Haiku 等級輕量模型） | 付費(每則極低) |
| 地址 → 座標 | Google Geocoding API | 付費(有免費額度) |
| 真實車程/ETA(之後) | Google Distance Matrix / Directions | 付費 |

MVP 距離先用**直線(Haversine / PostGIS)**;之後接 Google 只換計算來源,資料結構不變。

---

## 4. 資料模型

完整 DDL 見 `schema.sql`。各表用途:

| 表 | 用途 |
|---|---|
| `customers` | 乘客/會員(身分即 LINE userId),含集點計數 |
| `drivers` | 司機基本資料(車號車色品牌)、註冊狀態 |
| `activation_codes` | 乘客付費開通碼(選用) |
| `driver_groups` | OA 已加入的接單群組 |
| `draft_orders` | LLM 解析草稿(多則累積 + 確認迴圈) |
| `orders` | 訂單主表(狀態機、座標、車資、券) |
| `dispatch_bids` | 收集視窗內司機的接單出價(含定位) |
| `coupons` / `customer_coupons` | 券定義 / 客人持有的券 |
| `ratings` | 乘客對司機評價(不限時) |
| `fare_config` | 車資公式參數 |
| `reward_rules` | 短程獎勵規則參數 |
| `driver_rewards` | 司機獎勵狀態(減費/長單優先) |
| `ride_records` | 每趟行程距離事實表(不可變、供獎勵重算) |

**訂單狀態機**:`pending → dispatching → accepted → picked_up → done`(另有 `cancelled` / `no_driver`)。

---

## 5. 運作流程

見 `flow.mermaid`。三階段:

1. **下單解析**:乘客訊息 → 草稿累積 → LLM 意圖分類+抽欄位 → 確認 Flex → geocoding+車資 → 建單。
2. **派單**:群組廣播(概略)→ 司機開 LIFF(驗身分+註冊 gate+定位)→ 收集視窗 60 秒 → PostGIS 選最近 → 原子指派 → 兩層揭露。
3. **完成後**:司機回報上車 → 完成 → 寫 ride_records → 記點/發券 + 司機獎勵兌換 + 推評價。

顏色:🔵 群組可見概略 / 🟠 僅中單司機或乘客可見的 PII / 🟣 gate(驗證·註冊·原子操作)。

---

## 6. 核心邏輯規格(實作重點)

### 6.0 服務類型選單 + 表單預填(fillInText)
本服務有 6 種服務,開場先讓客人選類型,再依類型把對應表單「預填進輸入框」。

- **入口**:對話開場送一則 Flex(或 Quick Reply),列 6 顆服務按鈕。
- **按鈕動作**:每顆 = **postback**,帶三個屬性:
  - `data`:服務代碼(如 `service=city` / `airport` / `chauffeur` / `purchase` / `charter` / `moving`)
  - `inputOption: "openKeyboard"`
  - `fillInText`:該服務的表單範本(可含 `\n` 換行)
- **效果**:客人一點,鍵盤跳出、範本自動填進輸入框,客人填空後送出。
- **⚠️ 限制**:`fillInText` 上限 **300 字**、支援換行;主要在**手機版 LINE(iOS/Android)**有效,桌機版可能不觸發。範本勿過長。
- **服務 context**:postback 的 `data` 已標明服務別 → 存入 `draft_orders.service_type`;後續訊息進來時,LLM 依對應 schema 解析(機場表單與市區叫車欄位不同)。
- **兩條處理路線**:
  - **表單 + LLM 解析**:市區搭乘(client 多不照填,靠 LLM 兜)、機場接送、酒後代駕(較像表單,預填幫助大)。
  - **走真人**:代購代送、包車、搬運(需求少、需溝通)→ 按鈕點了回「已為您轉專人」,可不預填。
- **定位**:fillInText 是「降摩擦、給格式提示」的前端糖衣,**不保證客人照填**;真正解析仍靠 §6.1 的 LLM,兩者搭配。

### 6.1 乘客訊息解析(LLM)
- **多則累積**:同一乘客的訊息先進 `draft_orders.raw_messages`,加**幾秒 debounce**再一次判斷(乘客常分則丟:地址一則、「網銀」一則、「取消」一則)。
- **意圖分類**:`new_ride / modify / cancel / payment / menu_reply / unknown`。先分類再抽欄位,別把「取消」parse 成新單。
- **欄位抽取 JSON schema**(要求 LLM 嚴格輸出,抽不到填 `null`):
  ```json
  {
    "intent": "new_ride",
    "pickup_address": "林森北路147號",
    "dropoff_address": "內湖大湖街131巷18弄8號",
    "passenger_count": 1,
    "scheduled_time": null,
    "region": "中山區",
    "note": null,
    "payment": null
  }
  ```
- **智慧預設**:時間空=現在;人數空=1;暱稱抓 LINE profile;區域由地址推斷。
- **確認迴圈(安全閘)**:抽完回一張填好的預約單 Flex + 「✅ 正確,叫車」按鈕;乾淨一鍵確認,有歧義才逐項追問。**地址在確認前先 geocoding 驗一次**,查不到或多結果就追問。
- **護欄**:只抽訊息裡真有的,**不准編造地址/時間**;確認後才真的建單;LLM 不碰派單決策與金額計算(那些是確定性程式)。

### 6.2 派單引擎
- 建單後對群組推 Flex(僅概略),`orders.status = pending → dispatching`。
- 接單按鈕做成**開 LIFF 的 uri action**(非 postback),以 ID token 可靠識別司機。
- **收集視窗**:第一位出價開 60 秒窗,期間所有出價寫 `dispatch_bids`(含 `driver_geog`)。MVP 用 `setTimeout`,正式版用 **BullMQ delayed job**(Railway 重啟不丟計時)。
- 窗口關閉 → PostGIS `ST_Distance` 選最近;**有效長單優先權者加權排前**(見 schema 範例 A)。
- **原子指派**:`UPDATE orders SET status='accepted', driver_id=$1 WHERE id=$2 AND status='dispatching'`,affected=1 才算成功。
- 無人接單:30 秒未有出價可**擴大半徑重播**(MVP 可先只做逾時通知)。

### 6.3 兩層資訊揭露
- 群組廣播(tier1):**只有** 人數 / 上車地點 / 目的地。**不含**姓氏電話。
- 指派確定後(tier2):**只對中單司機**(1:1 或其 LIFF)顯示姓氏+電話。**PII 永不進群組**。

### 6.4 司機註冊 gate
- 司機開 LIFF 接單時,後端**先查 `drivers.registered`**;未註冊 → 導去填表(車號車色品牌)→ 存檔 → 再接單。
- 邊界:首次接單填表可能趕不上該張單的收集視窗,**接受即可**(資料已存,下張秒接);UX 提示「首次接單需先建立資料」。

### 6.5 會員記點 + 發券(冪等)
- **冪等**:僅在訂單首次 `picked_up → done` 時 +1(綁唯一狀態轉換,防 webhook 重送)。或不存計數改 count 重算。
- 命中發券規則(每滿 N 次)→ 開 `customer_coupons` → 1:1 推播通知。
- **核銷**:MVP 線下收費,券為「紀錄+通知」,由司機/後台照折後金額收,系統**原子標記**已使用(見 schema 範例 C)。

### 6.6 司機短程獎勵
- 每趟完成寫 `ride_records`,`is_short` 依**當時**閾值判定並存為事實。
- 進度**從紀錄重算**(查未兌換短程數),不用計數器 → 改規則即時生效、可回溯。
- 規則參數全放 `reward_rules`(短程閾值、需幾單、獎勵型別與值),程式只讀不寫死。
- **兌換原子**:把 N 筆未兌換短程標記 `redeemed_reward_id`(`for update skip locked`),滿額才發 `driver_rewards`(見 schema 範例 D)。
- 兌現:`long_ride_priority` 在派單選贏家時加權;`fee_reduction` 於結算折抵。

### 6.7 評價(不限時)
- 完成後推評價 LIFF(星等+選填留言),**連結不設效期**,一個月後點也能寫 `ratings`。
- 記點建議在司機按完成當下就自動 +1(客人零動作、不怕過期);評價為額外邀請,不綁點數。

---

## 7. 端點(建議)

| 端點 | 用途 |
|---|---|
| `POST /webhook` | LINE 事件入口(**先驗 X-Line-Signature**) |
| `POST /liff/driver/accept` | 司機接單:驗 ID token → 查註冊 → 寫 bid |
| `POST /liff/driver/register` | 司機註冊表單提交 |
| `POST /liff/driver/complete` | 司機回報上車 / 行程完成 |
| `POST /liff/rating` | 乘客送出評價 |
| `POST /liff/passenger/confirm` | 乘客確認叫車(或走 postback) |
| `job: closeDispatchWindow` | 收集視窗到期 → 選最近 → 指派(BullMQ) |

---

## 8. 安全需求(硬性)

- **驗簽**:每個 webhook 先驗 `X-Line-Signature`,失敗即拒。
- **LIFF 一律後端驗 ID token**,永不信任前端傳來的 userId。
- **原子操作**:派單指派、記點、券核銷、獎勵兌換全部「檢查影響筆數」。
- **PII 分層**:姓氏電話僅中單後對中單司機揭露,不進群組;log 不落 PII。
- **Supabase RLS**:開啟;service key 僅放後端,不入 git。
- **Secrets**:全走環境變數。

---

## 9. 環境變數(`.env`)

```
# LINE
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
LIFF_ID=
DRIVER_GROUP_ID=

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# Claude
ANTHROPIC_API_KEY=

# Google
GOOGLE_MAPS_API_KEY=

# Redis (BullMQ)
REDIS_URL=

# 業務參數(亦可改由 DB 設定表管理)
DISPATCH_WINDOW_SECONDS=60
NO_DRIVER_EXPAND_SECONDS=30
```

---

## 10. 開發分期(建議順序)

1. **P0 地基**:webhook 骨架 + 驗簽 + 抓 groupId + 執行 `schema.sql`。
2. **P1 司機註冊**:LIFF 註冊 + `drivers` 表(先有司機才談派單)。
3. **P2 派單核心** ⚠️ 最該先做原型:收集視窗 + PostGIS 選最近 + 原子指派。
4. **P3 下單解析**:LLM 意圖+抽欄位 + 確認 Flex + geocoding + 車資。
5. **P4 兩層揭露 + 配對聯絡 + 訂單狀態**。
6. **P5 完成後**:記點 + 發券 + 評價。
7. **P6 司機獎勵**:ride_records + 短程兌換 + 派單加權。

> P2 與各項原子操作是最容易做錯、價值最高處,建議第一個做成可跑原型。

---

## 11. 待拍板的參數/決策(填入設定表或 .env)

- **車資公式**:`fare_config` 的 base_fare / per_km / per_minute 實際數字。
- **短程獎勵**:短程閾值幾公里、需累積幾單、獎勵是減費多少或優先權多久。
- **發券規則**:每滿幾次送什麼券、效期。
- **乘客開通碼 gating** 是否保留(付費才能叫車),或開放所有加好友者。
- **距離**:MVP 直線,或一開始就接 Google 車程。
- **法規/個資身分**:司機合法載客、個資法遵循 — 動真實流量前務必先確認(非工程項,但會卡營運)。

---

## 12. 營運參數來源

上述可調參數(服務項目與表單、計費、司機獎勵、會員/優惠券、系統參數)由非工程人員維護於
`config/派單系統參數表.xlsx`。每個頁籤對應一組設定:

| 頁籤 | 對應 |
|---|---|
| 服務項目與表單 | services 定義 + 開場選單 fillInText 範本(§6.0) |
| 計費邏輯 | `fare_config`(建議按 service_type 分組) |
| 司機獎勵邏輯 | `reward_rules` |
| 會員與優惠券 | `coupons` / `customer_coupons` |
| 系統參數 | `.env` / 系統設定(收集視窗、開通碼等) |

MVP 為人工同步(改表 → 工程更新設定);後續可做小後台讓程式直接讀這些設定表。
