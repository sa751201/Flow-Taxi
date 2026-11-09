// Driver Bid LIFF Logic
let currentUserId = null;
let currentDriverProfile = null;
let orderId = null;
let orderData = null;
let baseEtaMinutes = 5;
let baseDistanceKm = 1.5;
let extraMinutes = 0;
let driverLat = 25.0478;
let driverLng = 121.5170;
let hasRealGps = false;
let isReservationOrder = false;
let reservationTimeStr = '';
let driverCompensationPoints = 0;
let isCurrentDriverWinner = false;
let currentOaUrl = 'https://line.me/R/ti/p/@688muuaw';

function showNotWinnerPopup(winnerDriverName) {
  const winnerLabel = winnerDriverName ? `【${winnerDriverName}】` : '其他駕駛';
  const locatingEl = document.getElementById('locating-state');
  const bidCardEl = document.getElementById('bid-card');
  const modalEl = document.getElementById('not-winner-modal');
  const modalDescEl = document.getElementById('not-winner-modal-desc');

  if (locatingEl) locatingEl.classList.add('hidden');
  if (bidCardEl) bidCardEl.classList.add('hidden');

  if (modalDescEl) {
    modalDescEl.innerHTML = `此筆訂單已由 ${winnerLabel} 成功接單。<br>您未接到此筆訂單，為避免造成誤會，系統不會引導您前往 1:1 官方帳號。`;
  }
  if (modalEl) {
    modalEl.classList.remove('hidden');
  }

  setTimeout(() => {
    alert(`⚠️ 您未接到此筆訂單！\n\n此筆訂單已由 ${winnerLabel} 成功接單，非接單駕駛無須前往 1:1 官方帳號。`);
  }, 50);
}

// 將預估抵達時間無條件進位為 5 分鐘的倍數 (例如: 13 ➔ 15, 6 ➔ 10, 1~5 ➔ 5)
function roundUpToFiveMinutes(mins) {
  const n = Number(mins);
  if (!n || isNaN(n) || n <= 0) return 5;
  return Math.max(5, Math.ceil(n / 5) * 5);
}

// 判斷乘客是否提供了詳細下車地址
function isDetailedDropoffAddress(dropoffAddress) {
  if (!dropoffAddress || typeof dropoffAddress !== 'string') return false;
  const trimmed = dropoffAddress.trim();
  if (!trimmed) return false;
  if (/^(無|未填|未定|待定|未知|不確定|免填|上車後說明|乘客上車後說明|乘客指定地點|上車告知|上車再說|車上說|車上告知|司機決定|隨便)$/i.test(trimmed)) {
    return false;
  }
  const stripped = trimmed
    .replace(/([台臺]北市|新北市|桃園市|基隆市|新竹市|新竹縣|[台臺]中市|[台臺]南市|高雄市|[台臺]北|新北|桃園|基隆|新竹|[台臺]中|[台臺]南|高雄)/g, '')
    .replace(/(信義|大安|中山|松山|內湖|士林|北投|萬華|中正|大同|文山|南港|板橋|中和|永和|新莊|三重|新店|土城|蘆洲|汐止|淡水|林口|八里|五股|泰山|樹林|鶯歌|三峽|瑞芳|龜山|蘆竹|大園|中壢|平鎮|八德|楊梅|龍潭)[區鄉鎮市]?/g, '')
    .replace(/(市區|附近|周邊|週邊|一帶)/g, '')
    .trim();
  return Boolean(stripped);
}

