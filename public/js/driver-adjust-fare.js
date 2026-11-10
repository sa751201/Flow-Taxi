// driver-adjust-fare.js
let orderId = null;
let currentUserId = null;
let orderData = null;
let defaultFare = null;

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

function computeDefaultFare(order) {
  if (!isDetailedDropoffAddress(order?.dropoff_address)) {
    return null;
  }
  const f = Number(order?.fare);
  if (f && !isNaN(f) && f > 0) {
    return Math.round(f);
  }
  const d = Number(order?.distance_km);
  if (d && !isNaN(d) && d > 0) {
    return Math.round(60 + d * 20);
  }
  return null;
}

async function initAdjustFareLiff() {
  const urlParams = new URLSearchParams(window.location.search);
  orderId = urlParams.get('orderId');

  if (!orderId) {
    alert('未提供訂單編號');
    return;
  }

  const subtitleEl = document.getElementById('order-id-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = `訂單編號 #${orderId.slice(-4)}｜確認或修改金額後送出即完成結單`;
  }

  try {
    const configRes = await fetch('/api/config');
    const config = await configRes.json();
    const liffId = config.liffId;

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

    const orderRes = await fetch(`/api/orders/${orderId}`);
    if (!orderRes.ok) {
      throw new Error('找不到該訂單或已結束');
    }
    orderData = await orderRes.json();

    document.getElementById('pickup-addr-display').textContent = orderData.pickup_address || '未提供';
    document.getElementById('dropoff-addr-display').textContent = orderData.dropoff_address || '乘客上車後說明';

    // 乘客有填寫下車地點時預先帶入，沒寫的話讓司機補上
    const dropoffConfirmInputEl = document.getElementById('dropoff-confirm-input');
    const dropoffPrefillHintEl = document.getElementById('dropoff-prefill-hint');
    const rawDropoff = (orderData.dropoff_address || '').trim();
    const isPlaceholderDropoff = !rawDropoff || /^(無|未填|未定|待定|未知|不確定|免填|上車後說明|乘客上車後說明|乘客指定地點|上車告知|上車再說|車上說|車上告知)$/i.test(rawDropoff);

    if (dropoffConfirmInputEl) {
      if (!isPlaceholderDropoff) {
        dropoffConfirmInputEl.value = rawDropoff;
        if (dropoffPrefillHintEl) {
          dropoffPrefillHintEl.textContent = '已帶入乘客填寫地點（可修改確認）';
          dropoffPrefillHintEl.className = 'text-[11px] font-semibold text-emerald-700';
        }
      } else {
        dropoffConfirmInputEl.value = '';
        if (dropoffPrefillHintEl) {
          dropoffPrefillHintEl.textContent = '乘客未填，請司機補上實際下車地點';
          dropoffPrefillHintEl.className = 'text-[11px] font-bold text-amber-700';
        }
      }

      dropoffConfirmInputEl.addEventListener('input', () => {
        const displayEl = document.getElementById('dropoff-addr-display');
        if (displayEl) {
          displayEl.textContent = dropoffConfirmInputEl.value.trim() || rawDropoff || '乘客上車後說明';
        }
      });
    }

    defaultFare = computeDefaultFare(orderData);
    const fareInputEl = document.getElementById('fare-input');
    const hintEl = document.getElementById('original-fare-hint');
    const headerTitleEl = document.getElementById('page-header-title');
    const submitBtnEl = document.getElementById('btn-submit-adjust-fare');

    if (defaultFare !== null) {
      if (fareInputEl) {
        fareInputEl.value = String(defaultFare);
      }
      if (hintEl) {
        hintEl.textContent = `原訂單金額：$${defaultFare}`;
      }
    } else {
      // 使用者沒有詳細下車地址，回報下車時填寫金額這一欄為必填且不預先帶入金額
      if (fareInputEl) {
        fareInputEl.value = '';
        fareInputEl.required = true;
        fareInputEl.placeholder = '請輸入本趟實際金額（必填）';
      }
      if (hintEl) {
        hintEl.textContent = '⚠️ 無詳細下車地址，金額為必填';
        hintEl.className = 'text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200';
      }
      if (headerTitleEl) {
        headerTitleEl.textContent = '填寫訂單金額並回報';
      }
      if (subtitleEl) {
        subtitleEl.textContent = `訂單編號 #${orderId.slice(-4)}｜乘客未提供詳細下車地址，請必填本趟實際金額`;
      }
      if (submitBtnEl) {
        submitBtnEl.innerHTML = '<span>✅</span> 送出金額並回報結單';
      }
    }

    fareInputEl?.addEventListener('input', () => {
      const errEl = document.getElementById('fare-error-msg');
      if (errEl) errEl.classList.add('hidden');
      fareInputEl.classList.remove('border-red-500', 'ring-2', 'ring-red-400');
    });

    // 依據輸入的下車地點自動結算金額按鈕
    const btnCalcFare = document.getElementById('btn-calc-fare');
    const btnCalcText = document.getElementById('btn-calc-fare-text');
    const calcStatusEl = document.getElementById('calc-fare-status');

    btnCalcFare?.addEventListener('click', async () => {
      const dropoffConfirmInputEl = document.getElementById('dropoff-confirm-input');
      const dropoffAddress = (dropoffConfirmInputEl?.value || '').trim();

      if (!dropoffAddress) {
        if (calcStatusEl) {
          calcStatusEl.textContent = '⚠️ 請先輸入下車地點，再點選結算金額！';
          calcStatusEl.className = 'text-xs font-bold text-rose-700 bg-rose-50 p-2.5 rounded-xl border border-rose-200 mt-1';
          calcStatusEl.classList.remove('hidden');
        }
        dropoffConfirmInputEl?.focus();
        return;
      }

      if (btnCalcFare) btnCalcFare.disabled = true;
      if (btnCalcText) btnCalcText.textContent = '計算中...';
      if (calcStatusEl) calcStatusEl.classList.add('hidden');

      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/estimate-fare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dropoffAddress }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || '車資試算失敗');
        }

        const fareInputEl = document.getElementById('fare-input');
        if (fareInputEl) {
          fareInputEl.value = String(data.estimatedFare);
          fareInputEl.classList.remove('border-red-500', 'ring-2', 'ring-red-400');
        }

        const errEl = document.getElementById('fare-error-msg');
        if (errEl) errEl.classList.add('hidden');

        const hintEl = document.getElementById('original-fare-hint');
        if (hintEl) {
          hintEl.textContent = `試算金額：$${data.estimatedFare} (${data.distanceKm}km)`;
          hintEl.className = 'text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200';
        }

        if (calcStatusEl) {
          calcStatusEl.classList.remove('hidden');
          if (data.isShortTrip) {
            calcStatusEl.className = 'text-xs font-bold text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-200 mt-1 space-y-0.5';
            calcStatusEl.innerHTML = `
              <div class="flex items-center gap-1.5">
                <span>⚡</span>
                <span>已自動結算：全程約 <strong>${data.distanceKm} 公里</strong>（小於 5 公里短程單）</span>
              </div>
              <div class="text-[11px] text-amber-700">
                系統試算車資為 <strong>$${data.estimatedFare}</strong> 元（${data.fareBreakdown || ''}），亦允許於下方手動修改金額。
              </div>
            `;
          } else {
            calcStatusEl.className = 'text-xs font-bold text-emerald-800 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 mt-1 space-y-0.5';
            calcStatusEl.innerHTML = `
              <div class="flex items-center gap-1.5">
                <span>✅</span>
                <span>已自動結算：全程約 <strong>${data.distanceKm} 公里</strong></span>
              </div>
              <div class="text-[11px] text-emerald-700">
                系統試算車資為 <strong>$${data.estimatedFare}</strong> 元（${data.fareBreakdown || ''}），亦允許於下方手動修改金額。
              </div>
            `;
          }
        }
      } catch (err) {
        if (calcStatusEl) {
          calcStatusEl.textContent = `❌ 試算失敗: ${err.message}`;
          calcStatusEl.className = 'text-xs font-bold text-rose-700 bg-rose-50 p-2.5 rounded-xl border border-rose-200 mt-1';
          calcStatusEl.classList.remove('hidden');
        }
      } finally {
        if (btnCalcFare) btnCalcFare.disabled = false;
        if (btnCalcText) btnCalcText.textContent = '結算金額';
      }
    });

    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('form-content').classList.remove('hidden');
  } catch (err) {
    alert('載入訂單失敗: ' + err.message);
  }
}

