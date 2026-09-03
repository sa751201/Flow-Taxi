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

function updateEtaDisplay() {
  const totalEta = baseEtaMinutes + extraMinutes;
  const etaMinsEl = document.getElementById('eta-mins');
  if (etaMinsEl) {
    etaMinsEl.textContent = totalEta;
  }

  const distanceBadgeEl = document.getElementById('eta-distance-badge');
  if (distanceBadgeEl) {
    distanceBadgeEl.textContent = `約 ${baseDistanceKm.toFixed(1)} km`;
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

  if (!orderId) {
    showError('未提供訂單編號，無法接單');
    return;
  }

  try {
    const configRes = await fetch('/api/config');
    const config = await configRes.json();
    const liffId = config.liffId;

    if (liffId && typeof liff !== 'undefined') {
      await liff.init({ liffId });
      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }
      const profile = await liff.getProfile();
      currentUserId = profile.userId;
    } else {
      currentUserId = 'DEV_DRIVER_' + Date.now();
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
    }

    // 取得訂單資訊
    const orderRes = await fetch(`/api/orders/${orderId}`);
    if (!orderRes.ok) {
      throw new Error('找不到該訂單或已結束派單');
    }
    orderData = await orderRes.json();

    document.getElementById('pickup-addr').textContent = orderData.pickup_address;
    document.getElementById('dropoff-addr').textContent = orderData.dropoff_address || '乘客上車後說明';

    // 需求 5: 把預估車資加到按鈕下方
    const fareEl = document.getElementById('fare-amount');
    const fareDistEl = document.getElementById('fare-distance');
    if (fareEl) {
      const estimatedFare = orderData.fare || Math.round(60 + (orderData.distance_km || 5) * 20);
      fareEl.textContent = `$${estimatedFare}`;
    }
    if (fareDistEl && orderData.distance_km) {
      fareDistEl.textContent = `行程約 ${Number(orderData.distance_km).toFixed(1)} 公里`;
    }

    // 需求 7: 幫我加一個判斷，已經有人的接單，當群組內有人點立刻接單的話，
    // 該 LIFF 顯示資訊，但不會有時間估算這區以及接單的按鈕。
    const hasBids = Boolean(orderData.hasBids || (orderData.bidsCount && orderData.bidsCount > 0) || orderData.status === 'accepted');
    const isAlreadyAccepted = orderData.status === 'accepted' || orderData.status === 'no_driver';
    
    if (hasBids || isAlreadyAccepted) {
      const actionSec = document.getElementById('bidding-action-section');
      const alreadyNotice = document.getElementById('already-bid-notice');
      if (actionSec) actionSec.classList.add('hidden');
      if (alreadyNotice) {
        alreadyNotice.classList.remove('hidden');
        if (orderData.status === 'accepted') {
          alreadyNotice.innerHTML = `
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

    // 取得司機手機 GPS 定位 (加上 2.5 秒超時保護，避免 iOS LINE 內建瀏覽器卡住)
    let located = false;
    const fallbackTimer = setTimeout(async () => {
      if (!located) {
        located = true;
        console.warn('GPS 定位逾時，自動切換至市區預設距離估算');
        await fetchCalculatedEta();
      }
    }, 2500);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (!located) {
            located = true;
            clearTimeout(fallbackTimer);
            driverLat = pos.coords.latitude;
            driverLng = pos.coords.longitude;
            await fetchCalculatedEta();
          }
        },
        async (geoErr) => {
          if (!located) {
            located = true;
            clearTimeout(fallbackTimer);
            console.warn('無法取得精準 GPS，使用市區預設距離估算:', geoErr.message);
            await fetchCalculatedEta();
          }
        },
        { timeout: 2000, enableHighAccuracy: false, maximumAge: 60000 }
      );
    } else {
      clearTimeout(fallbackTimer);
      await fetchCalculatedEta();
    }

  } catch (err) {
    showError(err.message);
  }
}

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
      baseEtaMinutes = etaData.durationMinutes || 5;
      baseDistanceKm = (etaData.distanceMeters || 1500) / 1000;
    }
  } catch (e) {
    console.warn('計算車程異常，使用預估值:', e);
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

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.classList.add('opacity-60', 'cursor-not-allowed');
  }

  const statusBox = document.getElementById('status-box');
  statusBox.className = 'mt-4 p-3.5 rounded-xl text-xs font-medium text-center bg-amber-50 text-amber-800 border border-amber-200';
  statusBox.textContent = '接單意願送出中...';
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
      }),
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || `接單失敗 (HTTP ${res.status})`);
    }

    const driverName = result.driverName || currentDriverProfile?.display_name || '司機夥伴';
    document.getElementById('success-title').textContent = `【${driverName}】已接單！`;
    document.getElementById('success-desc').textContent = `預估約 ${totalMins} 分鐘抵達現場。系統正在進行派單媒合中，請稍候！即將自動返回聊天室...`;

    document.getElementById('bid-card').classList.add('hidden');
    document.getElementById('success-screen').classList.remove('hidden');

    const checkIcon = document.getElementById('success-check-icon');
    setTimeout(() => {
      checkIcon?.setAttribute('data-state', 'in');
    }, 50);

    // 需求 1: 接單後請關閉 LIFF 畫面 (停留 1.5 秒讓司機看見接單成功畫面後自動關閉)
    setTimeout(() => {
      closeLiffWindow();
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

function closeLiffWindow() {
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
  setTimeout(() => {
    window.location.href = 'https://line.me/R/ti/p/@688muuaw';
  }, 200);
}
window.closeLiffWindow = closeLiffWindow;

initBidLiff();
