-- ============================================================
-- 叫車派單系統 — 資料庫 Schema (PostgreSQL + PostGIS / Supabase)
-- 版本 v1.0
-- 可直接於 Supabase SQL Editor 執行,建立所有資料表。
-- 找最近司機使用 PostGIS 幾何運算。
-- ============================================================

create extension if not exists postgis;   -- 地理查詢(找最近司機)
create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ------------------------------------------------------------
-- 1. 身分與帳號
-- ------------------------------------------------------------

-- 乘客 / 會員:身分即 LINE userId
create table customers (
    line_user_id    text primary key,              -- LINE userId
    display_name    text,                           -- LINE 顯示名(自動抓)
    phone           text,
    region          text,                           -- 常用/推斷區域
    completed_rides integer not null default 0,     -- 會員集點計數(快取;可由 orders 重算)
    activated       boolean not null default false, -- 開通碼啟用狀態(付費 gating,選用)
    created_at      timestamptz not null default now()
);

-- 司機
create table drivers (
    line_user_id text primary key,                  -- LINE userId(接單身分,以 LIFF ID token 驗證)
    display_name text,
    phone        text,
    plate_number text,                              -- 車號
    car_color    text,                              -- 車色
    car_brand    text,                              -- 廠牌
    status       text not null default 'inactive'
                 check (status in ('inactive','active','online')),
    registered   boolean not null default false,    -- 是否完成註冊(接單 gate)
    created_at   timestamptz not null default now()
);

-- 開通碼(乘客付費開通,選用;一次性、綁定 userId)
create table activation_codes (
    code          text primary key,
    status        text not null default 'unused'
                  check (status in ('unused','used')),
    bound_user_id text references customers(line_user_id),
    created_at    timestamptz not null default now(),
    used_at       timestamptz
);