function updateCompensationPointsUi(points) {
  driverCompensationPoints = Math.max(0, Number(points || 0));
  const sectionEl = document.getElementById('compensation-points-section');
  const badgeEl = document.getElementById('compensation-points-badge');
  const labelEl = document.getElementById('compensation-checkbox-label');
  const checkboxEl = document.getElementById('use-compensation-checkbox');
  const titleEl = document.getElementById('compensation-checkbox-title');
  const descEl = document.getElementById('compensation-points-desc');

  if (!checkboxEl) return;

  if (driverCompensationPoints > 0) {
    checkboxEl.disabled = false;
    if (sectionEl) {
      sectionEl.className = 'p-3.5 rounded-xl bg-amber-50/90 border border-amber-300 transition-all space-y-2 shadow-xs';
    }
    if (badgeEl) {
      badgeEl.textContent = `目前可用：${driverCompensationPoints} 點`;
      badgeEl.className = 'px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-[11px] font-extrabold shadow-xs';
    }
    if (labelEl) {
      labelEl.className = 'flex items-start gap-2.5 p-2.5 rounded-lg bg-white border border-amber-300 hover:border-amber-500 cursor-pointer transition select-none shadow-2xs';
    }
    if (titleEl) {
      titleEl.className = 'font-extrabold text-amber-950 block';
    }
    if (descEl) {
      descEl.textContent = '✨ 勾選後按接單當下即刻結單指派，不用再等 30 秒規則！';
      descEl.className = 'text-[11px] text-amber-700 font-medium block mt-0.5';
    }
  } else {
    checkboxEl.checked = false;
    checkboxEl.disabled = true;
    if (sectionEl) {
      sectionEl.className = 'p-3.5 rounded-xl bg-slate-50 border border-slate-200 transition-all space-y-2';
    }
    if (badgeEl) {
      badgeEl.textContent = '目前可用：0 點';
      badgeEl.className = 'px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[11px] font-bold';
    }
    if (labelEl) {
      labelEl.className = 'flex items-start gap-2.5 p-2.5 rounded-lg bg-white border border-slate-200/80 opacity-60 cursor-not-allowed transition select-none';
    }
    if (titleEl) {
      titleEl.className = 'font-bold text-slate-700 block';
    }
    if (descEl) {
      descEl.textContent = '目前無可用點數（接單後若遇客人取消或未出現，系統將自動計點補發）';
      descEl.className = 'text-[11px] text-slate-400 block mt-0.5';
    }
  }
}

function updateEtaDisplay() {
  if (isReservationOrder) return;
  const totalEta = baseEtaMinutes + extraMinutes;
  const etaMinsEl = document.getElementById('eta-mins');
  if (etaMinsEl) {
    etaMinsEl.textContent = totalEta;
  }

  const distanceBadgeEl = document.getElementById('eta-distance-badge');
  if (distanceBadgeEl) {
    distanceBadgeEl.textContent = `約 ${baseDistanceKm.toFixed(1)} km`;
  }

  const sourceNoteEl = document.getElementById('eta-source-note');
  if (sourceNoteEl) {
    if (hasRealGps) {
      sourceNoteEl.innerHTML = '🟢 由司機手機即時 GPS 定位測算導航時間';
      sourceNoteEl.className = 'text-[11px] text-emerald-600 font-medium';
    } else {
      sourceNoteEl.innerHTML = '⚠️ 未取得手機即時 GPS（<button id="btn-retry-gps" type="button" class="underline font-bold text-amber-800">點此重新定位</button>）';
      sourceNoteEl.className = 'text-[11px] text-amber-700 font-medium';
      document.getElementById('btn-retry-gps')?.addEventListener('click', (e) => {
        e.preventDefault();
        requestGpsLocation(true);
      });
    }
  }

  // 需求 4: 按加後，數字下方/手動微調區出現重設按鈕 (ghost button 樣式)
  const resetBtn = document.getElementById('btn-reset-eta');
  if (resetBtn) {
    if (extraMinutes > 0) {
      resetBtn.classList.remove('hidden');
    } else {
      resetBtn.classList.add('hidden');
    }
  }
}

