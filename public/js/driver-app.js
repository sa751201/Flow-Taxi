// Flow Taxi 司機全螢幕調度中心 PWA 核心腳本
// 參照 UI 設計截圖 (Modern Mint Green & Dark Pill Cards)

(function () {
  'use strict';

  // 系統狀態
  let config = {
    googleMapsApiKey: '',
    oaUrl: 'https://lin.ee/AOp42u7',
    dispatchPhone: '02-23456789',
    liffId: '',
  };

  let currentDriver = {
    userId: 'driver_default_01',
    displayName: '陳運將',
    plateNumber: 'TDC-8888',
    carBrand: 'TOYOTA RAV4',
    carColor: '黑色',
    phone: '0912-345-678',
    notes: '🚭 禁菸 🚯 禁食',
  };

  let currentGps = {
    lat: 25.0478, // 台北車站預設
    lng: 121.5170,
    hasRealGps: false,
  };

  let nearbyOrders = [];
  let knownOrderIds = new Set();
  let activeTrip = null;
  let tripStage = 'accepted'; // accepted -> arrived -> picked_up -> completed
  let pollTimer = null;
  let radarMap = null;
  let trackingMap = null;
  let radarMarkers = [];
  let trackingMarkers = [];
  let driverCircle = null;
  let googleMapsLoaded = false;

  // -------------------------------------------------------------
  // 1. 初始化進入點
  // -------------------------------------------------------------
  async function init() {
    setupDomListeners();
    await fetchConfig();
    await initDriverIdentity();
    startGpsTracking();
    await loadGoogleMaps();
    startPolling();
    checkUrlParams();
  }

  // -------------------------------------------------------------
  // 2. 取得系統設定
  // -------------------------------------------------------------
  async function fetchConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        config = { ...config, ...data };
        if (config.dispatchPhone) {
          const phoneEl = document.getElementById('modal-phone-num');
          const phoneBtn = document.getElementById('btn-confirm-phone-modal');
          if (phoneEl) phoneEl.textContent = config.dispatchPhone;
          if (phoneBtn) phoneBtn.href = `tel:${config.dispatchPhone.replace(/-/g, '')}`;
        }
        if (config.oaUrl) {
          const oaBtn = document.getElementById('btn-trip-open-oa');
          if (oaBtn) oaBtn.href = config.oaUrl;
        }
      }
    } catch (e) {
      console.warn('[Driver App] 載入 /api/config 失敗，使用預設設定:', e);
    }
  }

  // -------------------------------------------------------------
  // 3. 司機身分驗證與快取
  // -------------------------------------------------------------
  async function initDriverIdentity() {
    // 優先讀取 LocalStorage 快取
    const cachedId = localStorage.getItem('flow_taxi_driver_id');
    const cachedProfile = localStorage.getItem('flow_taxi_driver_profile');

    if (cachedProfile) {
      try {
        currentDriver = JSON.parse(cachedProfile);
      } catch (e) {}
    } else if (cachedId) {
      currentDriver.userId = cachedId;
    }

    // 若支援 LIFF 則嘗試讀取 LINE 使用者資訊
    if (typeof liff !== 'undefined' && config.liffId) {
      try {
        await liff.init({ liffId: config.liffId });
        if (liff.isLoggedIn()) {
          const profile = await liff.getProfile();
          currentDriver.userId = profile.userId;
          if (profile.displayName && !cachedProfile) {
            currentDriver.displayName = profile.displayName;
          }
        }
      } catch (e) {
        console.warn('[Driver App] LIFF 初始化跳過:', e);
      }
    }

    localStorage.setItem('flow_taxi_driver_id', currentDriver.userId);
    localStorage.setItem('flow_taxi_driver_profile', JSON.stringify(currentDriver));

    // 同步嘗試自後端更新司機即時資料
    try {
      const res = await fetch(`/api/driver/${currentDriver.userId}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.display_name) {
          currentDriver.displayName = data.display_name;
          currentDriver.plateNumber = data.plate_number || currentDriver.plateNumber;
          currentDriver.carBrand = data.car_brand || currentDriver.carBrand;
          currentDriver.carColor = data.car_color || currentDriver.carColor;
          currentDriver.phone = data.phone || currentDriver.phone;
          currentDriver.notes = data.notes || currentDriver.notes;
          localStorage.setItem('flow_taxi_driver_profile', JSON.stringify(currentDriver));
        }
      }
    } catch (e) {}

    updateDriverCardUi();
  }

  function updateDriverCardUi() {
    // 主畫面司機卡
    const nameEl = document.getElementById('driver-card-name');
    const plateEl = document.getElementById('driver-card-plate');
    const avatarTxt = document.getElementById('driver-card-avatar-text');
    const headerAvatar = document.getElementById('header-avatar-initial');
    const drawerTitle = document.getElementById('drawer-driver-title');
    const drawerAvatar = document.getElementById('drawer-avatar-txt');

    if (nameEl) nameEl.textContent = currentDriver.displayName;
    if (plateEl) plateEl.textContent = currentDriver.plateNumber;
    const initial = currentDriver.displayName ? currentDriver.displayName.slice(0, 1) : '運';
    if (avatarTxt) avatarTxt.textContent = initial;
    if (headerAvatar) headerAvatar.textContent = initial;
    if (drawerTitle) drawerTitle.textContent = `${currentDriver.displayName} (司機中心)`;
    if (drawerAvatar) drawerAvatar.textContent = initial;

    // 表單同步
    const inputName = document.getElementById('input-display-name');
    const inputPlate = document.getElementById('input-plate-number');
    const inputBrand = document.getElementById('input-car-brand');
    const inputColor = document.getElementById('input-car-color');
    const inputPhone = document.getElementById('input-driver-phone');
    const inputNotes = document.getElementById('input-driver-notes');

    if (inputName) inputName.value = currentDriver.displayName || '';
    if (inputPlate) inputPlate.value = currentDriver.plateNumber || '';
    if (inputBrand) inputBrand.value = currentDriver.carBrand || '';
    if (inputColor) inputColor.value = currentDriver.carColor || '';
    if (inputPhone) inputPhone.value = currentDriver.phone || '';
    if (inputNotes) inputNotes.value = currentDriver.notes || '';
  }

  // -------------------------------------------------------------
  // 4. GPS 司機即時定位追蹤
  // -------------------------------------------------------------
  function startGpsTracking() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        onGpsSuccess,
        onGpsError,
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
      );

      // 持續背景監聽位置更新
      navigator.geolocation.watchPosition(
        (pos) => {
          currentGps.lat = pos.coords.latitude;
          currentGps.lng = pos.coords.longitude;
          currentGps.hasRealGps = true;
          updateRadarMapDriverPos();
        },
        null,
        { enableHighAccuracy: true, maximumAge: 10000 }
      );
    } else {
      console.warn('[Driver App] 瀏覽器不支援 Geolocation');
    }
  }

  function onGpsSuccess(pos) {
    currentGps.lat = pos.coords.latitude;
    currentGps.lng = pos.coords.longitude;
    currentGps.hasRealGps = true;
    console.log(`[GPS] 取得司機目前座標: ${currentGps.lat}, ${currentGps.lng}`);
    updateRadarMapDriverPos();
    fetchNearbyOrders();
  }

  function onGpsError(err) {
    console.warn('[GPS] 無法取得真實座標，使用預設台北座標:', err.message);
    fetchNearbyOrders();
  }

  // -------------------------------------------------------------
  // 5. 輪詢 1.5km 訂單與活躍任務
  // -------------------------------------------------------------
  function startPolling() {
    fetchNearbyOrders();
    fetchActiveTrip();

    if (pollTimer) clearInterval(pollTimer);
    // 每 4 秒自動掃描一次附近派單
    pollTimer = setInterval(() => {
      fetchNearbyOrders();
      fetchActiveTrip();
    }, 4000);
  }

  async function fetchNearbyOrders() {
    try {
      const url = `/api/dispatch/nearby-orders?lat=${currentGps.lat}&lng=${currentGps.lng}&radiusKm=1.5`;
      const res = await fetch(url);
      if (!res.ok) return;

      const data = await res.json();
      const orders = data.orders || [];
      nearbyOrders = orders;

      // 檢查是否有新訂單進入
      checkNewOrdersNotification(orders);
      renderOrdersList(orders);
      updateRadarMapOrders(orders);

      const countBadge = document.getElementById('orders-count-badge');
      if (countBadge) countBadge.textContent = orders.length;

      const mapSubtext = document.getElementById('map-status-subtext');
      if (mapSubtext) mapSubtext.textContent = `已偵測到 ${orders.length} 張可搶訂單`;
    } catch (e) {
      console.warn('[Driver App] 查詢周邊訂單失敗:', e);
    }
  }

  function checkNewOrdersNotification(orders) {
    let hasBrandNew = false;
    let newestOrder = null;

    orders.forEach((ord) => {
      if (!knownOrderIds.has(ord.id)) {
        hasBrandNew = true;
        newestOrder = ord;
        knownOrderIds.add(ord.id);
      }
    });

    if (hasBrandNew && newestOrder) {
      triggerNewOrderAlert(newestOrder);
    }
  }

  // 新單警報音效與頂部橫幅 (Web Audio API 柔和嗶嗶聲)
  function triggerNewOrderAlert(order) {
    playChime();

    // 顯示紅點
    const bellDot = document.getElementById('bell-dot');
    const navDot = document.getElementById('nav-dashboard-badge');
    if (bellDot) bellDot.classList.remove('hidden');
    if (navDot) navDot.classList.remove('hidden');

    // 頂部彈出通知橫幅
    const banner = document.getElementById('new-order-banner');
    const addrEl = document.getElementById('banner-address');
    const distEl = document.getElementById('banner-distance');
    const actionBtn = document.getElementById('banner-action-btn');

    if (banner && addrEl) {
      addrEl.textContent = order.pickup_address || '新叫車訂單';
      if (distEl) {
        distEl.textContent = order.distance_km ? `距離約 ${order.distance_km.toFixed(1)} km` : '1.5km 範圍內';
      }
      actionBtn.onclick = () => {
        banner.classList.add('-translate-y-full');
        banner.classList.add('hidden');
        window.location.href = `/driver/bid?orderId=${order.id}&source=web`;
      };

      banner.classList.remove('hidden');
      requestAnimationFrame(() => {
        banner.classList.remove('-translate-y-full');
      });

      // 6 秒後自動收起橫幅
      setTimeout(() => {
        banner.classList.add('-translate-y-full');
        setTimeout(() => banner.classList.add('hidden'), 300);
      }, 6000);
    }
  }

  function playChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {}
  }

  // -------------------------------------------------------------
  // 6. 渲染訂單清單 (參照圖片截圖 Recent Walker 列表)
  // -------------------------------------------------------------
  function renderOrdersList(orders) {
    const container = document.getElementById('orders-list-container');
    if (!container) return;

    if (!orders || orders.length === 0) {
      container.innerHTML = `
        <div class="py-12 px-6 text-center bg-white rounded-3xl border border-slate-200/70 shadow-sm space-y-3">
          <div class="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center text-2xl radar-pulse-anim">
            📡
          </div>
          <h5 class="text-sm font-extrabold text-slate-800">目前 1.5 km 內暫無即時叫車</h5>
          <p class="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
            雷達正在持續監聽中，當乘客送出叫車需求時，畫面將立即發出通知！
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = orders.map((ord) => {
      const distText = ord.distance_km ? `${ord.distance_km.toFixed(1)} km` : '1.2 km';
      const timeStr = ord.created_at ? formatTime(ord.created_at) : '剛剛';
      const scheduledBadge = ord.note && ord.note.includes('預約') ? '📅 預約' : '⚡ 即時';

      return `
        <div class="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition flex items-center justify-between gap-3">
          <!-- Left: Circular Taxi/Passenger Avatar -->
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-11 h-11 rounded-full bg-emerald-50 text-emerald-700 font-extrabold text-base flex items-center justify-center shrink-0 border border-emerald-200/60">
              🚖
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-slate-900 truncate">乘客叫車</span>
                <span class="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200/50">${scheduledBadge}</span>
                <span class="text-[11px] text-slate-400">${timeStr}</span>
              </div>
              <div class="mt-1 space-y-0.5">
                <p class="text-xs font-bold text-slate-800 truncate flex items-center gap-1">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                  ${escapeHtml(ord.pickup_address || '上車地點')}
                </p>
                <p class="text-[11px] text-slate-500 truncate flex items-center gap-1">
                  <span class="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"></span>
                  ${escapeHtml(ord.dropoff_address || '下車定點')}
                </p>
              </div>
              <div class="flex items-center gap-2 mt-1.5 text-[11px] font-semibold text-emerald-600">
                <span>📍 距您約 ${distText}</span>
                <span>· 60秒媒合</span>
              </div>
            </div>
          </div>

          <!-- Right: Outlined Pill "Book" button -> "搶單" -->
          <div class="shrink-0">
            <a href="/driver/bid?orderId=${ord.id}&source=web"
               class="inline-block px-4 py-2 rounded-full border border-slate-300 hover:border-slate-900 bg-white hover:bg-slate-900 text-slate-900 hover:text-white font-extrabold text-xs shadow-sm transition active:scale-95">
              搶單
            </a>
          </div>
        </div>
      `;
    }).join('');
  }

  // -------------------------------------------------------------
  // 7. 活躍任務查詢與狀態控制 (Tracking Mode)
  // -------------------------------------------------------------
  async function fetchActiveTrip() {
    try {
      const res = await fetch(`/api/driver/${currentDriver.userId}/active-trip`);
      if (!res.ok) return;

      const data = await res.json();
      const reminder = document.getElementById('active-trip-reminder');
      const reminderText = document.getElementById('active-trip-reminder-text');

      if (data.hasActiveTrip && data.order) {
        activeTrip = data.order;
        tripStage = activeTrip.status || 'accepted';

        if (reminder) {
          reminder.classList.remove('hidden');
          if (reminderText) {
            reminderText.textContent = `${activeTrip.pickup_address || '前往上車點'}`;
          }
        }
        renderActiveTripUi(activeTrip);
      } else {
        activeTrip = null;
        if (reminder) reminder.classList.add('hidden');
      }
    } catch (e) {
      console.warn('[Driver App] 查詢活躍任務失敗:', e);
    }
  }

  function renderActiveTripUi(order) {
    const pickupEl = document.getElementById('trip-pickup-addr');
    const dropoffEl = document.getElementById('trip-dropoff-addr');
    const extNavBtn = document.getElementById('btn-trip-ext-nav');
    const passengerName = document.getElementById('trip-passenger-name');

    if (pickupEl) pickupEl.textContent = order.pickup_address || '---';
    if (dropoffEl) dropoffEl.textContent = order.dropoff_address || '---';
    if (passengerName) passengerName.textContent = `乘客 (訂單 #${order.id.slice(-4)})`;

    // 導航目標設定：未上車導往上車點，已上車導往下車點
    const targetAddr = (tripStage === 'picked_up') ? order.dropoff_address : order.pickup_address;
    if (extNavBtn) {
      extNavBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(targetAddr || '台北車站')}&travelmode=driving`;
    }

    // 更新進度條與大按鈕
    updateTripProgressAndAction(order);
    updateTrackingMap(order);
  }

  function updateTripProgressAndAction(order) {
    const fillEl = document.getElementById('trip-progress-fill');
    const knobEl = document.getElementById('trip-progress-knob');
    const mainActionBtn = document.getElementById('btn-trip-main-action');
    const actionText = document.getElementById('trip-main-action-text');
    const actionIcon = document.getElementById('trip-main-action-icon');

    // 進度條階段
    if (tripStage === 'accepted') {
      if (fillEl) fillEl.style.width = '25%';
      if (knobEl) knobEl.style.left = '25%';
      if (actionIcon) actionIcon.textContent = '🔔';
      if (actionText) actionText.textContent = '我已抵達上車地點（到點通知）';
      mainActionBtn.className = 'w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm shadow-lg shadow-emerald-600/30 active:scale-98 transition flex items-center justify-center gap-2';
    } else if (tripStage === 'arrived') {
      if (fillEl) fillEl.style.width = '60%';
      if (knobEl) knobEl.style.left = '60%';
      if (actionIcon) actionIcon.textContent = '🚕';
      if (actionText) actionText.textContent = '乘客已上車（出發前往目的地）';
      mainActionBtn.className = 'w-full py-3.5 px-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm shadow-lg shadow-amber-500/30 active:scale-98 transition flex items-center justify-center gap-2';
    } else if (tripStage === 'picked_up') {
      if (fillEl) fillEl.style.width = '90%';
      if (knobEl) knobEl.style.left = '90%';
      if (actionIcon) actionIcon.textContent = '🏁';
      if (actionText) actionText.textContent = '到達目的地（完成結單）';
      mainActionBtn.className = 'w-full py-3.5 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-sm shadow-lg shadow-slate-900/30 active:scale-98 transition flex items-center justify-center gap-2';
    }
  }

  // 執行任務動作 (到點 / 客上 / 下車結單)
  async function performTripAction() {
    if (!activeTrip) return;
    const btn = document.getElementById('btn-trip-main-action');
    if (btn) btn.disabled = true;

    try {
      let action = 'arrived';
      if (tripStage === 'accepted') {
        action = 'arrived';
      } else if (tripStage === 'arrived') {
        action = 'picked_up';
      } else if (tripStage === 'picked_up') {
        action = 'completed';
      }

      const res = await fetch('/api/driver/trip-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: activeTrip.id,
          driverId: currentDriver.userId,
          action,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        alert(`動作失敗: ${result.error || '伺服器錯誤'}`);
        return;
      }

      alert(result.message || '操作成功！');

      if (action === 'arrived') {
        tripStage = 'arrived';
      } else if (action === 'picked_up') {
        tripStage = 'picked_up';
      } else if (action === 'completed') {
        tripStage = 'completed';
        activeTrip = null;
        switchView('dashboard');
        fetchNearbyOrders();
      }

      if (activeTrip) {
        renderActiveTripUi(activeTrip);
      }
    } catch (e) {
      alert(`網路異常: ${e.message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // -------------------------------------------------------------
  // 8. Google Maps 載入與互動
  // -------------------------------------------------------------
  async function loadGoogleMaps() {
    if (window.google && window.google.maps) {
      googleMapsLoaded = true;
      initRadarMap();
      return;
    }

    if (!config.googleMapsApiKey) {
      console.warn('[Google Maps] 無 API Key，啟用備用 Canvas 地圖渲染');
      renderCanvasMapFallback();
      return;
    }

    try {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${config.googleMapsApiKey}&libraries=geometry`;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        googleMapsLoaded = true;
        initRadarMap();
      };
      script.onerror = () => {
        console.warn('[Google Maps] 載入失敗，使用備用 Canvas 渲染');
        renderCanvasMapFallback();
      };
      document.head.appendChild(script);
    } catch (e) {
      renderCanvasMapFallback();
    }
  }

  function initRadarMap() {
    const mapEl = document.getElementById('radar-map-canvas');
    if (!mapEl || !window.google) return;

    const placeholder = document.getElementById('map-loading-placeholder');
    if (placeholder) placeholder.remove();

    radarMap = new google.maps.Map(mapEl, {
      center: { lat: currentGps.lat, lng: currentGps.lng },
      zoom: 15,
      disableDefaultUI: true,
      zoomControl: false,
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'simplified' }] }
      ],
    });

    // 司機自身光環圓形 (1.5km)
    driverCircle = new google.maps.Circle({
      strokeColor: '#10b981',
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: '#10b981',
      fillOpacity: 0.12,
      map: radarMap,
      center: { lat: currentGps.lat, lng: currentGps.lng },
      radius: 1500, // 1.5km
    });

    updateRadarMapOrders(nearbyOrders);
  }

  function updateRadarMapDriverPos() {
    if (radarMap && driverCircle) {
      const pos = { lat: currentGps.lat, lng: currentGps.lng };
      driverCircle.setCenter(pos);
    }
  }

  function updateRadarMapOrders(orders) {
    if (!radarMap || !window.google) return;

    // 清除舊標記
    radarMarkers.forEach(m => m.setMap(null));
    radarMarkers = [];

    orders.forEach(ord => {
      // 若訂單有經緯度或隨機散佈在附近
      const lat = ord.pickup_lat || (currentGps.lat + (Math.random() - 0.5) * 0.015);
      const lng = ord.pickup_lng || (currentGps.lng + (Math.random() - 0.5) * 0.015);

      const marker = new google.maps.Marker({
        position: { lat, lng },
        map: radarMap,
        title: ord.pickup_address,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: '#0f172a',
          fillOpacity: 1,
          strokeColor: '#34d399',
          strokeWeight: 3,
        },
      });

      marker.addListener('click', () => {
        window.location.href = `/driver/bid?orderId=${ord.id}&source=web`;
      });

      radarMarkers.push(marker);
    });
  }

  function updateTrackingMap(order) {
    const mapEl = document.getElementById('tracking-map-canvas');
    if (!mapEl || !window.google) {
      renderTrackingCanvasFallback(order);
      return;
    }

    if (!trackingMap) {
      trackingMap = new google.maps.Map(mapEl, {
        center: { lat: currentGps.lat, lng: currentGps.lng },
        zoom: 15,
        disableDefaultUI: true,
        styles: [
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        ],
      });
    }

    // 建立上車點與下車點標記
    trackingMarkers.forEach(m => m.setMap(null));
    trackingMarkers = [];

    const pickupMarker = new google.maps.Marker({
      position: { lat: currentGps.lat + 0.003, lng: currentGps.lng + 0.003 },
      map: trackingMap,
      title: '上車點',
      label: '起',
    });
    trackingMarkers.push(pickupMarker);
  }

  function renderCanvasMapFallback() {
    const mapEl = document.getElementById('radar-map-canvas');
    if (!mapEl) return;
    mapEl.innerHTML = `
      <div class="relative w-full h-full bg-[#e2e8f0] flex items-center justify-center overflow-hidden">
        <div class="w-64 h-64 rounded-full border-4 border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center radar-pulse-anim">
          <div class="w-36 h-36 rounded-full border-2 border-emerald-500/60 flex items-center justify-center">
            <div class="w-12 h-12 rounded-full bg-slate-900 text-amber-400 flex items-center justify-center text-xl shadow-lg ring-4 ring-emerald-400">
              🚖
            </div>
          </div>
        </div>
        <div class="absolute bottom-16 text-center">
          <span class="px-3 py-1.5 rounded-full bg-slate-900/90 text-white text-xs font-bold shadow-lg">
            📍 1.5km 雷達覆蓋區 (司機定位就緒)
          </span>
        </div>
      </div>
    `;
  }

  function renderTrackingCanvasFallback(order) {
    const mapEl = document.getElementById('tracking-map-canvas');
    if (!mapEl) return;
    mapEl.innerHTML = `
      <div class="relative w-full h-full bg-[#e2e8f0] flex flex-col items-center justify-center p-4">
        <div class="w-full max-w-xs bg-white/90 backdrop-blur-md rounded-2xl p-4 shadow-lg border border-slate-300 text-center space-y-2">
          <div class="text-2xl">🗺️</div>
          <p class="text-xs font-bold text-slate-800">地圖導航路徑追蹤模式</p>
          <p class="text-[11px] text-slate-500 truncate">目前前往：${escapeHtml(order.pickup_address || '上車地點')}</p>
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------
  // 9. 畫面視圖切換 (Dashboard / Map / Tracking)
  // -------------------------------------------------------------
  function switchView(viewName) {
    const viewDashboard = document.getElementById('view-dashboard');
    const viewMap = document.getElementById('view-map');
    const viewTracking = document.getElementById('view-tracking');

    const navDashboard = document.getElementById('nav-btn-dashboard');
    const navMap = document.getElementById('nav-btn-map');

    if (viewDashboard) viewDashboard.classList.add('hidden');
    if (viewMap) viewMap.classList.add('hidden');
    if (viewTracking) viewTracking.classList.add('hidden');

    if (navDashboard) navDashboard.className = 'relative flex flex-col items-center justify-center text-slate-400 hover:text-emerald-400 active:scale-95 transition';
    if (navMap) navMap.className = 'flex flex-col items-center justify-center text-slate-400 hover:text-emerald-400 active:scale-95 transition';

    if (viewName === 'dashboard') {
      if (viewDashboard) viewDashboard.classList.remove('hidden');
      if (navDashboard) navDashboard.className = 'relative flex flex-col items-center justify-center text-emerald-400 active:scale-95 transition';
    } else if (viewName === 'map') {
      if (viewMap) viewMap.classList.remove('hidden');
      if (navMap) navMap.className = 'flex flex-col items-center justify-center text-emerald-400 active:scale-95 transition';
      if (radarMap && window.google) {
        google.maps.event.trigger(radarMap, 'resize');
        radarMap.setCenter({ lat: currentGps.lat, lng: currentGps.lng });
      }
    } else if (viewName === 'tracking') {
      if (viewTracking) viewTracking.classList.remove('hidden');
      if (trackingMap && window.google) {
        google.maps.event.trigger(trackingMap, 'resize');
      }
    }
  }

  // -------------------------------------------------------------
  // 10. 側邊選單與歷史訂單
  // -------------------------------------------------------------
  function openSideDrawer() {
    const backdrop = document.getElementById('drawer-backdrop');
    const drawer = document.getElementById('side-drawer');
    if (backdrop && drawer) {
      backdrop.classList.remove('hidden');
      drawer.classList.remove('translate-x-full');
    }
  }

  function closeSideDrawer() {
    const backdrop = document.getElementById('drawer-backdrop');
    const drawer = document.getElementById('side-drawer');
    if (backdrop && drawer) {
      drawer.classList.add('translate-x-full');
      setTimeout(() => backdrop.classList.add('hidden'), 300);
    }
  }

  async function loadHistoryOrders() {
    const listEl = document.getElementById('history-orders-list');
    if (!listEl) return;
    listEl.innerHTML = '<p class="text-slate-400 text-center py-6">載入歷史訂單中...</p>';

    try {
      const res = await fetch(`/api/driver/${currentDriver.userId}/history-orders`);
      if (!res.ok) throw new Error('查詢失敗');
      const data = await res.json();
      const orders = data.orders || [];

      if (orders.length === 0) {
        listEl.innerHTML = '<p class="text-slate-400 text-center py-8">尚無過往完成行程記錄</p>';
        return;
      }

      listEl.innerHTML = orders.map((o) => {
        const dateStr = o.created_at ? new Date(o.created_at).toLocaleDateString() : '';
        const fareStr = o.fare ? `$${o.fare} 元` : '跳錶計費';
        return `
          <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
            <div class="flex items-center justify-between text-[11px] font-bold">
              <span class="text-slate-800">${dateStr} #${o.id.slice(-4)}</span>
              <span class="text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">${o.status || '已完成'}</span>
            </div>
            <p class="text-xs font-bold text-slate-900 truncate">起：${escapeHtml(o.pickup_address)}</p>
            <p class="text-[11px] text-slate-500 truncate">迄：${escapeHtml(o.dropoff_address)}</p>
            <p class="text-[11px] font-extrabold text-amber-700 pt-1 border-t border-slate-200/60">${fareStr}</p>
          </div>
        `;
      }).join('');
    } catch (e) {
      listEl.innerHTML = '<p class="text-red-500 text-center py-6">無法取得歷史紀錄</p>';
    }
  }

  // -------------------------------------------------------------
  // 11. 監聽與綁定事件
  // -------------------------------------------------------------
  function setupDomListeners() {
    // 底部導覽按鈕
    document.getElementById('nav-btn-dashboard')?.addEventListener('click', () => switchView('dashboard'));
    document.getElementById('nav-btn-map')?.addEventListener('click', () => switchView('map'));
    document.getElementById('nav-btn-menu')?.addEventListener('click', openSideDrawer);
    document.getElementById('btn-open-drawer')?.addEventListener('click', openSideDrawer);
    document.getElementById('btn-close-drawer')?.addEventListener('click', closeSideDrawer);
    document.getElementById('drawer-backdrop')?.addEventListener('click', closeSideDrawer);

    // 切換地圖按鈕
    document.getElementById('btn-toggle-map-shortcut')?.addEventListener('click', () => switchView('map'));
    document.getElementById('btn-map-show-list')?.addEventListener('click', () => switchView('dashboard'));
    document.getElementById('btn-tracking-back')?.addEventListener('click', () => switchView('dashboard'));
    document.getElementById('btn-switch-to-tracking')?.addEventListener('click', () => switchView('tracking'));

    // Hero 刷新
    document.getElementById('btn-hero-radar-refresh')?.addEventListener('click', () => {
      fetchNearbyOrders();
      alert('已重新掃描半徑 1.5km 內叫車訂單！');
    });

    // 地圖重定位按鈕
    document.getElementById('btn-recenter-map')?.addEventListener('click', () => {
      startGpsTracking();
      if (radarMap && window.google) {
        radarMap.panTo({ lat: currentGps.lat, lng: currentGps.lng });
      }
    });

    // 任務大按鈕
    document.getElementById('btn-trip-main-action')?.addEventListener('click', performTripAction);

    // 中控電話 Modal
    document.getElementById('btn-trip-call-dispatch')?.addEventListener('click', () => {
      document.getElementById('phone-modal')?.classList.remove('hidden');
    });
    document.getElementById('btn-cancel-phone-modal')?.addEventListener('click', () => {
      document.getElementById('phone-modal')?.classList.add('hidden');
    });

    // 側邊 Drawer 分頁切換
    const tabProfileBtn = document.getElementById('tab-btn-profile');
    const tabHistoryBtn = document.getElementById('tab-btn-history');
    const tabProfileContent = document.getElementById('tab-content-profile');
    const tabHistoryContent = document.getElementById('tab-content-history');

    tabProfileBtn?.addEventListener('click', () => {
      tabProfileBtn.className = 'flex-1 py-3 border-b-2 border-emerald-600 text-emerald-600 font-extrabold';
      tabHistoryBtn.className = 'flex-1 py-3 border-b-2 border-transparent hover:text-slate-900';
      tabProfileContent?.classList.remove('hidden');
      tabHistoryContent?.classList.add('hidden');
    });

    tabHistoryBtn?.addEventListener('click', () => {
      tabHistoryBtn.className = 'flex-1 py-3 border-b-2 border-emerald-600 text-emerald-600 font-extrabold';
      tabProfileBtn.className = 'flex-1 py-3 border-b-2 border-transparent hover:text-slate-900';
      tabHistoryContent?.classList.remove('hidden');
      tabProfileContent?.classList.add('hidden');
      loadHistoryOrders();
    });

    // 司機資料更新表單
    document.getElementById('driver-profile-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusEl = document.getElementById('profile-save-status');

      currentDriver.displayName = document.getElementById('input-display-name')?.value || currentDriver.displayName;
      currentDriver.plateNumber = document.getElementById('input-plate-number')?.value || currentDriver.plateNumber;
      currentDriver.carBrand = document.getElementById('input-car-brand')?.value || currentDriver.carBrand;
      currentDriver.carColor = document.getElementById('input-car-color')?.value || currentDriver.carColor;
      currentDriver.phone = document.getElementById('input-driver-phone')?.value || currentDriver.phone;
      currentDriver.notes = document.getElementById('input-driver-notes')?.value || currentDriver.notes;

      try {
        const res = await fetch('/api/driver/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentDriver.userId,
            displayName: currentDriver.displayName,
            plateNumber: currentDriver.plateNumber,
            carBrand: currentDriver.carBrand,
            carColor: currentDriver.carColor,
            phone: currentDriver.phone,
            notes: currentDriver.notes,
          }),
        });

        if (res.ok) {
          localStorage.setItem('flow_taxi_driver_profile', JSON.stringify(currentDriver));
          updateDriverCardUi();
          if (statusEl) {
            statusEl.textContent = '✅ 司機資料已成功更新！';
            statusEl.classList.remove('hidden');
            setTimeout(() => statusEl.classList.add('hidden'), 2500);
          }
        }
      } catch (err) {
        alert('儲存失敗，請檢查網路');
      }
    });
  }

  function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const submittedOrder = params.get('submittedOrder');
    if (submittedOrder) {
      alert(`已成功送出接單出價！\n系統正進行 60 秒媒合評選，請留意即時推播結果！`);
      fetchNearbyOrders();
      fetchActiveTrip();
    }
  }

  // 工具函式
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m];
    });
  }

  function formatTime(isoStr) {
    try {
      const d = new Date(isoStr);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch (e) {
      return '';
    }
  }

  // 啟動應用
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
