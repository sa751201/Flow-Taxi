# 給 AI Agent 的工作指示

你要協助開發一套 LINE 官方帳號叫車派單系統。開始寫任何程式前,先完成以下閱讀。

## 先讀
1. `docs/SPEC.md` — 權威規格。架構、資料模型、核心邏輯(§6)、安全(§8)、分期(§10)。
2. `db/schema.sql` — 資料表與關鍵原子操作範例(檔尾註解 A–D)。
3. `docs/diagrams/*.mermaid` — 流程對照。

## 技術棧（勿自行更換）
Node.js + Express on Railway｜Supabase(Postgres + PostGIS)｜Redis + BullMQ｜
LINE Messaging API + LIFF｜Claude API(解析)｜Google Geocoding。

## 實作順序（見 SPEC §10）
P0 地基(webhook + 驗簽 + schema) → P1 司機註冊 → **P2 派單核心(先做原型)** →
P3 下單解析 → P4 兩層揭露/配對 → P5 記點發券 → P6 司機獎勵。

## 不可妥協的規則
- Webhook 一律先驗 `X-Line-Signature`。
- LIFF 一律後端驗 ID token,永不信任前端傳來的 userId。
- 派單指派 / 記點 / 券核銷 / 獎勵兌換 全部用「檢查影響筆數」的原子操作。
- 乘客姓氏電話僅中單後對中單司機揭露,永不進群組;log 不落 PII。
- 兩個 LINE channel(Messaging API + LINE Login)須同一 Provider(userId 一致性)。
- 介面文案、按鈕、錯誤提示與訊息一律嚴格遵循 `docs/UX_WRITING_GUIDELINES.md` (基於 content-designer/ux-writing-skill：Purposeful, Concise, Conversational, Clear)。

## 營運參數
車資、獎勵、發券等數值來自 `config/派單系統參數表.xlsx`(非工程人員維護),
對照見 SPEC §12。程式讀設定,不 hardcode。

## 待人類拍板（見 SPEC §11）
車資公式數字、短程獎勵閾值、發券規則、開通碼是否啟用、距離用直線或 Google。
遇到需要這些值時,向使用者確認,不要自行假設。
