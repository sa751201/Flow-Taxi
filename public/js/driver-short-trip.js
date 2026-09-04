// driver-short-trip.js
let orderId = null;
let currentUserId = null;
let orderData = null;

async function initShortTripLiff() {
  const urlParams = new URLSearchParams(window.location.search);
  orderId = urlParams.get('orderId');

  if (!orderId) {
    alert('未提供訂單編號');
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

    const orderRes = await fetch(`/api/orders/${orderId}`);
    if (!orderRes.ok) {
      throw new Error('找不到該訂單或已結束');
    }
    orderData = await orderRes.json();

    document.getElementById('pickup-addr-display').textContent = orderData.pickup_address;
    if (orderData.dropoff_address && orderData.dropoff_address !== '乘客上車後說明') {
      document.getElementById('dropoff-input').value = orderData.dropoff_address;
    }

    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('form-content').classList.remove('hidden');

  } catch (err) {
    alert('載入訂單失敗: ' + err.message);
  }
}

document.getElementById('btn-calculate')?.addEventListener('click', async () => {
  const dropoff = document.getElementById('dropoff-input').value.trim();
  if (!dropoff) {
    alert('請輸入乘客實際下車地點！');
    return;
  }

  const btn = document.getElementById('btn-calculate');
  btn.disabled = true;
  btn.classList.add('opacity-60', 'cursor-not-allowed');
  btn.textContent = '計算里程中...';

  try {
    const res = await fetch('/api/orders/report-short-trip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId,
        driverId: currentUserId,
        dropoffAddress: dropoff,
      }),
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || '回報失敗');
    }

    const distanceKm = result.distanceKm || 0;
    const isShortTrip = result.isShortTrip;

    // 顯示預覽
    document.getElementById('preview-km').textContent = distanceKm.toFixed(1);
    const badge = document.getElementById('short-trip-badge');
    if (isShortTrip) {
      badge.className = 'inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800';
      badge.textContent = `✅ 行駛 ${distanceKm.toFixed(1)} km，符合 5 公里短程單！已記錄獎勵累積！`;
    } else {
      badge.className = 'inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800';
      badge.textContent = `ℹ️ 行駛 ${distanceKm.toFixed(1)} km，已記錄目的地。`;
    }
    document.getElementById('distance-preview-card').classList.remove('hidden');

    setTimeout(() => {
      document.getElementById('form-content').classList.add('hidden');
      document.getElementById('success-screen').classList.remove('hidden');
      document.getElementById('success-desc').textContent = isShortTrip 
        ? `行駛約 ${distanceKm.toFixed(1)} 公里，已成功記入您的短程單累積獎勵庫！正在返回 LINE...`
        : `已成功記錄目的地（約 ${distanceKm.toFixed(1)} 公里），正在返回 LINE...`;

      setTimeout(() => {
        closeLiffWindow();
      }, 1800);
    }, 1200);

  } catch (err) {
    alert('測算回報失敗: ' + err.message);
    btn.disabled = false;
    btn.classList.remove('opacity-60', 'cursor-not-allowed');
    btn.innerHTML = '<span>📏</span> 測算里程並回報';
  }
});

function closeLiffWindow() {
  try {
    if (typeof liff !== 'undefined' && liff.isInClient && liff.isInClient()) {
      liff.closeWindow();
      return;
    }
  } catch (e) {}
  window.close();
  setTimeout(() => {
    window.location.href = 'https://line.me/R/ti/p/@688muuaw';
  }, 200);
}
window.closeLiffWindow = closeLiffWindow;

initShortTripLiff();
