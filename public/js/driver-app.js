// Flow Taxi 司機全螢幕調度中心 PWA 核心腳本
// 整合 Leaflet 100% 穩定出圖、車牌/電話秒速登入、避免 LINE 400 Bad Request

(function () {
  'use strict';

  // 系統設定
  let config = {
    googleMapsApiKey: '',
    oaUrl: 'https://lin.ee/AOp42u7',
    dispatchPhone: '02-23456789',
    liffId: '',
  };

  // 司機身分狀態
  let currentDriver = {
    userId: 'driver_guest',
    displayName: '未登入',
    plateNumber: '點此驗證車牌',
    carBrand: '',
    carColor: '',
    phone: '',
    notes: '🚭 禁菸 🚯 禁食',
    isVerified: false,
  };

  let currentGps = {
    lat: 25.0478, // 台北車站預設
    lng: 121.5170,
    hasRealGps: false,
  };

  let nearbyOrders = [];
  let knownOrderIds = new Set();
  let activeTrip = null;
  let tripStage = 'accepted';
  let pollTimer = null;

  // Leaflet 地圖物件
  let radarMap = null;
  let radarDriverMarker = null;
  let radarCircle = null;
  let radarOrderMarkers = [];
  let trackingMap = null;
  let trackingMarkers = [];
  let trackingPolyline = null;

  // -------------------------------------------------------------
  // 1. 初始化進入點
  // -------------------------------------------------------------
  async function init() {
    setupDomListeners();
    await fetchConfig();
    await initDriverIdentity();
    startGpsTracking();
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
      console.warn('[Driver App] 載入 /api/config 失敗:', e);
    }
  }

  // -------------------------------------------------------------
  // 3. 司機身分驗證與登入 (支援車牌/電話反查 + LINE In-App 授權)
  // -------------------------------------------------------------
  async function initDriverIdentity() {
    // 步驟 A: 優先讀取 LocalStorage 本機快取
    const cachedProfile = localStorage.getItem('flow_taxi_driver_profile');
    if (cachedProfile) {
      try {
        const parsed = JSON.parse(cachedProfile);
        if (parsed && parsed.isVerified) {
          currentDriver = parsed;
          updateDriverUi();
          checkAuthBar();
          return;
        }
      } catch (e) {}
    }

    // 步驟 B: 若在 LINE 內部開啟 (LIFF)，嘗試靜默自動登入
    if (typeof liff !== 'undefined' && config.liffId) {
      try {
        await liff.init({ liffId: config.liffId });
        if (liff.isLoggedIn()) {
          const profile = await liff.getProfile();
          currentDriver.userId = profile.userId;

          const res = await fetch(`/api/driver/${profile.userId}`);
          if (res.ok) {
            const data = await res.json();
            if (data && data.registered) {
              currentDriver = {
                userId: data.line_user_id || profile.userId,
                displayName: data.display_name || profile.displayName,
                plateNumber: data.plate_number || 'TDC-8888',
                carBrand: data.car_brand || 'TOYOTA',
                carColor: data.car_color || '黑色',
                phone: data.phone || '',
                notes: data.notes || '',
                isVerified: true,
              };
              saveCurrentDriver();
              updateDriverUi();
              checkAuthBar();
              return;
            }
          }
        }
      } catch (liffErr) {
        console.warn('[Driver App] LIFF 靜默登入跳過:', liffErr);
      }
    }

    // 步驟 C: 若尚未登入，更新 UI 為未登入狀態並顯示提示
    updateDriverUi();
    checkAuthBar();
  }

  function saveCurrentDriver() {
    localStorage.setItem('flow_taxi_driver_id', currentDriver.userId);
    localStorage.setItem('flow_taxi_driver_profile', JSON.stringify(currentDriver));
  }

  function checkAuthBar() {
    const authBar = document.getElementById('auth-reminder-bar');
    if (!authBar) return;
    if (currentDriver.isVerified) {
      authBar.classList.add('hidden');
    } else {
      authBar.classList.remove('hidden');
    }
  }

  function updateDriverUi() {
    const nameEl = document.getElementById('driver-card-name');
    const plateEl = document.getElementById('driver-card-plate');
    const avatarTxt = document.getElementById('driver-card-avatar-text');
    const headerAvatar = document.getElementById('header-avatar-initial');
    const drawerTitle = document.getElementById('drawer-driver-title');
    const drawerAvatar = document.getElementById('drawer-avatar-txt');
    const statusOnline = document.getElementById('stat-online-status');
    const statusBadgeWrap = document.getElementById('driver-status-badge-wrap');
    const statusDot = document.getElementById('driver-status-ping-dot');
    const avatarDot = document.getElementById('driver-avatar-online-dot');

    const name = currentDriver.displayName || '未登入';
    const plate = currentDriver.plateNumber || '點此驗證車牌';
    const initial = currentDriver.isVerified && name ? name.slice(0, 1) : '？';

    if (nameEl) nameEl.textContent = name;
    if (plateEl) plateEl.textContent = plate;
    if (avatarTxt) avatarTxt.textContent = initial;
    if (headerAvatar) headerAvatar.textContent = initial;
    if (drawerTitle) drawerTitle.textContent = `${name} (司機中心)`;
    if (drawerAvatar) drawerAvatar.textContent = initial;

    if (currentDriver.isVerified) {
      if (statusOnline) statusOnline.textContent = '營業中';
      if (statusBadgeWrap) {
        statusBadgeWrap.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-xs font-black shadow-sm';
      }
      if (statusDot) {
        statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-ping';
      }
      if (avatarDot) {
        avatarDot.className = 'absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-[#0f172a]';
      }
    } else {
      if (statusOnline) statusOnline.textContent = '待命中';
      if (statusBadgeWrap) {
        statusBadgeWrap.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-400 text-xs font-black shadow-sm';
      }
      if (statusDot) {
        statusDot.className = 'w-2 h-2 rounded-full bg-amber-400';
      }
      if (avatarDot) {
        avatarDot.className = 'absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-amber-500 ring-2 ring-[#0f172a]';
      }
    }

    // 表單同步
    const inputName = document.getElementById('input-display-name');
    const inputPlate = document.getElementById('input-plate-number');
    const inputBrand = document.getElementById('input-car-brand');
    const inputColor = document.getElementById('input-car-color');
    const inputPhone = document.getElementById('input-driver-phone');
    const inputNotes = document.getElementById('input-driver-notes');

    if (inputName) inputName.value = currentDriver.displayName || '';
    if (inputPlate) inputPlate.value = currentDriver.plateNumber === '點此驗證車牌' ? '' : (currentDriver.plateNumber || '');
    if (inputBrand) inputBrand.value = currentDriver.carBrand || '';
    if (inputColor) inputColor.value = currentDriver.carColor || '';
    if (inputPhone) inputPhone.value = currentDriver.phone || '';
    if (inputNotes) inputNotes.value = currentDriver.notes || '';
  }

  // 司機車牌 / 電話快速反查與登入
  async function performDriverLookup(queryStr) {
    const errorEl = document.getElementById('lookup-modal-error');
    if (errorEl) errorEl.classList.add('hidden');

    if (!queryStr || queryStr.trim().length < 2) {
      if (errorEl) {
        errorEl.textContent = '請輸入至少 2 碼車牌或電話號碼';
        errorEl.classList.remove('hidden');
      }
      return;
    }

    const cleanQ = queryStr.trim();

    try {
      const res = await fetch(`/api/driver/lookup?q=${encodeURIComponent(cleanQ)}`);
      const data = await res.json();

      if (res.ok && data.driver) {
        const d = data.driver;
        currentDriver = {
          userId: d.line_user_id || `driver_${Date.now()}`,
          displayName: d.display_name || '優質司機',
          plateNumber: d.plate_number || cleanQ.toUpperCase(),
          carBrand: d.car_brand || 'TOYOTA',
          carColor: d.car_color || '黑色',
          phone: d.phone || '',
          notes: d.notes || '',
          isVerified: true,
        };

        saveCurrentDriver();
        updateDriverUi();
        checkAuthBar();
        document.getElementById('driver-lookup-modal')?.classList.add('hidden');
        alert(`🎉 登入成功！歡迎回來，${currentDriver.displayName}（車牌：${currentDriver.plateNumber}）！`);

        fetchNearbyOrders();
        fetchActiveTrip();
        return;
      }

      // 若查無資料，提供快速以該車牌建立並登入（絕不讓司機卡住）
      const confirmCreate = confirm(`查無車牌/電話「${cleanQ}」的歷史紀錄。\n是否要直接以車號【${cleanQ.toUpperCase()}】立即登入並開通接單權限？`);
      if (confirmCreate) {
        const newUserId = `driver_${Date.now()}`;
        const newPlate = cleanQ.toUpperCase();
        const newName = `${newPlate} 司機`;

        const regRes = await fetch('/api/driver/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: newUserId,
            displayName: newName,
            plateNumber: newPlate,
            carBrand: 'TOYOTA',
            carColor: '黑色',
            phone: cleanQ.startsWith('09') ? cleanQ : '',
            notes: '🚭 禁菸 🚯 禁食',
          }),
        });

        if (regRes.ok) {
          currentDriver = {
            userId: newUserId,
            displayName: newName,
            plateNumber: newPlate,
            carBrand: 'TOYOTA',
            carColor: '黑色',
            phone: '',
            notes: '🚭 禁菸 🚯 禁食',
            isVerified: true,
          };
          saveCurrentDriver();
          updateDriverUi();
          checkAuthBar();
          document.getElementById('driver-lookup-modal')?.classList.add('hidden');
          alert(`✅ 已成功以車號【${newPlate}】建立並登入！祝您出車平安！`);
          fetchNearbyOrders();
        }
      }
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = '查詢時發生網路錯誤，請稍後重試';
        errorEl.classList.remove('hidden');
      }
    }
  }

  // -------------------------------------------------------------
  // 4. Leaflet 互動地圖 (絕對尺寸 + OpenStreetMap 瓦片保證 100% 出圖)
  // -------------------------------------------------------------
  function initLeafletRadarMap() {
    const mapContainer = document.getElementById('radar-map-canvas');
    if (!mapContainer) return;

    if (typeof L === 'undefined') {
      console.warn('[Map] Leaflet 庫加載中，300ms 後重試...');
      setTimeout(initLeafletRadarMap, 300);
      return;
    }

    if (radarMap) {
      radarMap.invalidateSize(true);
      return;
    }

    try {
      radarMap = L.map('radar-map-canvas', {
        center: [currentGps.lat, currentGps.lng],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
      });

      // 採用 OpenStreetMap 全球官方圖磚（保證無驗證阻擋，穩定度 100%）
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(radarMap);

      // 司機車輛即時呼吸光圈 Marker
      const driverIcon = L.divIcon({
        className: 'custom-driver-pin',
        html: `
          <div class="relative w-8 h-8 flex items-center justify-center">
            <span class="absolute inset-0 rounded-full bg-emerald-500/40 animate-ping"></span>
            <div class="w-8 h-8 rounded-full bg-slate-900 ring-2 ring-emerald-400 shadow-xl flex items-center justify-center text-sm font-bold text-amber-400">
              🚖
            </div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      radarDriverMarker = L.marker([currentGps.lat, currentGps.lng], { icon: driverIcon }).addTo(radarMap);

      // 1.5km 半徑覆蓋光圈
      radarCircle = L.circle([currentGps.lat, currentGps.lng], {
        radius: 1500,
        color: '#10b981',
        weight: 1.5,
        opacity: 0.8,
        fillColor: '#10b981',
        fillOpacity: 0.08,
      }).addTo(radarMap);

      updateRadarOrderMarkers(nearbyOrders);

      setTimeout(() => {
        if (radarMap) radarMap.invalidateSize(true);
      }, 150);

      console.log('[Leaflet Map] 1.5km 雷達地圖載入成功！');
    } catch (e) {
      console.error('[Leaflet Map Init Error]', e);
    }
  }

  function updateRadarDriverGps(lat, lng) {
    if (!radarMap) return;
    if (radarDriverMarker) radarDriverMarker.setLatLng([lat, lng]);
    if (radarCircle) radarCircle.setLatLng([lat, lng]);
  }

  function updateRadarOrderMarkers(orders) {
    if (!radarMap || typeof L === 'undefined') return;

    radarOrderMarkers.forEach(m => radarMap.removeLayer(m));
    radarOrderMarkers = [];

    orders.forEach(ord => {
      const lat = ord.pickup_lat || (currentGps.lat + (Math.random() - 0.5) * 0.015);
      const lng = ord.pickup_lng || (currentGps.lng + (Math.random() - 0.5) * 0.015);

      const orderIcon = L.divIcon({
        className: 'custom-order-pin',
        html: `
          <div class="px-2.5 py-1 rounded-full bg-slate-900 text-white text-[11px] font-black shadow-xl ring-2 ring-emerald-400 flex items-center gap-1 cursor-pointer transform hover:scale-110 transition">
            <span class="text-xs">📍</span>
            <span>搶單</span>
          </div>
        `,
        iconSize: [60, 24],
        iconAnchor: [30, 12],
      });

      const marker = L.marker([lat, lng], { icon: orderIcon }).addTo(radarMap);
      marker.bindPopup(`
        <div class="text-xs space-y-1 p-1">
          <p class="font-extrabold text-slate-900">${escapeHtml(ord.pickup_address || '上車點')}</p>
          <p class="text-[11px] text-slate-500">距您約 ${ord.distance_km ? ord.distance_km.toFixed(1) : 1.2} km</p>
          <a href="/driver/bid?orderId=${ord.id}&source=web" class="inline-block mt-1 px-3 py-1 bg-emerald-600 text-white rounded-lg font-bold text-center w-full">前往接單</a>
        </div>
      `);

      radarOrderMarkers.push(marker);
    });
  }

  function initTrackingMap(order) {
    const mapContainer = document.getElementById('tracking-map-canvas');
    if (!mapContainer || typeof L === 'undefined') return;

    if (!trackingMap) {
      trackingMap = L.map('tracking-map-canvas', {
        center: [currentGps.lat, currentGps.lng],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(trackingMap);
    }

    trackingMarkers.forEach(m => trackingMap.removeLayer(m));
    trackingMarkers = [];
    if (trackingPolyline) trackingMap.removeLayer(trackingPolyline);

    const pickupLat = currentGps.lat + 0.003;
    const pickupLng = currentGps.lng + 0.003;

    const dMarker = L.marker([currentGps.lat, currentGps.lng]).addTo(trackingMap);
    trackingMarkers.push(dMarker);

    const pMarker = L.marker([pickupLat, pickupLng]).addTo(trackingMap);
    trackingMarkers.push(pMarker);

    trackingPolyline = L.polyline([
      [currentGps.lat, currentGps.lng],
      [pickupLat, pickupLng]
    ], {
      color: '#10b981',
      weight: 4,
      dashArray: '6, 8',
    }).addTo(trackingMap);

    trackingMap.fitBounds([[currentGps.lat, currentGps.lng], [pickupLat, pickupLng]], { padding: [40, 40] });
  }

  // -------------------------------------------------------------
  // 5. GPS 定位追蹤
  // -------------------------------------------------------------
  function startGpsTracking() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        onGpsSuccess,
        onGpsError,
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
      );

      navigator.geolocation.watchPosition(
        (pos) => {
          currentGps.lat = pos.coords.latitude;
          currentGps.lng = pos.coords.longitude;
          currentGps.hasRealGps = true;
          updateRadarDriverGps(currentGps.lat, currentGps.lng);
        },
        null,
        { enableHighAccuracy: true, maximumAge: 10000 }
      );
    }
  }

  function onGpsSuccess(pos) {
    currentGps.lat = pos.coords.latitude;
    currentGps.lng = pos.coords.longitude;
    currentGps.hasRealGps = true;
    updateRadarDriverGps(currentGps.lat, currentGps.lng);
    if (radarMap) radarMap.panTo([currentGps.lat, currentGps.lng]);
    fetchNearbyOrders();
  }

  function onGpsError(err) {
    console.warn('[GPS] 瀏覽器回報定位超時，使用預設座標:', err.message);
    fetchNearbyOrders();
  }

  // -------------------------------------------------------------
  // 6. 輪詢 1.5km 訂單與活躍任務
  // -------------------------------------------------------------
  function startPolling() {
    fetchNearbyOrders();
    fetchActiveTrip();

    if (pollTimer) clearInterval(pollTimer);
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

      checkNewOrdersNotification(orders);
      renderOrdersList(orders);
      updateRadarOrderMarkers(orders);

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

  function triggerNewOrderAlert(order) {
    playChime();

    const bellDot = document.getElementById('bell-dot');
    const navDot = document.getElementById('nav-dashboard-badge');
    if (bellDot) bellDot.classList.remove('hidden');
    if (navDot) navDot.classList.remove('hidden');

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
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {}
  }

  // -------------------------------------------------------------
  // 7. 渲染訂單清單 (參照圖片截圖 Recent Walker 列表)
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
  // 8. 活躍任務查詢與狀態控制 (Tracking Mode)
  // -------------------------------------------------------------
  async function fetchActiveTrip() {
    if (!currentDriver.userId || currentDriver.userId === 'driver_guest') return;
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

    const targetAddr = (tripStage === 'picked_up') ? order.dropoff_address : order.pickup_address;
    if (extNavBtn) {
      extNavBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(targetAddr || '台北車站')}&travelmode=driving`;
    }

    updateTripProgressAndAction(order);
    initTrackingMap(order);
  }

  function updateTripProgressAndAction(order) {
    const fillEl = document.getElementById('trip-progress-fill');
    const knobEl = document.getElementById('trip-progress-knob');
    const mainActionBtn = document.getElementById('btn-trip-main-action');
    const actionText = document.getElementById('trip-main-action-text');
    const actionIcon = document.getElementById('trip-main-action-icon');

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

      // 當容器顯示時，確保 Leaflet 已初始化並重算尺寸
      if (!radarMap) {
        initLeafletRadarMap();
      }

      setTimeout(() => {
        if (radarMap) {
          radarMap.invalidateSize(true);
          radarMap.panTo([currentGps.lat, currentGps.lng]);
        }
      }, 100);
    } else if (viewName === 'tracking') {
      if (viewTracking) viewTracking.classList.remove('hidden');
      setTimeout(() => {
        if (trackingMap) trackingMap.invalidateSize(true);
      }, 100);
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
      // 開啟選單時預先更新歷史統計
      loadHistoryOrders();
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
    const dashOrdersEl = document.getElementById('dash-total-orders');
    const badgeOrdersEl = document.getElementById('history-total-badge');

    if (!listEl) return;
    listEl.innerHTML = '<p class="text-slate-400 text-center py-6">載入歷史訂單中...</p>';

    try {
      const res = await fetch(`/api/driver/${currentDriver.userId}/history-orders`);
      if (!res.ok) throw new Error('查詢失敗');
      const data = await res.json();
      const orders = data.orders || [];

      // 更新 Dashboard 與歷史清單數量徽章
      if (dashOrdersEl) dashOrdersEl.textContent = `${orders.length} 單`;
      if (badgeOrdersEl) badgeOrdersEl.textContent = `${orders.length} 筆`;

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
    // 底部導覽列
    document.getElementById('nav-btn-dashboard')?.addEventListener('click', () => switchView('dashboard'));
    document.getElementById('nav-btn-map')?.addEventListener('click', () => switchView('map'));
    document.getElementById('nav-btn-menu')?.addEventListener('click', openSideDrawer);
    document.getElementById('btn-open-drawer')?.addEventListener('click', openSideDrawer);
    document.getElementById('btn-close-drawer')?.addEventListener('click', closeSideDrawer);
    document.getElementById('drawer-backdrop')?.addEventListener('click', closeSideDrawer);

    // 切換地圖捷徑
    document.getElementById('btn-toggle-map-shortcut')?.addEventListener('click', () => switchView('map'));
    document.getElementById('btn-map-show-list')?.addEventListener('click', () => switchView('dashboard'));
    document.getElementById('btn-tracking-back')?.addEventListener('click', () => switchView('dashboard'));
    document.getElementById('btn-switch-to-tracking')?.addEventListener('click', () => switchView('tracking'));

    // Hero 掃描按鈕
    document.getElementById('btn-hero-radar-refresh')?.addEventListener('click', () => {
      fetchNearbyOrders();
      alert('已重新掃描半徑 1.5km 內叫車訂單！');
    });

    // 地圖重置中心點按鈕
    document.getElementById('btn-recenter-map')?.addEventListener('click', () => {
      startGpsTracking();
      if (radarMap) {
        radarMap.panTo([currentGps.lat, currentGps.lng]);
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

    // 司機身分登入 Modal
    const openLookupModal = () => {
      const modal = document.getElementById('driver-lookup-modal');
      const err = document.getElementById('lookup-modal-error');
      if (err) err.classList.add('hidden');
      if (modal) modal.classList.remove('hidden');
      const input = document.getElementById('input-lookup-query');
      if (input) {
        setTimeout(() => input.focus(), 150);
      }
    };

    document.getElementById('btn-quick-lookup-login')?.addEventListener('click', openLookupModal);
    document.getElementById('driver-card-plate')?.addEventListener('click', openLookupModal);
    document.getElementById('btn-drawer-switch-driver')?.addEventListener('click', () => {
      closeSideDrawer();
      openLookupModal();
    });
    document.getElementById('btn-cancel-lookup')?.addEventListener('click', () => {
      document.getElementById('driver-lookup-modal')?.classList.add('hidden');
    });
    document.getElementById('btn-confirm-lookup')?.addEventListener('click', () => {
      const q = document.getElementById('input-lookup-query')?.value;
      performDriverLookup(q);
    });
    document.getElementById('input-lookup-query')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        performDriverLookup(e.target.value);
      }
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
          currentDriver.isVerified = true;
          saveCurrentDriver();
          updateDriverUi();
          checkAuthBar();
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