-- 駕駛群組(OA 已加入的接單群組)
create table driver_groups (
    group_id   text primary key,                    -- LINE groupId
    name       text,
    created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. 訂單生命週期
-- ------------------------------------------------------------

-- LLM 解析草稿:累積多則訊息、暫存抽取結果、確認前的狀態
create table draft_orders (
    id           uuid primary key default gen_random_uuid(),
    customer_id  text not null references customers(line_user_id),
    service_type text check (service_type in            -- 服務類型(由開場選單 postback 帶入)
                 ('city','airport','chauffeur','purchase','charter','moving')),
    raw_messages jsonb not null default '[]',       -- 累積原始訊息(debounce 收集)
    parsed       jsonb,                             -- LLM 抽取結果(見 SPEC 6.1)
    intent       text check (intent in
                 ('new_ride','modify','cancel','payment','menu_reply','unknown')),
    status       text not null default 'collecting'
                 check (status in ('collecting','awaiting_confirmation','confirmed','discarded')),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

-- 訂單
create table orders (
    id              uuid primary key default gen_random_uuid(),
    customer_id     text not null references customers(line_user_id),
    service_type    text not null default 'city'
                    check (service_type in
                    ('city','airport','chauffeur','purchase','charter','moving')),
    -- 上車/目的地
    pickup_address  text not null,
    pickup_geog     geography(Point,4326),          -- geocoding 後座標
    dropoff_address text,
    dropoff_geog    geography(Point,4326),
    passenger_count integer not null default 1,
    scheduled_time  timestamptz,                    -- null = 現在
    region          text,
    note            text,
    -- 計算
    distance_km     numeric(6,2),
    fare            integer,                        -- 車資(依 fare_config 公式)
    coupon_id       uuid,                           -- 使用的券(FK 於檔尾補;與 customer_coupons 循環參照)
    -- 狀態機
    status          text not null default 'pending'
                    check (status in
                    ('pending','dispatching','accepted','picked_up','done','cancelled','no_driver')),
    driver_id       text references drivers(line_user_id),
    -- 時間戳
    created_at      timestamptz not null default now(),
    dispatched_at   timestamptz,
    accepted_at     timestamptz,
    picked_up_at    timestamptz,
    completed_at    timestamptz,
    cancelled_at    timestamptz
);
create index on orders (status);
create index on orders (customer_id);
create index on orders (driver_id);

-- 收集視窗:60 秒內司機的接單出價(含當下定位)
create table dispatch_bids (
    id                    uuid primary key default gen_random_uuid(),
    order_id              uuid not null references orders(id),
    driver_id             text not null references drivers(line_user_id),
    driver_geog           geography(Point,4326) not null, -- LIFF 抓到的司機定位
    distance_to_pickup_km numeric(6,2),                   -- 到上車點距離(排序用)
    eta_minutes           integer,                        -- 司機手動選 5/10/15(選填)
    bid_at                timestamptz not null default now(),
    unique (order_id, driver_id)                          -- 一位司機一單只出一次價
);
create index on dispatch_bids (order_id);

-- ------------------------------------------------------------
-- 3. 會員 / 優惠券 / 評價
-- ------------------------------------------------------------

-- 券定義
create table coupons (
    id             uuid primary key default gen_random_uuid(),
    title          text not null,
    discount_type  text not null check (discount_type in ('fixed','percent')),
    discount_value numeric not null,
    min_spend      integer default 0,
    valid_days     integer default 30,          -- 發放後效期(天)
    issue_every_n  integer,                      -- 每滿 N 次完成發一張
    active         boolean not null default true
);

-- 客人持有的券
create table customer_coupons (
    id            uuid primary key default gen_random_uuid(),
    customer_id   text not null references customers(line_user_id),
    coupon_id     uuid not null references coupons(id),
    status        text not null default 'unused'
                  check (status in ('unused','used','expired')),
    issued_at     timestamptz not null default now(),
    expires_at    timestamptz,
    used_at       timestamptz,
    used_order_id uuid                           -- FK 於檔尾補(與 orders 循環參照)
);
create index on customer_coupons (customer_id, status);

-- 評價(乘客對司機;連結不限時,一個月後點也能寫入)
create table ratings (
    id          uuid primary key default gen_random_uuid(),
    order_id    uuid not null references orders(id),
    customer_id text not null references customers(line_user_id),
    driver_id   text references drivers(line_user_id),
    stars       integer check (stars between 1 and 5),
    comment     text,
    created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 4. 設定參數(會一直調的東西放這;程式只讀不寫死)
-- ------------------------------------------------------------

-- 車資公式參數(預留公式)
create table fare_config (
    id         uuid primary key default gen_random_uuid(),
    base_fare  integer not null default 60,     -- 起跳
    per_km     numeric not null default 0,       -- 每公里
    per_minute numeric not null default 0,       -- 每分鐘
    active     boolean not null default true
);

-- 短程獎勵規則
create table reward_rules (
    id                          uuid primary key default gen_random_uuid(),
    short_distance_threshold_km numeric not null default 5,  -- 幾公里以下算短程
    required_short_rides        integer not null default 3,  -- 累積幾單觸發
    reward_type                 text not null
                                check (reward_type in ('fee_reduction','long_ride_priority')),
    fee_reduction_amount        integer,                     -- 減費金額
    priority_duration_hours     integer,                     -- 優先權時長
    active                      boolean not null default true,
    active_from                 timestamptz,
    active_to                   timestamptz
);

-- ------------------------------------------------------------
-- 5. 司機獎勵
-- ------------------------------------------------------------

-- 司機獎勵狀態(兌換後產生)
create table driver_rewards (
    id                    uuid primary key default gen_random_uuid(),
    driver_id             text not null references drivers(line_user_id),
    reward_type           text not null
                          check (reward_type in ('fee_reduction','long_ride_priority')),
    earned_priority_until timestamptz,           -- 長單優先權到期(派單加權用)
    fee_reduction_amount  integer,               -- 待抵扣減費
    status                text not null default 'active'
                          check (status in ('active','consumed','expired')),
    created_at            timestamptz not null default now()
);
create index on driver_rewards (driver_id, status);

-- 行程距離事實表(不可變;每趟完成寫一筆)
create table ride_records (
    id                 uuid primary key default gen_random_uuid(),
    order_id           uuid not null unique references orders(id),
    driver_id          text not null references drivers(line_user_id),
    distance_km        numeric(6,2),
    is_short           boolean not null,          -- 依「當時」閾值判定,存為歷史事實
    fare               integer,
    redeemed_reward_id uuid references driver_rewards(id),  -- 兌換原子標記(NULL=未兌換)
    completed_at       timestamptz not null default now()
);
create index on ride_records (driver_id) where redeemed_reward_id is null; -- 查未兌換短程

-- ------------------------------------------------------------
-- 6. 循環參照外鍵(於此補上)
-- ------------------------------------------------------------
alter table orders
    add constraint fk_orders_coupon
    foreign key (coupon_id) references customer_coupons(id);
alter table customer_coupons
    add constraint fk_cc_used_order
    foreign key (used_order_id) references orders(id);


-- ============================================================
-- 關鍵原子操作範例(供實作參考;一律以「檢查影響筆數」防重複)
-- ============================================================

-- (A) 派單:收集視窗關閉後,選最近司機並原子指派 --------------
-- 選最近(有效長單優先權者加權排前):
--   select b.driver_id, ST_Distance(b.driver_geog, o.pickup_geog) as d
--   from dispatch_bids b join orders o on o.id = b.order_id
--   where b.order_id = :orderId
--   order by
--     (exists (select 1 from driver_rewards r
--              where r.driver_id = b.driver_id
--                and r.reward_type = 'long_ride_priority'
--                and r.status = 'active'
--                and r.earned_priority_until > now())) desc,
--     d asc
--   limit 1;
-- 原子指派(winner = 上面選出者):
--   update orders set status='accepted', driver_id=:winner, accepted_at=now()
--   where id=:orderId and status='dispatching';
--   -- 僅當 affected rows = 1 才算成功;其餘司機回「已指派他人」

-- (B) 會員記點(冪等):僅在訂單「首次」完成時 +1 --------------
--   update orders set status='done', completed_at=now()
--   where id=:orderId and status='picked_up';   -- 唯一狀態轉換
--   -- 若 affected = 1,才 update customers set completed_rides = completed_rides + 1 ...
--   -- (或不存計數,改由 count(orders where status='done') 重算)

-- (C) 券核銷(原子):防同張券用兩次 -------------------------
--   update customer_coupons set status='used', used_at=now(), used_order_id=:orderId
--   where id=:couponId and status='unused';
--   -- 檢查 affected rows = 1

-- (D) 司機短程獎勵兌換(原子):把 N 筆未兌換短程標記已兌換 ------
--   with picked as (
--     select id from ride_records
--     where driver_id=:driverId and is_short=true and redeemed_reward_id is null
--     order by completed_at limit :requiredShortRides
--     for update skip locked
--   )
--   update ride_records set redeemed_reward_id=:newRewardId
--   where id in (select id from picked);
--   -- 僅當標記筆數 = requiredShortRides,才寫入 driver_rewards 發放獎勵
