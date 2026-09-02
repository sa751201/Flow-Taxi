// Driver Bid LIFF Logic
let currentUserId = null;
let currentDriverProfile = null;
let orderId = null;
let orderData = null;
let baseEtaMinutes = 5;
let extraMinutes = 0;
let driverLat = 25.0478;
let driverLng = 121.5170;

function updateEtaDisplay() {
  const totalEta = baseEtaMinutes + extraMinutes;
  document.getElementById('eta-mins').textContent = totalEta;

  const now = new Date();
  now.setMinutes(now.getMinutes() + totalEta);
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('eta-clock').textContent = `${hours}:${minutes}`;
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

    // 取得司機手機 GPS 定位
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        driverLat = pos.coords.latitude;
        driverLng = pos.coords.longitude;
        await fetchCalculatedEta();
      },
      async (geoErr) => {
        console.warn('無法取得精準 GPS，使用市區預設距離估算:', geoErr.message);
        await fetchCalculatedEta();
      },
      { timeout: 5000, enableHighAccuracy: true }
    );

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
    }
  } catch (e) {
    console.warn('計算車程異常，使用預估值:', e);
  } finally {
    document.getElementById('locating-state').classList.add('hidden');
    document.getElementById('bid-content').classList.remove('hidden');
    updateEtaDisplay();
  }
}

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
      throw new Error(result.error || '接單失敗');
    }

    const driverName = currentDriverProfile?.display_name || '司機夥伴';
    document.getElementById('success-title').textContent = `已收【${driverName}】單，系統派單中！`;
    document.getElementById('success-desc').textContent = `預計抵達時間：約 ${totalMins} 分鐘。60 秒派單視窗關閉時，系統將自動比對最近司機中單。`;

    document.getElementById('bid-card').classList.add('hidden');
    document.getElementById('success-screen').classList.remove('hidden');

    const checkIcon = document.getElementById('success-check-icon');
    setTimeout(() => {
      checkIcon?.setAttribute('data-state', 'in');
    }, 50);

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
  if (typeof liff !== 'undefined' && liff.closeWindow) {
    liff.closeWindow();
  } else {
    window.close();
  }
}
window.closeLiffWindow = closeLiffWindow;

initBidLiff();