async function initBidLiff() {
  const urlParams = new URLSearchParams(window.location.search);
  orderId = urlParams.get('orderId');
  const mode = urlParams.get('mode');

  if (!orderId) {
    showError('未提供訂單編號，無法接單');
    return;
  }

  try {
    const configRes = await fetch('/api/config');
    const config = await configRes.json();
    const liffId = config.liffId;
    if (config.oaUrl) {
      currentOaUrl = config.oaUrl;
    }

    if (liffId && typeof liff !== 'undefined') {
      await liff.init({ liffId });
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: window.location.href });
        return;
      }
      const profile = await liff.getProfile();
      currentUserId = profile.userId;
    } else {
      currentUserId = localStorage.getItem('flow_taxi_driver_id') || ('DEV_DRIVER_' + Date.now());
    }

    // 取得訂單資訊（優先檢查該筆訂單是否已結單指派給特定駕駛）
    const orderRes = await fetch(`/api/orders/${orderId}`);
    if (!orderRes.ok) {
      throw new Error('找不到該訂單或已結束派單');
    }
    orderData = await orderRes.json();
    if (orderData.oaUrl) {
      currentOaUrl = orderData.oaUrl;
    }

    const savedDriverId = localStorage.getItem('flow_taxi_driver_id');
    const isOrderAssigned = Boolean(
      orderData.driver_id ||
      orderData.status === 'accepted' ||
      orderData.status === 'arrived' ||
      orderData.status === 'picked_up' ||
      orderData.status === 'completed'
    );
    isCurrentDriverWinner = Boolean(
      orderData.driver_id &&
      (currentUserId === orderData.driver_id || savedDriverId === orderData.driver_id)
    );

    // 若訂單已結單指派或點擊的是「開啟 1:1 OA 查看訂單與回報 (mode=check_won)」：
    // 1. 只有接單駕駛本人可開啟 1:1 OA
    // 2. 未接單的駕駛跳出 Pop-up 提示「未接到單」，絕不引導去 1:1 OA
    if (isOrderAssigned || mode === 'check_won') {
      if (isCurrentDriverWinner) {
        if (mode === 'check_won') {
          window.location.replace(currentOaUrl);
          return;
        }
      } else {
        showNotWinnerPopup(orderData.winnerDriverName);
        return;
      }
    }

    // 檢查司機註冊 gate
    const driverRes = await fetch(`/api/driver/${currentUserId}`);
    if (driverRes.ok) {
      const driver = await driverRes.json();
      if (!driver || !driver.registered) {
        alert('您尚未完成司機資料登記，請先登記車輛資料再接單！');
        window.location.href = `/driver/register?redirectOrderId=${orderId}`;
        return;
      }
      currentDriverProfile = driver;
      updateCompensationPointsUi(driver.compensation_points || 0);
    } else {
      updateCompensationPointsUi(0);
    }

    document.getElementById('pickup-addr').textContent = orderData.pickup_address;
    document.getElementById('dropoff-addr').textContent = orderData.dropoff_address || '乘客上車後說明';

    const fixedRouteWrap = document.getElementById('fixed-route-wrap');
    const fixedRouteTextEl = document.getElementById('fixed-route-text');
    const resolvedFixedRoute = orderData.fixed_route ? String(orderData.fixed_route).trim() : '';
    if (resolvedFixedRoute) {
      if (fixedRouteWrap) fixedRouteWrap.classList.remove('hidden');
      if (fixedRouteTextEl) fixedRouteTextEl.textContent = resolvedFixedRoute;
    }

    const copyBtn = document.getElementById('btn-copy-dispatch-info');
    const copyTooltip = document.getElementById('copy-dispatch-tooltip');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const dropoffText = orderData.dropoff_address && orderData.dropoff_address.trim()
          ? orderData.dropoff_address.trim()
          : '乘客上車後說明';
        const routeText = resolvedFixedRoute || '依導航最佳路線';
        const copyText = `🟢 上車地點：${orderData.pickup_address}\n🔴 下車地點：${dropoffText}\n🛣️ 指定路線：${routeText}`;

        try {
          await navigator.clipboard.writeText(copyText);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = copyText;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }

        if (copyTooltip) {
          copyTooltip.classList.remove('hidden');
          setTimeout(() => copyTooltip.classList.add('hidden'), 1800);
        }
      });
    }

    // 需求: 使用者如果沒有詳細下車地址，接單不顯示金額（若為常客固定金額則顯示固定金額）
    const fareBoxEl = document.getElementById('fare-estimate-box');
    const fareEl = document.getElementById('fare-amount');
    const fareDistEl = document.getElementById('fare-distance');
    const hasDetailedDropoff = isDetailedDropoffAddress(orderData.dropoff_address) || Boolean(resolvedFixedRoute);
    const validFare =
      hasDetailedDropoff && orderData.fare && Number(orderData.fare) > 0
        ? Math.round(Number(orderData.fare))
        : null;

    if (validFare !== null) {
      if (fareBoxEl) fareBoxEl.classList.remove('hidden');
      if (fareEl) {
        fareEl.textContent = `$${validFare}`;
      }
      if (fareDistEl) {
        if (resolvedFixedRoute) {
          fareDistEl.textContent = `常客固定金額｜指定路線：${resolvedFixedRoute}`;
        } else if (orderData.distance_km) {
          fareDistEl.textContent = `行程約 ${Number(orderData.distance_km).toFixed(1)} 公里`;
        }
      }
    } else {
      if (fareBoxEl) fareBoxEl.classList.add('hidden');
    }

    // 檢查是否為預約單 (> 1小時)
    const timeMatch = orderData.note?.match(/預約時間:\s*(.+)/);
    reservationTimeStr = timeMatch
      ? timeMatch[1].replace(/\[[^\]]*\]/g, '').trim()
      : (orderData.scheduled_time ? new Date(orderData.scheduled_time).toLocaleString('zh-TW', { hour12: false }) : '');
    if (orderData.scheduled_time) {
      const diffMs = new Date(orderData.scheduled_time).getTime() - Date.now();
      isReservationOrder = diffMs > 60 * 60 * 1000;
    } else if (reservationTimeStr && !reservationTimeStr.includes('免填')) {
      isReservationOrder = true;
    }

    if (isReservationOrder && reservationTimeStr) {
      const titleEl = document.getElementById('bid-page-title');
      if (titleEl) titleEl.textContent = '📅 預約接單';

      const descEl = document.getElementById('bid-page-desc');
      if (descEl) descEl.textContent = `預約乘車時間：${reservationTimeStr}（用車前 1 小時出車）`;

      const boxTitle = document.getElementById('eta-box-title');
      if (boxTitle) boxTitle.textContent = '📅 預約搭乘時間';

      const etaMinsEl = document.getElementById('eta-mins');
      if (etaMinsEl) {
        etaMinsEl.textContent = reservationTimeStr;
        etaMinsEl.className = 'text-xl sm:text-2xl font-black text-emerald-700';
      }

      const etaUnit = document.getElementById('eta-unit');
      if (etaUnit) etaUnit.textContent = '';

      const badgeEl = document.getElementById('eta-distance-badge');
      if (badgeEl) badgeEl.textContent = '預約行程';

      const sourceNote = document.getElementById('eta-source-note');
      if (sourceNote) sourceNote.innerHTML = '⏰ 系統將於用車前 1 小時發送前往上車地點通知，屆時再出車接送';

      const fineTuneContainer = document.getElementById('fine-tune-container');
      if (fineTuneContainer) fineTuneContainer.classList.add('hidden');

      const btnConfirm = document.getElementById('btn-confirm-bid');
      if (btnConfirm) {
        btnConfirm.innerHTML = `
          <span class="t-pro-btn-label text-white font-bold flex items-center justify-center gap-2">
            <span>📅</span> <span id="btn-confirm-bid-text">確認接單（預約行程）</span>
          </span>
        `;
      }
    }

    // 監聽補單點數 Checkbox 勾選狀態，即時反映在接單按鈕文字上
    const compCheckbox = document.getElementById('use-compensation-checkbox');
    if (compCheckbox) {
      compCheckbox.addEventListener('change', () => {
        const btnTextEl = document.getElementById('btn-confirm-bid-text');
        if (!btnTextEl) return;
        if (compCheckbox.checked) {
          btnTextEl.textContent = isReservationOrder
            ? '⚡ 使用補單點數・立即確認預約接單'
            : '⚡ 使用補單點數・立即結單接單';
        } else {
          btnTextEl.textContent = isReservationOrder
            ? '確認接單（預約行程）'
            : '確認到達時間並接單';
        }
      });
    }

    // 需求 7: 已經有人的接單，當群組內有人點立刻接單的話，
    // 該 LIFF 顯示資訊，但不會有時間估算這區以及接單的按鈕（但若司機持有補單點數且訂單尚未結單，仍可優先搶單立即結單）
    const hasBids = Boolean(orderData.hasBids || (orderData.bidsCount && orderData.bidsCount > 0));
    const isAlreadyAccepted = orderData.status === 'accepted' || orderData.status === 'no_driver' || orderData.status === 'cancelled';
    
    if (isAlreadyAccepted || (hasBids && driverCompensationPoints <= 0)) {
      const actionSec = document.getElementById('bidding-action-section');
      const alreadyNotice = document.getElementById('already-bid-notice');
      if (actionSec) actionSec.classList.add('hidden');
      if (alreadyNotice) {
        alreadyNotice.classList.remove('hidden');
        if (orderData.status === 'accepted') {
          alreadyNotice.innerHTML = isCurrentDriverWinner
            ? `
            <div class="flex items-center justify-center gap-1.5 font-bold text-sm text-emerald-800">
              <span>🎉</span> 恭喜！您已成功承接此筆訂單
            </div>
            <p class="text-xs text-slate-600 leading-relaxed mt-1 mb-3">
              詳細接單任務資訊已同步至您的 1:1 官方帳號，請點擊下方按鈕前往查看與回報。
            </p>
            <a href="${currentOaUrl}" class="inline-block w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition">
              💬 開啟 1:1 OA 查看訂單與回報
            </a>
          `
            : `
            <div class="flex items-center justify-center gap-1.5 font-bold text-sm text-slate-800">
              <span>✅</span> 此訂單已指派中單司機
            </div>
            <p class="text-xs text-slate-600 leading-relaxed mt-1">
              本趟行程派單已圓滿結單，已由其他司機前往接送。感謝您的關注！
            </p>
          `;
        }
      }
    }

    // 需求 6: 司機搶單獎勵預覽與切換邏輯
    const toggleRewardBtn = document.getElementById('btn-toggle-reward');
    const rewardCard = document.getElementById('reward-priority-card');
    if (toggleRewardBtn && rewardCard) {
      toggleRewardBtn.addEventListener('click', () => {
        rewardCard.classList.toggle('hidden');
      });
    }

    // 取得司機手機 GPS 定位 (並等待手機 GPS 回傳)
    if (hasRealGps) {
      await fetchCalculatedEta();
    } else {
      const waitGps = new Promise((resolve) => {
        const timer = setInterval(() => {
          if (hasRealGps) {
            clearInterval(timer);
            resolve(true);
          }
        }, 200);
        setTimeout(() => {
          clearInterval(timer);
          resolve(false);
        }, 3000);
      });

      await waitGps;
      await fetchCalculatedEta();
    }
  } catch (err) {
    showError(err.message);
  }
}

