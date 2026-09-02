// Driver Registration LIFF Client Logic
let currentUserId = null;
let currentIdToken = null;
let currentLineProfile = null;

async function initLiff() {
  const avatarEl = document.getElementById('driver-avatar');

  try {
    const configRes = await fetch('/api/config');
    const config = await configRes.json();
    const liffId = config.liffId;

    if (!liffId) {
      console.warn('LIFF_ID 未設定，進入測試模式');
      currentUserId = 'DEV_LOCAL_DRIVER_123';
      return;
    }

    await liff.init({ liffId });

    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    const profile = await liff.getProfile();
    currentLineProfile = profile;
    currentUserId = profile.userId;
    currentIdToken = liff.getIDToken();

    if (profile.pictureUrl && avatarEl) {
      avatarEl.src = profile.pictureUrl;
    }

    const nameInput = document.getElementById('displayName');
    if (!nameInput.value && profile.displayName) {
      nameInput.value = profile.displayName;
    }

    checkExistingDriver(currentUserId);
  } catch (err) {
    console.error('LIFF 初始化失敗:', err);
    // 降級生成唯一的本地測試識別碼，避免重複衝突
    if (!currentUserId) {
      currentUserId = 'DEV_DRIVER_' + Math.random().toString(36).substring(2, 8);
    }
  }
}

async function checkExistingDriver(userId) {
  try {
    const res = await fetch(`/api/driver/${userId}`);
    if (res.ok) {
      const driver = await res.json();
      if (driver) {
        if (driver.display_name) document.getElementById('displayName').value = driver.display_name;
        if (driver.plate_number) document.getElementById('plateNumber').value = driver.plate_number;
        if (driver.car_color) document.getElementById('carColor').value = driver.car_color;
        if (driver.car_brand) document.getElementById('carBrand').value = driver.car_brand;
        if (driver.phone) document.getElementById('phone').value = driver.phone;
      }
    }
  } catch {
    // ignore
  }
}

function triggerShake(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const inputContainer = wrap.querySelector('.t-input');

  wrap.classList.add('is-error');
  if (inputContainer) {
    inputContainer.classList.remove('is-shaking');
    void inputContainer.offsetWidth;
    inputContainer.classList.add('is-shaking', 'is-error');
  }

  setTimeout(() => {
    wrap.classList.remove('is-error');
    if (inputContainer) {
      inputContainer.classList.remove('is-shaking', 'is-error');
    }
  }, 3000);
}

document.getElementById('submit-btn')?.addEventListener('click', async () => {
  const submitBtn = document.getElementById('submit-btn');
  const btnLabel = submitBtn?.querySelector('.t-pro-btn-label');

  const displayName = document.getElementById('displayName').value.trim();
  const plateNumber = document.getElementById('plateNumber').value.trim();
  const carColor = document.getElementById('carColor').value.trim();
  const carBrand = document.getElementById('carBrand').value.trim();
  const phone = document.getElementById('phone').value.trim();

  let hasError = false;
  if (!displayName) { triggerShake('wrap-name'); hasError = true; }
  if (!plateNumber) { triggerShake('wrap-plate'); hasError = true; }
  if (!carColor) { triggerShake('wrap-color'); hasError = true; }
  if (!carBrand) { triggerShake('wrap-brand'); hasError = true; }

  if (hasError) return;

  // 需求 1: 送出時將按鈕設為 disabled，顯示 loading 狀態
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-60', 'cursor-not-allowed');
    if (btnLabel) {
      btnLabel.innerHTML = `
        <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        資料儲存中...
      `;
    }
  }

  const statusBox = document.getElementById('status-box');
  statusBox.className = 'mt-4 p-3.5 rounded-xl text-xs font-medium text-center bg-amber-50 text-amber-800 border border-amber-200';
  statusBox.textContent = '資料儲存中，請稍候...';
  statusBox.classList.remove('hidden');

  try {
    const res = await fetch('/api/driver/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUserId || 'DEV_DRIVER_' + Date.now(),
        idToken: currentIdToken,
        displayName,
        plateNumber,
        carColor,
        carBrand,
        phone,
      }),
    });

    const result = await res.json();
    if (!res.ok) {
      // 需求 2: 清楚顯示後端具體回傳的錯誤原因
      throw new Error(result.error || `伺服器回應異常 (HTTP ${res.status})`);
    }

    // 成功狀態切換 (表格呈現)
    document.getElementById('form-card').classList.add('hidden');
    const successScreen = document.getElementById('success-screen');
    successScreen.classList.remove('hidden');

    document.getElementById('res-name').textContent = displayName;
    document.getElementById('res-plate').textContent = plateNumber;
    document.getElementById('res-color').textContent = carColor;
    document.getElementById('res-brand').textContent = carBrand;
    document.getElementById('res-phone').textContent = phone || '未填寫';

    const checkIcon = document.getElementById('success-check-icon');
    setTimeout(() => {
      checkIcon?.setAttribute('data-state', 'in');
    }, 50);

  } catch (err) {
    // 需求 2: 發生錯誤時恢復按鈕可點擊，並顯示詳細原因
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.classList.remove('opacity-60', 'cursor-not-allowed');
      if (btnLabel) {
        btnLabel.innerHTML = `
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
          </svg>
          重新確認送出
        `;
      }
    }

    statusBox.className = 'mt-4 p-3.5 rounded-xl text-xs font-medium text-center bg-red-50 text-red-600 border border-red-200';
    statusBox.innerHTML = `<strong>❌ 登記失敗</strong><br><span class="text-[11px] opacity-90">${err.message}</span>`;
  }
});

function closeLiffWindow() {
  if (typeof liff !== 'undefined' && liff.closeWindow) {
    liff.closeWindow();
  } else {
    window.close();
  }
}
window.closeLiffWindow = closeLiffWindow;

// 啟動 LIFF 初始化
initLiff();