document.getElementById('btn-submit-adjust-fare')?.addEventListener('click', async () => {
  const fareInputEl = document.getElementById('fare-input');
  const noteInputEl = document.getElementById('note-input');
  const errEl = document.getElementById('fare-error-msg');
  const rawValStr = (fareInputEl?.value || '').trim();
  const rawFare = Number(rawValStr);
  const adjustNote = (noteInputEl?.value || '').trim();

  if (!rawValStr || !rawFare || isNaN(rawFare) || rawFare <= 0) {
    if (errEl) {
      errEl.classList.remove('hidden');
    }
    if (fareInputEl) {
      fareInputEl.classList.add('border-red-500', 'ring-2', 'ring-red-400');
      fareInputEl.focus();
    }
    alert('請填寫有效的訂單金額（此欄為必填，需大於 0）！');
    return;
  }

  const finalFare = Math.round(rawFare);
  const dropoffConfirmInputEl = document.getElementById('dropoff-confirm-input');
  const confirmedDropoff = (dropoffConfirmInputEl?.value || '').trim();
  const btn = document.getElementById('btn-submit-adjust-fare');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-60', 'cursor-not-allowed');
    btn.textContent = '正在送出結單回報並偵測里程...';
  }

  try {
    const res = await fetch('/api/orders/complete-with-fare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId,
        driverId: currentUserId,
        fare: finalFare,
        dropoffAddress: confirmedDropoff || undefined,
        adjustNote: adjustNote || undefined,
        isAdjusted: true,
      }),
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || '回報結單失敗');
    }

    document.getElementById('form-content').classList.add('hidden');
    document.getElementById('success-screen').classList.remove('hidden');
    if (result.isShortTrip) {
      document.getElementById('success-desc').innerHTML =
        `訂單 #${orderId.slice(-4)} 已完結！結單金額 $${finalFare}${adjustNote ? `（備註：${adjustNote}）` : ''} 已同步傳送至聊天室群組。<br><br><span class="text-blue-700 font-extrabold">📏 系統偵測本趟距離約 ${result.distanceKm} 公里（小於 5 公里短程單），已發送 Flex Message 提示至您的 1:1 OA 並同步通知管理群組，待管理員核實後將發給您補單點數！</span>`;
    } else {
      document.getElementById('success-desc').textContent =
        `訂單 #${orderId.slice(-4)} 已完結！結單金額 $${finalFare}${adjustNote ? `（備註：${adjustNote}）` : ''} 已同步傳送至聊天室群組。`;
    }

    setTimeout(() => {
      closeLiffWindow();
    }, 1500);
  } catch (err) {
    alert('回報結單失敗: ' + err.message);
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('opacity-60', 'cursor-not-allowed');
      btn.innerHTML = '<span>✅</span> 送出修改金額並回報結單';
    }
  }
});

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
  } catch (e) {}
  window.close();
  if (window.history.length > 1) {
    window.history.back();
  }
}
window.closeLiffWindow = closeLiffWindow;

initAdjustFareLiff();

