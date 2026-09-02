# 叫車派單系統（LINE OA）— 開發文件包

用 LINE 官方帳號把「叫車 → 派車 → 接單」自動化的派單系統。本資料夾是給
IDE / AI 協作開發的文件包,不含實作程式碼(待開發)。

## 這個包裡有什麼

```
taxi-dispatch/
├── README.md                     ← 你在這裡（人看的進入點）
├── CLAUDE.md                     ← 給 AI agent 的工作指示與閱讀順序
├── .env.example                  ← 環境變數範本
├── docs/
│   ├── SPEC.md                   ← 主技術規格（最重要，先讀這份）
│   ├── SETUP.md                  ← LINE / Supabase / Google 申請與設定步驟
│   └── diagrams/
│       ├── flow_full.mermaid     ← 端到端流程（全局）
│       ├── flow_swimlane.mermaid ← 客戶端 / 司機端 泳道分工
│       └── flow_accept_gate.mermaid ← 接單檢查順序 + 兩層資訊揭露
├── db/
│   └── schema.sql                ← 完整資料表（PostgreSQL + PostGIS）
└── config/
    └── 派單系統參數表.xlsx        ← 營運可調參數（非工程人員維護）
```

## 建議閱讀順序

1. **docs/SPEC.md** — 全貌、架構、核心邏輯規格、安全、分期。
2. **db/schema.sql** — 資料模型與關鍵原子操作。
3. **docs/diagrams/** — 對照流程實作(需 Mermaid 預覽,或貼到 mermaid.live)。
4. **docs/SETUP.md** — 申請 channel、拿 token、設 webhook。
5. **config/*.xlsx** — 車資、獎勵、發券等營運參數的實際數值來源。

## 技術棧

Node.js + Express（Railway）｜Supabase（Postgres + PostGIS）｜Redis + BullMQ｜
LINE Messaging API + LIFF｜Claude API（訊息解析）｜Google Geocoding。

## 開發起點

從 SPEC.md 的 §10 分期,建議先做 **P2 派單核心**(收集視窗 + PostGIS 選最近 +
原子指派)成可跑原型。

## 上線前硬關卡

司機合法載客與個資法遵循 — 動真實流量前務必先確認(非工程項,但會卡營運)。