function requestGpsLocation(isUserAction = false) {
  if (!navigator.geolocation) {
    if (isUserAction) alert('您的手機瀏覽器不支援 GPS 定位功能');
    return;
  }

  const sourceNoteEl = document.getElementById('eta-source-note');
  if (isUserAction && sourceNoteEl) {
    sourceNoteEl.innerHTML = '<span class="text-emerald-700 font-semibold animate-pulse">🔄 正在重新讀取精確 GPS 中...</span>';
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      driverLat = pos.coords.latitude;
      driverLng = pos.coords.longitude;
      hasRealGps = true;
      console.log(`[GPS] 成功取得司機即時定位: (${driverLat}, ${driverLng})`);
      if (orderData) {
        await fetchCalculatedEta();
      }
    },
    (geoErr) => {
      console.warn('[GPS] 取得位置失敗或權限未開:', geoErr.message);
      if (isUserAction) {
        alert(`無法取得 GPS 定位 (${geoErr.message})，請檢查 LINE 或 Safari 是否開啟位置存取權限。`);
      }
      updateEtaDisplay();
    },
    { timeout: 8000, enableHighAccuracy: true, maximumAge: 0 }
  );
}

// 頁面載入時第一時間立即啟動 GPS 請求
requestGpsLocation(false);

async function fetchCalculatedEta() {
  try {
    const etaRes = await fetch('/api/dispatch/calculate-eta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId,
        driverLat,
        driverLng,
      }),
    });

    if (etaRes.ok) {
      const etaData = await etaRes.json();
      baseEtaMinutes = roundUpToFiveMinutes(etaData.durationMinutes || 5);
      baseDistanceKm = (etaData.distanceMeters || 1500) / 1000;
    }
  } catch (e) {
    console.warn('計算車程異常，使用預估值:', e);
    baseEtaMinutes = roundUpToFiveMinutes(baseEtaMinutes);
  } finally {
    document.getElementById('locating-state').classList.add('hidden');
    document.getElementById('bid-content').classList.remove('hidden');
    updateEtaDisplay();
  }
}

