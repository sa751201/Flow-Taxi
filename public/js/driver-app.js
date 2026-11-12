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
    notes: '🚭 禁菸 🚯 禁食 🤮 嘔吐加收3000',
    isVerified: false,
  };

  let currentGps = {
    lat: 25.0478, // 台北車站預設
    lng: 121.5170,
    hasRealGps: false,
  };

  let nearbyOrders = [];
  let knownOrderIds = new Set();
  let isDriverOnline = localStorage.getItem('flow_taxi_driver_online') !== 'false';
  let currentOrderFilter = 'all'; // 'all' | 'instant' | 'scheduled'
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
  // 0. React Bits 觸覺與動效輔助 (Tactile Haptic & Spring Number Ticker)
  // -------------------------------------------------------------
  function triggerHaptic(type = 'light') {
    if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
    try {
      if (type === 'light') navigator.vibrate(10);
      else if (type === 'medium') navigator.vibrate(22);
      else if (type === 'success') navigator.vibrate([15, 45, 20]);
      else if (type === 'heavy') navigator.vibrate(40);
    } catch (_) {}
  }
  window.__triggerHaptic = triggerHaptic;

  function animateNumberTicker(el, fromVal, toVal, duration = 380, prefix = '', suffix = '') {
    if (!el) return;
    const start = Number(fromVal) || 0;
    const end = Number(toVal) || 0;
    if (start === end) {
      el.textContent = `${prefix}${end}${suffix}`;
      return;
    }
    const startTime = performance.now();
    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (end - start) * ease);
      el.textContent = `${prefix}${current}${suffix}`;
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        el.textContent = `${prefix}${end}${suffix}`;
      }
    }
    requestAnimationFrame(tick);
  }
  window.__animateNumberTicker = animateNumberTicker;

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
        if (config.googleMapsApiKey) {
          loadGoogleMapsScript(config.googleMapsApiKey);
        }
      }
    } catch (e) {
      console.warn('[Driver App] 載入 /api/config 失敗:', e);
    }
  }

  function loadGoogleMapsScript(apiKey) {
    if (!apiKey || window.google?.maps || document.getElementById('google-maps-sdk')) return;
    const script = document.createElement('script');
    script.id = 'google-maps-sdk';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.onload = () => {
      console.log('[Google Maps SDK] 動態載入完成');
      if (radarMap && typeof L !== 'undefined' && typeof L.gridLayer?.googleMutant === 'function') {
        try {
          const mutantLayer = L.gridLayer.googleMutant({
            type: 'roadmap',
            styles: CUSTOM_MAP_STYLES,
            maxZoom: 20,
          });
          mutantLayer.addTo(radarMap);
        } catch (e) {}
      }
      if (trackingMap && typeof L !== 'undefined' && typeof L.gridLayer?.googleMutant === 'function') {
        try {
          const mutantLayer = L.gridLayer.googleMutant({
            type: 'roadmap',
            styles: CUSTOM_MAP_STYLES,
            maxZoom: 20,
          });
          mutantLayer.addTo(trackingMap);
        } catch (e) {}
      }
    };
    document.head.appendChild(script);
  }

  // -------------------------------------------------------------
  // 3. 司機身分驗證與登入 (支援車牌/電話反查 + LINE In-App 授權)
  // -------------------------------------------------------------
  async function initDriverIdentity() {
    // 步驟 A: 優先讀取 LocalStorage 本機快取
    const cachedProfile = localStorage.getItem('flow_taxi_driver_profile');
    const cachedId = localStorage.getItem('flow_taxi_driver_id');

    if (cachedProfile) {
      try {
        const parsed = JSON.parse(cachedProfile);
        if (parsed && parsed.isVerified) {
          currentDriver = parsed;
          if (cachedId && (!currentDriver.userId || currentDriver.userId === 'driver_guest')) {
            currentDriver.userId = cachedId;
          }
          updateDriverUi();
          checkAuthBar();
          fetchActiveTrip();
          loadHistoryOrders();
          return;
        }
      } catch (e) {}
    }

    if (cachedId && cachedId !== 'driver_guest') {
      try {
        const res = await fetch(`/api/driver/${encodeURIComponent(cachedId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.registered) {
            currentDriver = {
              userId: data.line_user_id || cachedId,
              displayName: data.display_name || '司機夥伴',
              plateNumber: data.plate_number || '已驗證車牌',
              carBrand: data.car_brand || 'TOYOTA',
              carColor: data.car_color || '黑色',
              phone: data.phone || '',
              notes: data.notes || '',
              isVerified: true,
            };
            saveCurrentDriver();
            updateDriverUi();
            checkAuthBar();
            fetchActiveTrip();
            loadHistoryOrders();
            return;
          }
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

          const res = await fetch(`/api/driver/${encodeURIComponent(profile.userId)}`);
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
              fetchActiveTrip();
              loadHistoryOrders();
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

    if (!isDriverOnline) {
      if (statusOnline) statusOnline.textContent = '已下線';
      if (statusBadgeWrap) {
        statusBadgeWrap.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-xs font-bold shadow-sm';
      }
      if (statusDot) {
        statusDot.className = 'w-2 h-2 rounded-full bg-slate-500';
      }
      if (avatarDot) {
        avatarDot.className = 'absolute bottom-0 right-0 w-3 h-3 rounded-full bg-slate-500 ring-2 ring-slate-950';
      }
    } else if (currentDriver.isVerified) {
      if (statusOnline) statusOnline.textContent = '在線上';
      if (statusBadgeWrap) {
        statusBadgeWrap.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-xs font-black shadow-sm group-hover:bg-emerald-500/30 status-pulse-active';
      }
      if (statusDot) {
        statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-ping';
      }
      if (avatarDot) {
        avatarDot.className = 'absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-slate-950';
      }
    } else {
      if (statusOnline) statusOnline.textContent = '在線上';
      if (statusBadgeWrap) {
        statusBadgeWrap.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-black shadow-sm status-pulse-active';
      }
      if (statusDot) {
        statusDot.className = 'w-2 h-2 rounded-full bg-amber-400';
      }
      if (avatarDot) {
        avatarDot.className = 'absolute bottom-0 right-0 w-3 h-3 rounded-full bg-amber-400 ring-2 ring-slate-950';
      }
    }

    // 車型車色標籤
    const modelTagEl = document.getElementById('driver-card-model-tag');
    if (modelTagEl) {
      if (currentDriver.carBrand || currentDriver.carColor) {
        modelTagEl.textContent = [currentDriver.carBrand, currentDriver.carColor].filter(Boolean).join(' · ');
        modelTagEl.classList.remove('hidden');
      } else {
        modelTagEl.classList.add('hidden');
      }
    }

    // 首頁車卡備註 / 注意事項顯示
    const cardNotesEl = document.getElementById('driver-card-notes-display');
    if (cardNotesEl) {
      cardNotesEl.textContent = currentDriver.notes?.trim() || '🚭 禁菸 🚯 禁食 🤮 嘔吐加收3000';
    }

    // 即時車卡預覽 (乘客視角)
    const prevName = document.getElementById('preview-card-name');
    const prevPlate = document.getElementById('preview-card-plate');
    const prevBrand = document.getElementById('preview-card-brand');
    const prevColor = document.getElementById('preview-card-color');
    const prevNotes = document.getElementById('preview-card-notes');

    if (prevName) prevName.textContent = currentDriver.displayName || '未登入';
    if (prevPlate) prevPlate.textContent = currentDriver.plateNumber && currentDriver.plateNumber !== '點此驗證車牌' ? currentDriver.plateNumber : 'TDC-8888';
    if (prevBrand) prevBrand.textContent = currentDriver.carBrand || 'TOYOTA';
    if (prevColor) prevColor.textContent = currentDriver.carColor || '黑色';
    if (prevNotes) prevNotes.textContent = currentDriver.notes?.trim() || '🚭 禁菸 🚯 禁食 🤮 嘔吐加收3000';

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
    if (inputNotes) {
      inputNotes.value = currentDriver.notes || '';
      updateNotesCountAndPreview();
    }
  }

  function updateNotesCountAndPreview() {
    const inputNotes = document.getElementById('input-driver-notes');
    const countEl = document.getElementById('notes-char-count');
    const prevNotes = document.getElementById('preview-card-notes');
    const cardNotes = document.getElementById('driver-card-notes-display');

    if (!inputNotes) return;
    const val = inputNotes.value;
    if (countEl) countEl.textContent = `${val.length} / 150`;

    const displayVal = val.trim() ? val : '🚭 禁菸 🚯 禁食 🤮 嘔吐加收3000';
    if (prevNotes) prevNotes.textContent = displayVal;
    if (cardNotes) cardNotes.textContent = displayVal;
  }

  function appendQuickNote(tag) {
    const inputNotes = document.getElementById('input-driver-notes');
    if (!inputNotes) return;

    const currentVal = inputNotes.value.trim();
    if (!currentVal || currentVal === '🚭 禁菸 🚯 禁食' || currentVal === '🚭 禁菸 🚯 禁食 🤮 嘔吐加收3000') {
      inputNotes.value = tag;
    } else if (!currentVal.includes(tag)) {
      if ((currentVal + ' ' + tag).length <= 150) {
        inputNotes.value = currentVal + ' ' + tag;
      }
    }
    updateNotesCountAndPreview();
    inputNotes.focus();
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
            notes: '🚭 禁菸 🚯 禁食 🤮 嘔吐加收3000',
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
            notes: '🚭 禁菸 🚯 禁食 🤮 嘔吐加收3000',
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
  // 4. 地圖樣式設定 (使用者自訂 Google Maps JavaScript Style Array)
  // -------------------------------------------------------------
  const CUSTOM_MAP_STYLES = [
    {
      "featureType": "all",
      "elementType": "labels.text",
      "stylers": [
        {
          "color": "#878787"
        }
      ]
    },
    {
      "featureType": "all",
      "elementType": "labels.text.stroke",
      "stylers": [
        {
          "visibility": "off"
        }
      ]
    },
    {
      "featureType": "landscape",
      "elementType": "all",
      "stylers": [
        {
          "color": "#f9f5ed"
        }
      ]
    },
    {
      "featureType": "road.highway",
      "elementType": "all",
      "stylers": [
        {
          "color": "#f5f5f5"
        }
      ]
    },
    {
      "featureType": "road.highway",
      "elementType": "geometry.stroke",
      "stylers": [
        {
          "color": "#c9c9c9"
        }
      ]
    },
    {
      "featureType": "water",
      "elementType": "all",
      "stylers": [
        {
          "color": "#aee0f4"
        }
      ]
    }
  ];

  function createCustomStyledTileLayer() {
    // 優先使用 Google Mutant (帶入使用者指定之 Google Maps JavaScript Style Array)
    if (typeof L !== 'undefined' && typeof L.gridLayer?.googleMutant === 'function' && window.google?.maps) {
      try {
        return L.gridLayer.googleMutant({
          type: 'roadmap',
          styles: CUSTOM_MAP_STYLES,
          maxZoom: 20,
        });
      } catch (err) {
        console.warn('[Map Layer] Google Mutant 初始化失敗，切換至原生 Google Maps 街道圖磚:', err);
      }
    }

    // 原生 Google Maps 繁體中文街道圖磚（包含完整繁中路名、地標與道路幾何，極速載入且無任何浮水印）
    return L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=zh-TW', {
      maxZoom: 20,
      subdomains: ['0', '1', '2', '3'],
      attribution: '© Google Maps',
    });
  }

  function initLeafletRadarMap() {
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

      // 套用自訂地圖樣式（Google Maps Style Array / CartoDB 備援）
      createCustomStyledTileLayer().addTo(radarMap);

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

  async function fetchGeocode(address) {
    if (!address) return null;
    try {
      const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('[Geocode Error]', e);
    }
    return null;
  }

  // 取得真實道路行車路網 (優先呼叫後端 API ➔ 前端 OSRM 備援)
  async function fetchDrivingRoute(originLat, originLng, destLat, destLng) {
    try {
      const res = await fetch(`/api/route?originLat=${originLat}&originLng=${originLng}&destLat=${destLat}&destLng=${destLng}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.coordinates) && data.coordinates.length > 1) {
          return data;
        }
      }
    } catch (e) {
      console.warn('[Route API Error, fallback to OSRM]', e);
    }

    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson`;
      const osrmRes = await fetch(osrmUrl);
      if (osrmRes.ok) {
        const osrmData = await osrmRes.json();
        if (osrmData.code === 'Ok' && osrmData.routes && osrmData.routes[0]) {
          const route = osrmData.routes[0];
          const coords = (route.geometry?.coordinates || []).map((c) => [c[1], c[0]]);
          return {
            success: true,
            coordinates: coords,
            distanceMeters: Math.round(route.distance || 0),
            durationSeconds: Math.round(route.duration || 0),
            provider: 'osrm',
          };
        }
      }
    } catch (err) {
      console.warn('[Direct OSRM Error]', err);
    }

    return null;
  }

  function calculateCoordDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  let lastRouteFetchTime = 0;
  let lastRouteDriverPos = null;

  function initTrackingMap(order) {
    const mapContainer = document.getElementById('tracking-map-canvas');
    if (!mapContainer || typeof L === 'undefined' || !order) return;

    const driverLat = Number(currentGps.lat) || 25.0478;
    const driverLng = Number(currentGps.lng) || 121.5170;

    if (!trackingMap) {
      trackingMap = L.map('tracking-map-canvas', {
        center: [driverLat, driverLng],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
      });

      // 套用自訂地圖樣式（Google Maps Style Array / CartoDB 備援）
      createCustomStyledTileLayer().addTo(trackingMap);
    }

    trackingMarkers.forEach(m => trackingMap.removeLayer(m));
    trackingMarkers = [];
    if (trackingPolyline) {
      trackingMap.removeLayer(trackingPolyline);
      trackingPolyline = null;
    }

    // 依據行程階段決定目的地 (客上前前往上車點，客上後前往下車點)
    const isPickedUp = (tripStage === 'picked_up');
    let targetLat = isPickedUp ? Number(order.dropoff_lat) : Number(order.pickup_lat);
    let targetLng = isPickedUp ? Number(order.dropoff_lng) : Number(order.pickup_lng);
    const targetAddress = isPickedUp ? (order.dropoff_address || '下車地點') : (order.pickup_address || '上車地點');

    const isValidCoord = (lat, lng) => typeof lat === 'number' && !isNaN(lat) && typeof lng === 'number' && !isNaN(lng) && lat > 15 && lng > 100;

    if (!isValidCoord(targetLat, targetLng) && targetAddress && !isDropoffMissing(targetAddress)) {
      console.log(`[Tracking Map] 訂單 ${order.id} 尚無座標，嘗試即時查詢地理座標: "${targetAddress}"`);
      fetchGeocode(targetAddress).then((geo) => {
        if (geo && isValidCoord(geo.lat, geo.lng)) {
          if (isPickedUp) {
            order.dropoff_lat = geo.lat;
            order.dropoff_lng = geo.lng;
          } else {
            order.pickup_lat = geo.lat;
            order.pickup_lng = geo.lng;
          }
          initTrackingMap(order);
        }
      });
      // 暫時保底以司機座標微偏呈現避免出錯
      targetLat = driverLat + 0.003;
      targetLng = driverLng + 0.003;
    }

    // 1. 司機車輛 Marker (帶有呼吸光圈)
    const driverIcon = L.divIcon({
      className: 'tracking-driver-pin',
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
    const dMarker = L.marker([driverLat, driverLng], { icon: driverIcon }).addTo(trackingMap);
    dMarker.bindPopup('<div class="text-xs font-bold text-slate-800 p-1">🚖 您的車輛位置</div>');
    trackingMarkers.push(dMarker);

    // 2. 目標地點 Marker (客上前：上車地點 / 客上後：下車目的地)
    const targetIcon = L.divIcon({
      className: 'tracking-target-pin',
      html: isPickedUp ? `
        <div class="flex flex-col items-center">
          <div class="px-2.5 py-1 rounded-full bg-slate-900 text-amber-400 text-[11px] font-black shadow-xl ring-2 ring-amber-400 flex items-center gap-1 whitespace-nowrap">
            <span>🏁</span>
            <span>下車地點</span>
          </div>
          <div class="w-2 h-2 bg-slate-900 rotate-45 -mt-1 ring-1 ring-amber-400"></div>
        </div>
      ` : `
        <div class="flex flex-col items-center">
          <div class="px-2.5 py-1 rounded-full bg-emerald-600 text-white text-[11px] font-black shadow-xl ring-2 ring-emerald-300 flex items-center gap-1 whitespace-nowrap">
            <span>🟢</span>
            <span>上車地點</span>
          </div>
          <div class="w-2 h-2 bg-emerald-600 rotate-45 -mt-1 ring-1 ring-emerald-300"></div>
        </div>
      `,
      iconSize: [80, 28],
      iconAnchor: [40, 28],
    });
    const tMarker = L.marker([targetLat, targetLng], { icon: targetIcon }).addTo(trackingMap);
    tMarker.bindPopup(`
      <div class="text-xs space-y-1 p-1">
        <p class="font-extrabold text-slate-900">${isPickedUp ? '🏁 目的地（下車地點）' : '🟢 上車地點'}</p>
        <p class="text-[11px] text-slate-600">${escapeHtml(targetAddress)}</p>
      </div>
    `);
    trackingMarkers.push(tMarker);

    // 3. 初始路線折線（先以兩點線起手，隨即由路網引擎替換為真實道路貼地線）
    trackingPolyline = L.polyline([
      [driverLat, driverLng],
      [targetLat, targetLng]
    ], {
      color: isPickedUp ? '#f59e0b' : '#10b981',
      weight: 5,
      dashArray: '6, 8',
      opacity: 0.7,
    }).addTo(trackingMap);

    // 4. 自動適應全螢幕視野
    try {
      trackingMap.fitBounds([[driverLat, driverLng], [targetLat, targetLng]], {
        padding: [50, 50],
        maxZoom: 16,
      });
    } catch {}

    // 5. 立即計算真實道路行車路網 (Real Road Geometry)
    lastRouteFetchTime = Date.now();
    lastRouteDriverPos = { lat: driverLat, lng: driverLng };
    fetchDrivingRoute(driverLat, driverLng, targetLat, targetLng).then((route) => {
      if (!trackingMap || !route || !route.coordinates || route.coordinates.length < 2) return;

      if (trackingPolyline) {
        trackingPolyline.setLatLngs(route.coordinates);
        trackingPolyline.setStyle({
          color: isPickedUp ? '#f59e0b' : '#059669', // 真實道路：翡翠綠 / 琥珀黃實線
          weight: 6,
          dashArray: null, // 實線，貼合真實公路
          opacity: 0.9,
          lineJoin: 'round',
        });
        try {
          trackingMap.fitBounds(trackingPolyline.getBounds(), {
            padding: [50, 50],
            maxZoom: 16,
          });
        } catch {}
      }

      // 更新介面上的即時里程與預估時間
      if (route.distanceMeters) {
        const distKm = (route.distanceMeters / 1000).toFixed(1);
        const mins = Math.max(1, Math.round(route.durationSeconds / 60));
        const etaEl = document.getElementById('trip-eta-text');
        if (etaEl && !isPickedUp) {
          etaEl.textContent = `預計 ${mins} 分鐘抵達 (${distKm} km)`;
        }
        const distEl = document.getElementById('trip-progress-dist-text');
        if (distEl) {
          distEl.textContent = `${distKm} km`;
        }
      }
    });

    setTimeout(() => {
      if (trackingMap) trackingMap.invalidateSize(true);
    }, 150);
  }

  function updateTrackingDriverGps(lat, lng) {
    if (!trackingMap || trackingMarkers.length === 0) return;
    const dMarker = trackingMarkers[0];
    if (dMarker && dMarker.setLatLng) {
      dMarker.setLatLng([lat, lng]);
    }
    if (trackingPolyline && trackingMarkers.length > 1) {
      const targetLatLng = trackingMarkers[1].getLatLng();
      const now = Date.now();
      const distMoved = lastRouteDriverPos
        ? calculateCoordDistanceMeters(lat, lng, lastRouteDriverPos.lat, lastRouteDriverPos.lng)
        : 999;

      // 移動超過 100 公尺或每隔 25 秒重新微調真實道路路徑
      if (distMoved > 100 || (now - lastRouteFetchTime > 25000 && distMoved > 30)) {
        lastRouteFetchTime = now;
        lastRouteDriverPos = { lat, lng };
        fetchDrivingRoute(lat, lng, targetLatLng.lat, targetLatLng.lng).then((route) => {
          if (route && route.coordinates && trackingPolyline) {
            trackingPolyline.setLatLngs(route.coordinates);
          }
        });
      } else {
        const latLngs = trackingPolyline.getLatLngs();
        if (Array.isArray(latLngs) && latLngs.length > 1) {
          latLngs[0] = L.latLng(lat, lng);
          trackingPolyline.setLatLngs(latLngs);
        }
      }
    }
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
          updateTrackingDriverGps(currentGps.lat, currentGps.lng);
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
    updateTrackingDriverGps(currentGps.lat, currentGps.lng);
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
    if (!isDriverOnline) {
      renderOrdersList([]);
      return;
    }
    try {
      const url = `/api/dispatch/nearby-orders?lat=${currentGps.lat}&lng=${currentGps.lng}&radiusKm=50`;
      const res = await fetch(url);
      if (!res.ok) return;

      const data = await res.json();
      const orders = data.orders || [];
      nearbyOrders = orders;

      checkNewOrdersNotification(orders);
      renderOrdersList(orders);
      updateRadarOrderMarkers(orders);

      const countBadge = document.getElementById('orders-count-badge');
      if (countBadge) {
        const prev = parseInt(countBadge.textContent) || 0;
        animateNumberTicker(countBadge, prev, orders.length, 300);
      }

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
  // 7. 渲染可接單清單 (依即時/預約篩選，呈現導航與接單按鈕，支援線上/線下狀態)
  // -------------------------------------------------------------
  function formatWaitTime(isoStr) {
    if (!isoStr) return '剛剛';
    try {
      const diffMs = Date.now() - new Date(isoStr).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins <= 0) return '剛剛';
      if (diffMins < 60) return `${diffMins} 分鐘前`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours} 小時前`;
      return `${Math.floor(diffHours / 24)} 天前`;
    } catch (e) {
      return '剛剛';
    }
  }

  function renderOrdersList(orders) {
    const container = document.getElementById('orders-list-container');
    const heroEmptyBanner = document.getElementById('hero-radar-empty-banner');
    const offlineState = document.getElementById('orders-offline-state');
    const countBadge = document.getElementById('orders-count-badge');

    // 1. 如果司機處於「已下線」狀態
    if (!isDriverOnline) {
      if (offlineState) offlineState.classList.remove('hidden');
      if (heroEmptyBanner) heroEmptyBanner.classList.add('hidden');
      if (container) {
        container.classList.add('hidden');
        container.innerHTML = '';
      }
      if (countBadge) countBadge.textContent = '0';
      return;
    }

    if (offlineState) offlineState.classList.add('hidden');

    // 2. 依照分類篩選 (全部 / ⚡ 即時 / 📅 預約)
    const list = Array.isArray(orders) ? orders : [];
    const filtered = list.filter((ord) => {
      const isSched = Boolean(ord.note && ord.note.includes('預約'));
      if (currentOrderFilter === 'instant') return !isSched;
      if (currentOrderFilter === 'scheduled') return isSched;
      return true;
    });

    if (countBadge) {
      const prev = parseInt(countBadge.textContent) || 0;
      animateNumberTicker(countBadge, prev, filtered.length, 300);
    }

    // 3. 若無符合訂單，顯示輕量雷達掃描卡片
    if (filtered.length === 0) {
      if (heroEmptyBanner) heroEmptyBanner.classList.remove('hidden');
      if (container) {
        container.classList.add('hidden');
        container.innerHTML = '';
      }
      return;
    }

    // 4. 有符合訂單，渲染精緻可接單卡片清單 (參照設計圖風格，搭配 React Bits 彈性進場與微動效)
    if (heroEmptyBanner) heroEmptyBanner.classList.add('hidden');
    if (container) {
      container.classList.remove('hidden');
      container.innerHTML = filtered.map((ord, idx) => {
        const isScheduled = Boolean(ord.note && ord.note.includes('預約'));
        const tagText = isScheduled ? '📅 預約' : '⚡ 即時';
        const tagClass = isScheduled
          ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';

        // 司機到上車點距離
        const distNum = ord.distance_to_driver_km != null ? Number(ord.distance_to_driver_km) : (ord.distance_km != null ? Number(ord.distance_km) : 1.2);
        const distText = `${distNum.toFixed(1)} 公里`;

        const waitTime = formatWaitTime(ord.created_at);
        const shortId = (ord.id || '').slice(0, 7);

        // 全程路線距離與預估車資
        const routeDistText = ord.distance_km && ord.distance_to_driver_km ? `全程約 ${Number(ord.distance_km).toFixed(1)} 公里` : '';
        const fareText = ord.fare ? `$${ord.fare}` : (ord.fare_type === 'fixed' ? '一口價' : '跳錶計費');

        // 乘客備註 (排除內部標記)
        let noteText = (ord.note || '')
          .replace(/\[DRIVER_ARRIVED\]/g, '')
          .replace(/\[SHORT_TRIP_FLAGGED\]/g, '')
          .replace(/\[MOCK_SIMULATION_20261112\]/g, '')
          .trim();

        // 導航與接單連結 (包含 openExternalBrowser=1 避免 LINE 內置瀏覽器導航白畫面)
        const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ord.pickup_address || '')}&travelmode=driving&openExternalBrowser=1`;
        const bidUrl = `/driver/bid?orderId=${encodeURIComponent(ord.id)}&source=web`;

        // 物理交錯進場延遲
        const springDelayMs = Math.min(idx, 8) * 45;

        return `
          <div class="rounded-2xl bg-[#0f172a] text-white p-4 shadow-lg border border-slate-800/90 space-y-3 transition hover:border-slate-700 order-card-spring" style="animation-delay: ${springDelayMs}ms;">
            <!-- 頂部資訊：類別、距離與建立時間、單號 -->
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="text-xs font-extrabold px-2.5 py-0.5 rounded-full ${tagClass}">
                  ${tagText}
                </span>
                <span class="text-sm font-black text-amber-400">
                  距離 ${distText}
                </span>
              </div>
              <div class="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span>待接單 ${waitTime}</span>
                <span class="font-mono text-slate-500 font-bold">#${shortId}</span>
              </div>
            </div>

            <!-- 上下車地點 -->
            <div class="space-y-2 text-sm pt-0.5">
              <div class="flex items-start gap-2.5">
                <span class="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-xs font-black flex items-center justify-center shrink-0 mt-0.5">上</span>
                <div class="min-w-0 flex-1">
                  <p class="font-extrabold text-white text-sm leading-snug break-words">${escapeHtml(ord.pickup_address || '未填寫上車地點')}</p>
                </div>
              </div>
              <div class="flex items-start gap-2.5">
                <span class="w-5 h-5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 text-xs font-black flex items-center justify-center shrink-0 mt-0.5">下</span>
                <div class="min-w-0 flex-1">
                  <p class="font-bold text-slate-300 text-sm leading-snug break-words">${escapeHtml(ord.dropoff_address || '乘客上車後說明')}</p>
                </div>
              </div>
            </div>

            <!-- 底部：行程資訊與快速操作 (導航 / 接單) -->
            <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-3">
              <div class="min-w-0 flex-1 text-xs text-slate-400 space-y-0.5">
                <div class="flex items-center gap-1.5 flex-wrap">
                  ${routeDistText ? `<span class="text-slate-300 font-medium">${routeDistText}</span><span>·</span>` : ''}
                  <span class="font-black text-amber-400">${fareText}</span>
                  ${ord.passengers ? `<span>· 乘客 ${ord.passengers} 人</span>` : ''}
                </div>
                ${noteText ? `<p class="text-[11px] text-slate-400 truncate">備註：${escapeHtml(noteText)}</p>` : ''}
              </div>

              <div class="flex items-center gap-2 shrink-0">
                <a href="${navUrl}" target="_blank" rel="noopener noreferrer"
                   class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700 transition flex items-center gap-1 btn-spring shadow-sm"
                   onclick="window.__triggerHaptic && window.__triggerHaptic('light')"
                   title="以 Google Maps 導航前往上車地點">
                  <svg class="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>
                  <span>導航</span>
                </a>
                <a href="${bidUrl}"
                   class="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs transition flex items-center gap-1 btn-spring btn-shimmer-cta shadow-md shadow-emerald-500/20"
                   onclick="window.__triggerHaptic && window.__triggerHaptic('medium')">
                  <span>⚡ 接單</span>
                </a>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // -------------------------------------------------------------
  // 8. 活躍任務查詢與狀態控制 (Tracking Mode)
  // -------------------------------------------------------------
  async function fetchActiveTrip() {
    const driverIdentifier = currentDriver.userId || currentDriver.plateNumber || localStorage.getItem('flow_taxi_driver_id');
    if (!driverIdentifier || driverIdentifier === 'driver_guest') return;
    try {
      const res = await fetch(`/api/driver/${encodeURIComponent(driverIdentifier)}/active-trip`);
      if (!res.ok) return;

      const data = await res.json();
      const reminder = document.getElementById('active-trip-reminder');
      const reminderText = document.getElementById('active-trip-reminder-text');
      const activeCard = document.getElementById('active-trip-card');

      if (data.hasActiveTrip && data.order) {
        activeTrip = data.order;
        // 優先尊重後端或本地暫存之 arrived 狀態
        const localStage = localStorage.getItem(`active_trip_stage_${activeTrip.id}`);
        if (localStage && activeTrip.status === 'accepted') {
          activeTrip.status = localStage;
        }
        tripStage = activeTrip.status || 'accepted';

        if (reminder) {
          reminder.classList.add('hidden');
        }
        renderActiveTripUi(activeTrip);
        renderActiveTripCard(activeTrip);
      } else {
        if (activeTrip) {
          console.log('[Driver App] 活躍任務已結束或由乘客取消');
          activeTrip = null;
          tripStage = 'idle';
          switchView('dashboard');
          fetchNearbyOrders();
          alert('🔔 此筆訂單已結束或由乘客取消，已為您返回接單大廳！');
        }
        activeTrip = null;
        if (reminder) reminder.classList.add('hidden');
        if (activeCard) activeCard.classList.add('hidden');
      }
    } catch (e) {
      console.warn('[Driver App] 查詢活躍任務失敗:', e);
    } finally {
      fetchScheduledTrips();
    }
  }

  // -------------------------------------------------------------
  // 8.5 預約行程清單查詢 (Scheduled Trips)
  // -------------------------------------------------------------
  async function fetchScheduledTrips() {
    const driverIdentifier = currentDriver.userId || currentDriver.plateNumber || localStorage.getItem('flow_taxi_driver_id');
    if (!driverIdentifier || driverIdentifier === 'driver_guest') return;

    try {
      const res = await fetch(`/api/driver/${encodeURIComponent(driverIdentifier)}/scheduled-trips`);
      if (!res.ok) return;
      const data = await res.json();
      const sec = document.getElementById('scheduled-trips-section');
      const container = document.getElementById('scheduled-trips-container');
      const badge = document.getElementById('scheduled-count-badge');

      if (!sec || !container) return;

      const orders = data.scheduledOrders || [];
      if (badge) badge.textContent = orders.length;

      if (orders.length === 0) {
        sec.classList.add('hidden');
        container.innerHTML = '';
        return;
      }

      sec.classList.remove('hidden');
      container.innerHTML = orders.map(ord => {
        const timeMatch = ord.note?.match(/預約時間:\s*([^\[]+)/);
        const timeText = timeMatch ? timeMatch[1].trim() : (ord.scheduled_time ? new Date(ord.scheduled_time).toLocaleString('zh-TW', { hour12: false }) : '預約時間');
        const fareText = ord.fare && Number(ord.fare) > 0 ? `$${ord.fare}` : '';
        const mapUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ord.pickup_address)}&travelmode=driving&openExternalBrowser=1`;

        return `
          <div class="rounded-2xl bg-white p-4 shadow-sm border border-blue-200/80 space-y-3 relative overflow-hidden">
            <div class="flex items-center justify-between">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-black border border-blue-200">
                <span>📅</span> ${timeText}
              </span>
              <span class="text-xs text-slate-400 font-mono font-bold">#${ord.id.slice(-4)}</span>
            </div>

            <div class="space-y-1.5 text-xs">
              <div class="flex items-start gap-2">
                <span class="text-emerald-600 font-bold shrink-0">🟢 上車</span>
                <p class="font-bold text-slate-900 leading-snug">${ord.pickup_address}</p>
              </div>
              <div class="flex items-start gap-2">
                <span class="text-rose-500 font-bold shrink-0">🔴 下車</span>
                <p class="font-medium text-slate-600 leading-snug">${ord.dropoff_address || '乘客上車後說明'}</p>
              </div>
            </div>

            <div class="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
              <span class="text-slate-500">乘客 ${ord.passenger_count || 1} 人</span>
              <span class="font-black text-amber-600">${fareText}</span>
            </div>

            <div class="pt-1 flex items-center gap-2">
              <a href="${mapUrl}" target="_blank" class="flex-1 py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold text-center transition flex items-center justify-center gap-1">
                <span>🗺️</span> 路線預覽
              </a>
              <span class="text-[11px] text-amber-700 font-medium px-2 py-1 bg-amber-50 rounded-lg">
                ⏰ 出發前 1 小時提醒出車
              </span>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      console.warn('[Driver App] 查詢預約任務失敗:', e);
    }
  }

  // 判斷下車地址是否未填或為預設占位字
  function isDropoffMissing(addr) {
    if (!addr) return true;
    const clean = addr.trim();
    return clean === '' || clean === '未提供下車地址' || clean === '乘客上車後說明' || clean === '未填' || clean === '---' || clean === '載入中...';
  }

  // 彈出輸入框請司機補填乘客下車地點
  function openDropoffInputModal(onConfirmCallback) {
    const modal = document.getElementById('dropoff-input-modal');
    const input = document.getElementById('input-manual-dropoff');
    const err = document.getElementById('dropoff-modal-error');
    if (!modal) return;
    if (err) err.classList.add('hidden');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 150);
    }
    modal.classList.remove('hidden');

    const confirmBtn = document.getElementById('btn-confirm-dropoff-modal');
    const cancelBtn = document.getElementById('btn-cancel-dropoff-modal');

    const handleConfirm = async () => {
      const val = input ? input.value.trim() : '';
      if (!val) {
        if (err) {
          err.textContent = '請輸入下車地點！';
          err.classList.remove('hidden');
        }
        return;
      }
      confirmBtn.disabled = true;
      const originalHtml = confirmBtn.innerHTML;
      confirmBtn.innerHTML = '<span>儲存並解析中...</span>';
      try {
        if (activeTrip) {
          activeTrip.dropoff_address = val;
          const res = await fetch(`/api/driver/order/${encodeURIComponent(activeTrip.id)}/destination`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dropoffAddress: val }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.lat && data.lng) {
              activeTrip.dropoff_lat = data.lat;
              activeTrip.dropoff_lng = data.lng;
            }
          }
        }
        modal.classList.add('hidden');
        if (typeof onConfirmCallback === 'function') {
          onConfirmCallback(val);
        }
      } catch (e) {
        console.warn('[Driver App] 更新下車地點失敗:', e);
        modal.classList.add('hidden');
        if (typeof onConfirmCallback === 'function') {
          onConfirmCallback(val);
        }
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = originalHtml;
      }
    };

    const handleCancel = () => {
      modal.classList.add('hidden');
    };

    if (confirmBtn) confirmBtn.onclick = handleConfirm;
    if (cancelBtn) cancelBtn.onclick = handleCancel;
  }

  // 全螢幕導航點擊處理：接單時導航至上車地點；客上後導航至下車點（若未填則彈窗輸入）
  function handleFullScreenNav() {
    if (!activeTrip) {
      switchView('dashboard');
      return;
    }

    const isPickedUp = (tripStage === 'picked_up');
    if (!isPickedUp) {
      // 1. 一開始接單時（或已到點等待乘客時）：點擊進入地圖，導航至上車地點
      switchView('tracking');
      renderActiveTripUi(activeTrip);
    } else {
      // 2. 如果回報乘客上車，點開後帶入下車地址，如果客人沒有填，跳出輸入框請司機輸入
      if (isDropoffMissing(activeTrip.dropoff_address)) {
        openDropoffInputModal((newDropoff) => {
          activeTrip.dropoff_address = newDropoff;
          renderActiveTripCard(activeTrip);
          renderActiveTripUi(activeTrip);
          switchView('tracking');
        });
      } else {
        // 客人有填，直接帶入下車地址並切換至地圖導航
        switchView('tracking');
        renderActiveTripUi(activeTrip);
      }
    }
  }

  function renderActiveTripCard(order) {
    const card = document.getElementById('active-trip-card');
    if (!card || !order) return;

    card.classList.remove('hidden');

    const stageBadge = document.getElementById('active-card-stage-badge');
    const orderIdEl = document.getElementById('active-card-order-id');
    const pickupEl = document.getElementById('active-card-pickup');
    const dropoffEl = document.getElementById('active-card-dropoff');
    const passengerEl = document.getElementById('active-card-passenger');
    const fareEl = document.getElementById('active-card-fare');
    const actionBtn = document.getElementById('btn-active-card-action');
    const actionIcon = document.getElementById('active-card-action-icon');
    const actionText = document.getElementById('active-card-action-text');
    const navBtn = document.getElementById('btn-active-card-nav');
    const noShowCardBtn = document.getElementById('btn-active-card-no-show');

    if (orderIdEl) orderIdEl.textContent = `#${order.id ? order.id.slice(-4) : '----'}`;
    if (pickupEl) pickupEl.textContent = order.pickup_address || '未提供上車地址';

    if (dropoffEl) {
      const isMissing = isDropoffMissing(order.dropoff_address);
      if (isMissing) {
        dropoffEl.innerHTML = `<span class="text-amber-300 font-bold hover:underline cursor-pointer flex items-center gap-1" title="點擊輸入下車地點"><span>未提供下車地址（點此輸入）</span><span class="text-xs">✏️</span></span>`;
        dropoffEl.onclick = () => {
          openDropoffInputModal((newDropoff) => {
            order.dropoff_address = newDropoff;
            renderActiveTripCard(order);
            renderActiveTripUi(order);
          });
        };
      } else {
        dropoffEl.textContent = order.dropoff_address;
        dropoffEl.onclick = null;
      }
    }

    const passCount = order.passenger_count || order.passengers || 1;
    if (passengerEl) passengerEl.textContent = `乘客 ${passCount} 人`;
    if (fareEl) {
      if (order.fare && Number(order.fare) > 0) {
        fareEl.textContent = `$${order.fare} 元`;
        fareEl.classList.remove('hidden');
      } else {
        fareEl.textContent = '';
        fareEl.classList.add('hidden');
      }
    }

    const stage = order.status || tripStage || 'accepted';
    if (stage === 'accepted') {
      if (stageBadge) stageBadge.textContent = '🔔 任務已接單・前往上車點';
      if (actionIcon) actionIcon.textContent = '📍';
      if (actionText) actionText.textContent = '我已抵達上車點';
      if (actionBtn) actionBtn.className = 'w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-md transition flex items-center justify-center gap-1.5 active:scale-95';
      if (noShowCardBtn) noShowCardBtn.classList.add('hidden');
    } else if (stage === 'arrived') {
      if (stageBadge) stageBadge.textContent = '🚕 司機已到點・等待乘客上車';
      if (actionIcon) actionIcon.textContent = '👥';
      if (actionText) actionText.textContent = '乘客已上車';
      if (actionBtn) actionBtn.className = 'w-full py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-md transition flex items-center justify-center gap-1.5 active:scale-95';
      if (noShowCardBtn) {
        noShowCardBtn.classList.remove('hidden');
        noShowCardBtn.onclick = () => performNoShowAction();
      }
    } else if (stage === 'picked_up') {
      if (stageBadge) stageBadge.textContent = '🏁 行程進行中・前往目的地';
      if (actionIcon) actionIcon.textContent = '✅';
      if (actionText) actionText.textContent = '到達目的地（完成結單）';
      if (actionBtn) actionBtn.className = 'w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black shadow-md transition flex items-center justify-center gap-1.5 active:scale-95';
      if (noShowCardBtn) noShowCardBtn.classList.add('hidden');
    }

    if (navBtn) {
      navBtn.onclick = handleFullScreenNav;
    }
  }

  function renderActiveTripUi(order) {
    if (!order) return;
    const pickupEl = document.getElementById('trip-pickup-addr');
    const dropoffEl = document.getElementById('trip-dropoff-addr');
    const extNavBtn = document.getElementById('btn-trip-ext-nav');
    const extNavText = document.getElementById('btn-trip-ext-nav-text');
    const passengerName = document.getElementById('trip-passenger-name');
    const headerTitle = document.getElementById('tracking-header-title');

    const step1Title = document.getElementById('trip-step1-title');
    const step1Eta = document.getElementById('trip-eta-text');
    const step2Title = document.getElementById('trip-step2-title');
    const step2Subtext = document.getElementById('trip-step2-subtext');

    if (pickupEl) pickupEl.textContent = order.pickup_address || '---';

    const isPickedUp = (tripStage === 'picked_up');
    const isMissing = isDropoffMissing(order.dropoff_address);

    if (dropoffEl) {
      if (isMissing) {
        dropoffEl.innerHTML = `<span class="text-amber-600 font-bold hover:underline cursor-pointer flex items-center gap-1"><span>未填寫目的地（點此補填）</span><span>✏️</span></span>`;
        dropoffEl.onclick = () => {
          openDropoffInputModal((newDropoff) => {
            order.dropoff_address = newDropoff;
            renderActiveTripCard(order);
            renderActiveTripUi(order);
          });
        };
      } else {
        dropoffEl.textContent = order.dropoff_address;
        dropoffEl.onclick = null;
      }
    }

    if (passengerName) passengerName.textContent = `乘客 (訂單 #${order.id.slice(-4)})`;

    const targetAddr = isPickedUp ? order.dropoff_address : order.pickup_address;

    if (headerTitle) {
      headerTitle.textContent = isPickedUp ? '載客中・前往下車地點' : '行程進行中 (Tracking Trip)';
    }

    if (step1Title) {
      step1Title.textContent = isPickedUp ? '✅ 上車地點 (乘客已上車)' : '前往上車地點';
    }
    if (step1Eta) {
      step1Eta.textContent = isPickedUp ? '已接客出發' : '預計 5 分鐘抵達';
      if (isPickedUp) {
        step1Eta.className = 'text-xs text-slate-400 font-semibold mt-0.5';
      } else {
        step1Eta.className = 'text-xs text-emerald-600 font-semibold mt-0.5';
      }
    }

    if (step2Title) {
      step2Title.textContent = isPickedUp ? '🏁 前往下車地點（導航進行中）' : '前往下車地點';
      step2Title.className = isPickedUp ? 'text-xs font-black text-amber-600' : 'text-xs font-bold text-slate-500';
    }
    if (step2Subtext) {
      if (isPickedUp) {
        step2Subtext.classList.remove('hidden');
        step2Subtext.textContent = '🚗 正在導航前往目的地';
      } else {
        step2Subtext.classList.add('hidden');
      }
    }

    // 支援在導航面板點擊下車區塊補填
    const dropoffBox = document.getElementById('trip-step2-box');
    if (dropoffBox) {
      if (isPickedUp && isMissing) {
        dropoffBox.classList.add('cursor-pointer', 'bg-amber-50/80', 'p-2', 'rounded-xl', 'border', 'border-amber-200');
        dropoffBox.onclick = () => {
          openDropoffInputModal((newDropoff) => {
            order.dropoff_address = newDropoff;
            renderActiveTripCard(order);
            renderActiveTripUi(order);
          });
        };
      } else {
        dropoffBox.classList.remove('cursor-pointer', 'bg-amber-50/80', 'p-2', 'rounded-xl', 'border', 'border-amber-200');
      }
    }

    if (extNavBtn) {
      if (isPickedUp && isMissing) {
        extNavBtn.onclick = (e) => {
          e.preventDefault();
          openDropoffInputModal((newDropoff) => {
            order.dropoff_address = newDropoff;
            renderActiveTripCard(order);
            renderActiveTripUi(order);
            window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(newDropoff)}&travelmode=driving&openExternalBrowser=1`, '_blank');
          });
        };
        if (extNavText) {
          extNavText.textContent = '⚠️ 乘客未填目的地，點此輸入並啟動 Google Maps 導航';
        }
      } else {
        extNavBtn.onclick = null;
        extNavBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(targetAddr || '台北車站')}&travelmode=driving&openExternalBrowser=1`;
        if (extNavText) {
          extNavText.textContent = isPickedUp
            ? `開啟 Google Maps 語音導航（前往下車地點：${order.dropoff_address || '目的地'}）`
            : `開啟 Google Maps 語音導航（前往上車地點：${order.pickup_address || '上車地點'}）`;
        }
      }
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

    const startLabel = document.getElementById('trip-stage-start-label');
    const midLabel = document.getElementById('trip-stage-mid-label');
    const endLabel = document.getElementById('trip-stage-end-label');
    const noShowTripBtn = document.getElementById('btn-trip-no-show');

    if (tripStage === 'accepted') {
      if (fillEl) fillEl.style.width = '25%';
      if (knobEl) knobEl.style.left = '25%';
      if (actionIcon) actionIcon.textContent = '🔔';
      if (actionText) actionText.textContent = '我已抵達上車地點（到點通知）';
      if (startLabel) startLabel.className = 'text-emerald-600 font-extrabold';
      if (midLabel) midLabel.className = 'text-slate-400 font-bold';
      if (endLabel) endLabel.className = 'text-slate-400 font-bold';
      mainActionBtn.className = 'w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm shadow-lg shadow-emerald-600/30 active:scale-98 transition flex items-center justify-center gap-2';
      if (noShowTripBtn) noShowTripBtn.classList.add('hidden');
    } else if (tripStage === 'arrived') {
      if (fillEl) fillEl.style.width = '60%';
      if (knobEl) knobEl.style.left = '60%';
      if (actionIcon) actionIcon.textContent = '🚕';
      if (actionText) actionText.textContent = '乘客已上車（出發前往目的地）';
      if (startLabel) startLabel.className = 'text-slate-400 font-bold';
      if (midLabel) midLabel.className = 'text-amber-600 font-extrabold';
      if (endLabel) endLabel.className = 'text-slate-400 font-bold';
      mainActionBtn.className = 'w-full py-3.5 px-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm shadow-lg shadow-amber-500/30 active:scale-98 transition flex items-center justify-center gap-2';
      if (noShowTripBtn) {
        noShowTripBtn.classList.remove('hidden');
        noShowTripBtn.onclick = () => performNoShowAction();
      }
    } else if (tripStage === 'picked_up') {
      if (fillEl) fillEl.style.width = '90%';
      if (knobEl) knobEl.style.left = '90%';
      if (actionIcon) actionIcon.textContent = '🏁';
      if (actionText) actionText.textContent = '到達目的地（完成結單）';
      if (startLabel) startLabel.className = 'text-slate-400 font-bold';
      if (midLabel) midLabel.className = 'text-slate-400 font-bold';
      if (endLabel) endLabel.className = 'text-slate-900 font-extrabold';
      mainActionBtn.className = 'w-full py-3.5 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-sm shadow-lg shadow-slate-900/30 active:scale-98 transition flex items-center justify-center gap-2';
      if (noShowTripBtn) noShowTripBtn.classList.add('hidden');
    }
  }

  async function performNoShowAction() {
    if (!activeTrip) return;
    if (!confirm('確定回報「客人未出現」並取消本趟訂單嗎？\n取消後系統將自動為您補償 +1 點【補單點數】！')) {
      return;
    }
    const driverId = currentDriver.userId || currentDriver.plateNumber || localStorage.getItem('flow_taxi_driver_id') || 'driver_guest';
    try {
      const res = await fetch('/api/driver/trip-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: activeTrip.id,
          driverId,
          action: 'no_show',
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        alert(`回報失敗: ${result.error || '伺服器錯誤'}`);
        return;
      }
      alert(result.message || '已回報客人未出現，並補償 +1 點補單點數！');
      localStorage.removeItem(`active_trip_stage_${activeTrip.id}`);
      activeTrip = null;
      const activeCard = document.getElementById('active-trip-card');
      if (activeCard) activeCard.classList.add('hidden');
      switchView('dashboard');
      fetchNearbyOrders();
      loadHistoryOrders();
    } catch (e) {
      alert(`網路異常: ${e.message}`);
    }
  }

  async function performTripAction() {
    if (!activeTrip) return;
    const btn = document.getElementById('btn-trip-main-action');
    const cardBtn = document.getElementById('btn-active-card-action');
    if (btn) btn.disabled = true;
    if (cardBtn) cardBtn.disabled = true;

    try {
      let action = 'arrived';
      if (tripStage === 'accepted') {
        action = 'arrived';
      } else if (tripStage === 'arrived') {
        action = 'picked_up';
      } else if (tripStage === 'picked_up') {
        action = 'completed';
        // 若訂單無詳細下車地址 / 無預估金額，回報下車時填寫金額為必填，導向金額填寫頁
        if (!activeTrip.fare || Number(activeTrip.fare) <= 0) {
          window.location.href = `/driver/adjust-fare?orderId=${encodeURIComponent(activeTrip.id)}`;
          return;
        }
      }

      const driverId = currentDriver.userId || currentDriver.plateNumber || localStorage.getItem('flow_taxi_driver_id') || 'driver_guest';

      const res = await fetch('/api/driver/trip-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: activeTrip.id,
          driverId,
          action,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        alert(`動作失敗: ${result.error || '伺服器錯誤'}`);
        return;
      }

      alert(result.message || '操作成功！');
      triggerHaptic('success');

      if (action === 'arrived') {
        tripStage = 'arrived';
        if (activeTrip) activeTrip.status = 'arrived';
        localStorage.setItem(`active_trip_stage_${activeTrip.id}`, 'arrived');
      } else if (action === 'picked_up') {
        tripStage = 'picked_up';
        if (activeTrip) activeTrip.status = 'picked_up';
        localStorage.removeItem(`active_trip_stage_${activeTrip.id}`);
        // 回報乘客上車後，若乘客未填寫下車目的地，主動彈窗請司機補填
        if (activeTrip && isDropoffMissing(activeTrip.dropoff_address)) {
          openDropoffInputModal((newDropoff) => {
            activeTrip.dropoff_address = newDropoff;
            renderActiveTripCard(activeTrip);
            renderActiveTripUi(activeTrip);
          });
        }
      } else if (action === 'completed') {
        tripStage = 'completed';
        localStorage.removeItem(`active_trip_stage_${activeTrip.id}`);
        activeTrip = null;
        const activeCard = document.getElementById('active-trip-card');
        if (activeCard) activeCard.classList.add('hidden');
        switchView('dashboard');
        fetchNearbyOrders();
        loadHistoryOrders();
      }

      if (activeTrip) {
        renderActiveTripUi(activeTrip);
        renderActiveTripCard(activeTrip);
      }
    } catch (e) {
      alert(`網路異常: ${e.message}`);
    } finally {
      if (btn) btn.disabled = false;
      if (cardBtn) cardBtn.disabled = false;
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
    const driverIdentifier = currentDriver.userId || currentDriver.plateNumber || localStorage.getItem('flow_taxi_driver_id');
    if (!driverIdentifier || driverIdentifier === 'driver_guest') {
      listEl.innerHTML = '<p class="text-slate-400 text-center py-6">請先登入以查看歷史訂單</p>';
      return;
    }
    listEl.innerHTML = '<p class="text-slate-400 text-center py-6">載入歷史訂單中...</p>';

    try {
      const res = await fetch(`/api/driver/${encodeURIComponent(driverIdentifier)}/history-orders`);
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
  // 10.5 常客管理 (固定上下車地點、固定金額、固定路線)
  // -------------------------------------------------------------
  let regularCustomersCache = [];

  async function loadRegularCustomers() {
    const listEl = document.getElementById('regular-customers-list');
    const countBadge = document.getElementById('reg-cust-count-badge');
    if (!listEl) return;

    listEl.innerHTML = '<p class="text-slate-400 text-center py-6">載入常客清單中...</p>';
    try {
      const res = await fetch('/api/admin/regular-customers');
      if (!res.ok) throw new Error('讀取失敗');
      const data = await res.json();
      regularCustomersCache = data.customers || [];

      if (countBadge) countBadge.textContent = `${regularCustomersCache.length} 筆`;

      if (regularCustomersCache.length === 0) {
        listEl.innerHTML = '<p class="text-slate-400 text-center py-6">尚未新增常客設定，請於上方表單新增</p>';
        return;
      }

      listEl.innerHTML = regularCustomersCache
        .map((c) => {
          const routeLabel = c.fixed_route ? `🛣️ 指定路線：${escapeHtml(c.fixed_route)}` : '🛣️ 指定路線：依導航最佳路線';
          const lineIdLabel = c.customer_id ? `<span class="font-mono text-[10px] text-slate-400">(${escapeHtml(c.customer_id)})</span>` : '';
          return `
            <div class="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-1.5">
              <div class="flex items-center justify-between">
                <div class="font-extrabold text-slate-900 flex items-center gap-1">
                  <span>👤 ${escapeHtml(c.customer_name)}</span>
                  ${lineIdLabel}
                </div>
                <span class="px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800 font-black text-xs">$${c.fixed_fare}</span>
              </div>
              <p class="text-xs font-bold text-slate-800">🟢 上車：${escapeHtml(c.pickup_address)}</p>
              <p class="text-xs font-bold text-slate-800">🔴 下車：${escapeHtml(c.dropoff_address)}</p>
              <p class="text-[11px] font-bold text-indigo-700">${routeLabel}</p>
              <div class="flex justify-end gap-2 pt-1.5 border-t border-slate-100">
                <button type="button" data-edit-reg="${escapeHtml(c.id)}" class="btn-edit-reg-item px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px]">✏️ 編輯</button>
                <button type="button" data-del-reg="${escapeHtml(c.id)}" class="btn-del-reg-item px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-[11px]">🗑️ 刪除</button>
              </div>
            </div>
          `;
        })
        .join('');

      listEl.querySelectorAll('.btn-edit-reg-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-edit-reg');
          const found = regularCustomersCache.find((x) => x.id === id);
          if (!found) return;
          document.getElementById('reg-cust-edit-id').value = found.id;
          document.getElementById('reg-cust-name').value = found.customer_name || '';
          document.getElementById('reg-cust-line-id').value = found.customer_id || '';
          document.getElementById('reg-cust-pickup').value = found.pickup_address || '';
          document.getElementById('reg-cust-dropoff').value = found.dropoff_address || '';
          document.getElementById('reg-cust-fare').value = found.fixed_fare || '';
          document.getElementById('reg-cust-route').value = found.fixed_route || '';
          const saveBtn = document.getElementById('btn-save-reg-cust');
          if (saveBtn) saveBtn.textContent = '💾 儲存常客修改';
          document.getElementById('btn-cancel-edit-reg-cust')?.classList.remove('hidden');
        });
      });

      listEl.querySelectorAll('.btn-del-reg-item').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-del-reg');
          if (!id || !confirm('確定要刪除此筆常客設定嗎？')) return;
          await fetch(`/api/admin/regular-customers/${encodeURIComponent(id)}`, { method: 'DELETE' });
          loadRegularCustomers();
        });
      });
    } catch (err) {
      listEl.innerHTML = '<p class="text-rose-500 text-center py-6">無法載入常客清單</p>';
    }
  }

  function resetRegularCustomerForm() {
    const editId = document.getElementById('reg-cust-edit-id');
    if (editId) editId.value = '';
    const form = document.getElementById('regular-customer-form');
    if (form) form.reset();
    const saveBtn = document.getElementById('btn-save-reg-cust');
    if (saveBtn) saveBtn.textContent = '➕ 新增常客設定';
    document.getElementById('btn-cancel-edit-reg-cust')?.classList.add('hidden');
  }

  // -------------------------------------------------------------
  // 11. 監聽與綁定事件
  // -------------------------------------------------------------
  function setupDomListeners() {
    // 司機在線上 / 已下線切換按鈕
    function toggleDriverOnlineStatus() {
      isDriverOnline = !isDriverOnline;
      localStorage.setItem('flow_taxi_driver_online', isDriverOnline ? 'true' : 'false');
      triggerHaptic(isDriverOnline ? 'success' : 'medium');
      updateDriverUi();
      if (isDriverOnline) {
        fetchNearbyOrders();
      } else {
        renderOrdersList([]);
      }
    }

    document.getElementById('btn-toggle-online-status')?.addEventListener('click', toggleDriverOnlineStatus);
    document.getElementById('btn-orders-go-online')?.addEventListener('click', toggleDriverOnlineStatus);

    // 可接單類別篩選 (全部 / ⚡ 即時 / 📅 預約)
    const filterTabs = document.querySelectorAll('.order-filter-tab');
    filterTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        triggerHaptic('light');
        const filter = tab.getAttribute('data-filter') || 'all';
        currentOrderFilter = filter;
        filterTabs.forEach((t) => {
          if (t === tab) {
            t.className = 'order-filter-tab px-2.5 py-1 rounded-lg transition active bg-white text-slate-900 shadow-sm font-bold';
          } else {
            t.className = 'order-filter-tab px-2.5 py-1 rounded-lg transition text-slate-600 hover:text-slate-900 font-bold';
          }
        });
        renderOrdersList(nearbyOrders);
      });
    });

    // 底部導覽列
    document.getElementById('nav-btn-dashboard')?.addEventListener('click', () => {
      triggerHaptic('light');
      switchView('dashboard');
    });
    document.getElementById('nav-btn-map')?.addEventListener('click', () => {
      triggerHaptic('light');
      switchView('map');
    });
    document.getElementById('nav-btn-menu')?.addEventListener('click', () => {
      triggerHaptic('light');
      openSideDrawer();
    });
    document.getElementById('btn-open-drawer')?.addEventListener('click', () => {
      triggerHaptic('light');
      openSideDrawer();
    });
    document.getElementById('btn-close-drawer')?.addEventListener('click', () => {
      triggerHaptic('light');
      closeSideDrawer();
    });
    document.getElementById('drawer-backdrop')?.addEventListener('click', closeSideDrawer);

    // 切換地圖捷徑與導航按鈕
    document.getElementById('btn-toggle-map-shortcut')?.addEventListener('click', () => {
      triggerHaptic('light');
      switchView('map');
    });
    document.getElementById('btn-map-show-list')?.addEventListener('click', () => {
      triggerHaptic('light');
      switchView('dashboard');
    });
    document.getElementById('btn-tracking-back')?.addEventListener('click', () => {
      triggerHaptic('light');
      switchView('dashboard');
    });
    document.getElementById('btn-switch-to-tracking')?.addEventListener('click', () => {
      triggerHaptic('medium');
      handleFullScreenNav();
    });
    document.getElementById('btn-active-card-nav')?.addEventListener('click', () => {
      triggerHaptic('medium');
      handleFullScreenNav();
    });

    // Hero 掃描按鈕 (大圖示與頂部標題按鈕)
    document.getElementById('btn-hero-radar-refresh')?.addEventListener('click', () => {
      fetchNearbyOrders();
      alert('已重新掃描半徑 1.5km 內叫車訂單！');
    });
    document.getElementById('btn-hero-radar-refresh-mini')?.addEventListener('click', () => {
      fetchNearbyOrders();
    });

    // 地圖重置中心點按鈕
    document.getElementById('btn-recenter-map')?.addEventListener('click', () => {
      startGpsTracking();
      if (radarMap) {
        radarMap.panTo([currentGps.lat, currentGps.lng]);
      }
    });

    // 任務大按鈕與置頂任務卡片回報按鈕
    document.getElementById('btn-trip-main-action')?.addEventListener('click', performTripAction);
    document.getElementById('btn-active-card-action')?.addEventListener('click', performTripAction);

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

    // 側邊 Drawer 分頁切換 (個人與車輛資料 / 歷史接單紀錄 / 常客)
    const tabProfileBtn = document.getElementById('tab-btn-profile');
    const tabHistoryBtn = document.getElementById('tab-btn-history');
    const tabRegCustomersBtn = document.getElementById('tab-btn-regular-customers');
    const tabProfileContent = document.getElementById('tab-content-profile');
    const tabHistoryContent = document.getElementById('tab-content-history');
    const tabRegCustomersContent = document.getElementById('tab-content-regular-customers');

    function setActiveDrawerTab(tab) {
      const inactiveCls = 'flex-1 py-3 border-b-2 border-transparent hover:text-slate-900';
      const activeCls = 'flex-1 py-3 border-b-2 border-emerald-600 text-emerald-600 font-extrabold';
      if (tabProfileBtn) tabProfileBtn.className = tab === 'profile' ? activeCls : inactiveCls;
      if (tabHistoryBtn) tabHistoryBtn.className = tab === 'history' ? activeCls : inactiveCls;
      if (tabRegCustomersBtn) tabRegCustomersBtn.className = tab === 'regular' ? activeCls : inactiveCls;

      tabProfileContent?.classList.toggle('hidden', tab !== 'profile');
      tabHistoryContent?.classList.toggle('hidden', tab !== 'history');
      tabRegCustomersContent?.classList.toggle('hidden', tab !== 'regular');
    }

    tabProfileBtn?.addEventListener('click', () => {
      setActiveDrawerTab('profile');
    });

    tabHistoryBtn?.addEventListener('click', () => {
      setActiveDrawerTab('history');
      loadHistoryOrders();
    });

    tabRegCustomersBtn?.addEventListener('click', () => {
      setActiveDrawerTab('regular');
      loadRegularCustomers();
    });

    document.getElementById('btn-cancel-edit-reg-cust')?.addEventListener('click', resetRegularCustomerForm);

    document.getElementById('regular-customer-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('reg-cust-edit-id')?.value?.trim();
      const customer_name = document.getElementById('reg-cust-name')?.value?.trim();
      const customer_id = document.getElementById('reg-cust-line-id')?.value?.trim();
      const pickup_address = document.getElementById('reg-cust-pickup')?.value?.trim();
      const dropoff_address = document.getElementById('reg-cust-dropoff')?.value?.trim();
      const fixed_fare = Number(document.getElementById('reg-cust-fare')?.value);
      const fixed_route = document.getElementById('reg-cust-route')?.value?.trim();
      const statusEl = document.getElementById('reg-cust-save-status');

      try {
        const res = await fetch('/api/admin/regular-customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editId || undefined,
            customer_name,
            customer_id: customer_id || null,
            pickup_address,
            dropoff_address,
            fixed_fare,
            fixed_route,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || '儲存常客設定失敗');
          return;
        }
        resetRegularCustomerForm();
        await loadRegularCustomers();
        if (statusEl) {
          statusEl.textContent = '✅ 常客固定路線與固定金額已儲存！';
          statusEl.classList.remove('hidden');
          setTimeout(() => statusEl.classList.add('hidden'), 3000);
        }
      } catch (err) {
        alert('儲存常客設定時發生網路錯誤');
      }
    });

    // 編輯車卡快捷入口 (首頁卡片直通抽屜注意事項區)
    document.getElementById('btn-edit-notes-card')?.addEventListener('click', () => {
      openSideDrawer();
      tabProfileBtn?.click();
      setTimeout(() => {
        const notesInput = document.getElementById('input-driver-notes');
        notesInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        notesInput?.focus();
      }, 350);
    });

    // 表單各輸入格與即時車卡預覽連動
    document.getElementById('input-display-name')?.addEventListener('input', (e) => {
      const prev = document.getElementById('preview-card-name');
      if (prev) prev.textContent = e.target.value.trim() || '未登入';
    });
    document.getElementById('input-plate-number')?.addEventListener('input', (e) => {
      const prev = document.getElementById('preview-card-plate');
      if (prev) prev.textContent = e.target.value.trim().toUpperCase() || 'TDC-8888';
    });
    document.getElementById('input-car-brand')?.addEventListener('input', (e) => {
      const prev = document.getElementById('preview-card-brand');
      if (prev) prev.textContent = e.target.value.trim() || 'TOYOTA';
    });
    document.getElementById('input-car-color')?.addEventListener('input', (e) => {
      const prev = document.getElementById('preview-card-color');
      if (prev) prev.textContent = e.target.value.trim() || '黑色';
    });
    document.getElementById('input-driver-notes')?.addEventListener('input', () => {
      updateNotesCountAndPreview();
    });

    // 快捷標籤點選追加
    document.querySelectorAll('.quick-note-tag').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tag = btn.getAttribute('data-tag');
        if (tag) appendQuickNote(tag);
      });
    });

    // 清空注意事項
    document.getElementById('btn-clear-notes')?.addEventListener('click', () => {
      const notesInput = document.getElementById('input-driver-notes');
      if (notesInput) {
        notesInput.value = '';
        updateNotesCountAndPreview();
        notesInput.focus();
      }
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
            statusEl.textContent = '✅ 車卡資料與乘車注意事項已成功更新！';
            statusEl.classList.remove('hidden');
            setTimeout(() => statusEl.classList.add('hidden'), 3000);
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
      alert(`已成功送出接單出價！\n系統正進行 30 秒媒合評選，請留意即時推播結果！`);
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
