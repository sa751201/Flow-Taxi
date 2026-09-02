// Driver Registration LIFF Client Logic
let currentUserId = null;
let currentIdToken = null;
let currentLineProfile = null;

async function initLiff() {
  const avatarEl = document.getElementById('driver-avatar');

  try {
    // 取得後端配置的 LIFF_ID 或預設值
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

    // 預設將司機名稱填為 LINE 顯示名稱
    const nameInput = document.getElementById('displayName');
    if (!nameInput.value && profile.displayName) {
      nameInput.value = profile.displayName;
    }

    // 檢查司機是否已經有資料，若有則回填
    checkExistingDriver(currentUserId);
  } catch (err) {
    console.error('LIFF 初始化失敗:', err);
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

// 觸發 Transitions.dev Error State Shake
function triggerShake(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const inputContainer = wrap.querySelector('.t-input');

  wrap.classList.add('is-error');
  if (inputContainer) {
    inputContainer.classList.remove('is-shaking');
    void inputContainer.offsetWidth; // force reflow
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

  const statusBox = document.getElementById('status-box');
  statusBox.className = 'mt-4 p-3.5 rounded-xl text-xs font-medium text-center bg-amber-50 text-amber-800 border border-amber-200';
  statusBox.textContent = '資料儲存中，請稍候...';
  statusBox.classList.remove('hidden');

  try {
    const res = await fetch('/api/driver/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUserId,
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
      throw new Error(result.error || '登記失敗');
    }

    // 成功狀態切換 (需求 3: 表格呈現登記項目)
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
      checkIcon.setAttribute('data-state', 'in');
    }, 50);

  } catch (err) {
    statusBox.className = 'mt-4 p-3.5 rounded-xl text-xs font-medium text-center bg-red-50 text-red-600 border border-red-200';
    statusBox.textContent = `❌ ${err.message}`;
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