// 需求 4: 重設按鈕監聽 (恢復為測算的 baseEtaMinutes)
document.getElementById('btn-reset-eta')?.addEventListener('click', () => {
  extraMinutes = 0;
  updateEtaDisplay();
});

document.getElementById('btn-plus-1')?.addEventListener('click', () => {
  extraMinutes += 1;
  updateEtaDisplay();
});

document.getElementById('btn-plus-5')?.addEventListener('click', () => {
  extraMinutes += 5;
  updateEtaDisplay();
});

document.getElementById('btn-confirm-bid')?.addEventListener('click', async () => {
  const confirmBtn = document.getElementById('btn-confirm-bid');
  const totalMins = baseEtaMinutes + extraMinutes;
  const useCompensationPoint = Boolean(document.getElementById('use-compensation-checkbox')?.checked);

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.classList.add('opacity-60', 'cursor-not-allowed');
  }

  const statusBox = document.getElementById('status-box');
  statusBox.className = 'mt-4 p-3.5 rounded-xl text-xs font-medium text-center bg-amber-50 text-amber-800 border border-amber-200';
  statusBox.textContent = useCompensationPoint ? '⚡ 正在使用補單點數立即結單指派中...' : '接單意願送出中...';
  statusBox.classList.remove('hidden');

  try {
    const res = await fetch('/api/dispatch/bid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId,
        driverId: currentUserId,
        driverLat,
        driverLng,
        etaMinutes: totalMins,
        useCompensationPoint,
      }),
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || `接單失敗 (HTTP ${res.status})`);
    }

    const driverName = result.driverName || currentDriverProfile?.display_name || '司機夥伴';
    const isInstantWon = Boolean(result.instantWon);
    if (isInstantWon) {
      isCurrentDriverWinner = true;
    }

    // 將司機身分資訊同步寫入 LocalStorage，確保後續開接單程式時能無縫連動
    try {
      if (currentUserId) {
        localStorage.setItem('flow_taxi_driver_id', currentUserId);
      }
      const profileToSave = currentDriverProfile || result.driver;
      if (profileToSave) {
        localStorage.setItem('flow_taxi_driver_profile', JSON.stringify({
          userId: currentUserId,
          displayName: profileToSave.display_name || driverName,
          plateNumber: profileToSave.plate_number || '已驗證車牌',
          carBrand: profileToSave.car_brand || 'TOYOTA',
          carColor: profileToSave.car_color || '黑色',
          phone: profileToSave.phone || '',
          notes: profileToSave.notes || '',
          compensationPoints: result.compensationPoints ?? driverCompensationPoints,
          isVerified: true,
        }));
      }
    } catch (e) {}

    if (isInstantWon) {
      document.getElementById('success-title').textContent = `🎉【${driverName}】使用補單點數立即中單！`;
      document.getElementById('success-desc').textContent = `已免除 30 秒等待並立即完成結單指派！聊天室已直接啟動接單後流程，請至 1:1 官方帳號查看行程卡片與導航（剩餘補單點數：${result.compensationPoints ?? 0} 點）。`;
    } else {
      document.getElementById('success-title').textContent = `【${driverName}】已接單！`;
      document.getElementById('success-desc').textContent = `預估約 ${totalMins} 分鐘抵達現場。系統正在進行 30 秒派單媒合中，請稍候！即將自動返回聊天室...`;
    }

    document.getElementById('bid-card').classList.add('hidden');
    document.getElementById('success-screen').classList.remove('hidden');

    const checkIcon = document.getElementById('success-check-icon');
    setTimeout(() => {
      checkIcon?.setAttribute('data-state', 'in');
    }, 50);

    // 需求 5: 如果是從網頁捷徑 (source=web) 進來的，接單按鈕按下去後回到主畫面（地圖＋清單）等待接單結果；若是 LINE 聊天室進入則維持關閉 LIFF
    const urlParams = new URLSearchParams(window.location.search);
    const isWebSource = urlParams.get('source') === 'web' || !liff.isInClient();

    if (isWebSource) {
      if (isInstantWon) {
        document.getElementById('success-desc').textContent = `已使用補單點數立即中單！即將返回地圖儀表板進入導航...`;
      } else {
        document.getElementById('success-desc').textContent = `預估約 ${totalMins} 分鐘抵達現場。系統正在進行 30 秒派單媒合中，即將返回地圖儀表板...`;
      }
    }

    setTimeout(() => {
      if (isWebSource) {
        window.location.href = isInstantWon
          ? `/driver/app`
          : `/driver/app?submittedOrder=${orderId}`;
      } else {
        closeLiffWindow();
      }
    }, 1500);

  } catch (err) {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.classList.remove('opacity-60', 'cursor-not-allowed');
    }
    statusBox.className = 'mt-4 p-3.5 rounded-xl text-xs font-medium text-center bg-red-50 text-red-600 border border-red-200';
    statusBox.innerHTML = `<strong>❌ 接單失敗</strong><br>${err.message}`;
  }
});

function showError(msg) {
  const locatingEl = document.getElementById('locating-state');
  if (locatingEl) {
    locatingEl.innerHTML = `
      <div class="text-red-500 font-bold text-sm mb-1">⚠️ 無法載入接單資訊</div>
      <p class="text-xs text-slate-500">${msg}</p>
      <button onclick="closeLiffWindow();" class="mt-4 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs">返回 LINE</button>
    `;
  }
}

function closeLiffWindow(options = {}) {
  try {
    if (typeof liff !== 'undefined' && liff.isInClient && liff.isInClient()) {
      liff.closeWindow();
      return;
    }
    if (typeof liff !== 'undefined' && liff.closeWindow) {
      liff.closeWindow();
      return;
    }
  } catch (e) {
    console.warn('liff.closeWindow 失敗:', e);
  }
  window.close();
  // 非接單駕駛絕不引導去 1:1 OA，避免造成誤會
  if (!options.skipOaFallback && isCurrentDriverWinner) {
    setTimeout(() => {
      window.location.href = currentOaUrl;
    }, 200);
  } else if (window.history.length > 1) {
    window.history.back();
  }
}
window.closeLiffWindow = closeLiffWindow;

initBidLiff();
