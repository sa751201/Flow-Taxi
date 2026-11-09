(function () {
  'use strict';

  let customers = [];

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }[m]));
  }

  function showCopyTooltip() {
    const tooltip = document.getElementById('global-copy-tooltip');
    if (!tooltip) return;
    tooltip.classList.remove('opacity-0');
    tooltip.classList.add('opacity-100');
    setTimeout(() => {
      tooltip.classList.remove('opacity-100');
      tooltip.classList.add('opacity-0');
    }, 1800);
  }

  async function copyDispatchText(pickup, dropoff, route) {
    const routeText = route && route.trim() ? route.trim() : '依導航最佳路線';
    const text = `🟢 上車地點：${pickup}\n🔴 下車地點：${dropoff || '乘客上車後說明'}\n🛣️ 指定路線：${routeText}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    showCopyTooltip();
  }

  async function loadRegularCustomers() {
    const listEl = document.getElementById('admin-regular-list');
    const totalEl = document.getElementById('admin-reg-total');
    if (!listEl) return;

    try {
      const res = await fetch('/api/admin/regular-customers');
      const data = await res.json();
      customers = data.customers || [];

      if (totalEl) totalEl.textContent = `${customers.length} 筆`;

      if (customers.length === 0) {
        listEl.innerHTML = '<p class="text-sm text-slate-400 text-center py-10">目前尚無常客設定，請從左側表單新增。</p>';
        return;
      }

      listEl.innerHTML = customers
        .map((c) => {
          const routeText = c.fixed_route && c.fixed_route.trim() ? c.fixed_route.trim() : '依導航最佳路線';
          return `
            <div class="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 hover:bg-white transition space-y-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-extrabold text-slate-900">👤 ${escapeHtml(c.customer_name)}</span>
                  ${c.customer_id ? `<span class="px-2 py-0.5 rounded bg-slate-200 text-slate-600 font-mono text-[11px]">${escapeHtml(c.customer_id)}</span>` : '<span class="px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[11px] font-bold">不限特定帳號</span>'}
                </div>
                <span class="px-3 py-1 rounded-xl bg-amber-100 text-amber-800 font-black text-sm">固定車資 $${c.fixed_fare}</span>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                <p class="font-bold text-slate-800">🟢 固定上車：${escapeHtml(c.pickup_address)}</p>
                <p class="font-bold text-slate-800">🔴 固定下車：${escapeHtml(c.dropoff_address)}</p>
              </div>
              <p class="text-xs font-bold text-indigo-700">🛣️ 指定路線：${escapeHtml(routeText)}</p>
              ${c.note ? `<p class="text-[11px] text-slate-500">📝 備註：${escapeHtml(c.note)}</p>` : ''}

              <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-200/70">
                <button type="button" data-copy-id="${escapeHtml(c.id)}" class="btn-copy-reg px-3 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs">
                  📋 複製派單資訊
                </button>
                <button type="button" data-edit-id="${escapeHtml(c.id)}" class="btn-edit-reg px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs">
                  ✏️ 編輯
                </button>
                <button type="button" data-del-id="${escapeHtml(c.id)}" class="btn-del-reg px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs">
                  🗑️ 刪除
                </button>
              </div>
            </div>
          `;
        })
        .join('');

      listEl.querySelectorAll('.btn-copy-reg').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = customers.find((x) => x.id === btn.getAttribute('data-copy-id'));
          if (item) copyDispatchText(item.pickup_address, item.dropoff_address, item.fixed_route);
        });
      });

      listEl.querySelectorAll('.btn-edit-reg').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = customers.find((x) => x.id === btn.getAttribute('data-edit-id'));
          if (!item) return;
          document.getElementById('admin-reg-id').value = item.id;
          document.getElementById('admin-reg-name').value = item.customer_name || '';
          document.getElementById('admin-reg-customer-id').value = item.customer_id || '';
          document.getElementById('admin-reg-pickup').value = item.pickup_address || '';
          document.getElementById('admin-reg-dropoff').value = item.dropoff_address || '';
          document.getElementById('admin-reg-fare').value = item.fixed_fare || '';
          document.getElementById('admin-reg-route').value = item.fixed_route || '';
          document.getElementById('admin-reg-note').value = item.note || '';
          document.getElementById('form-title').textContent = `✏️ 編輯常客：${item.customer_name}`;
          document.getElementById('admin-btn-cancel').classList.remove('hidden');
        });
      });

      listEl.querySelectorAll('.btn-del-reg').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-del-id');
          if (!id || !confirm('確定要刪除此筆常客設定嗎？')) return;
          await fetch(`/api/admin/regular-customers/${encodeURIComponent(id)}`, { method: 'DELETE' });
          loadRegularCustomers();
        });
      });
    } catch (e) {
      listEl.innerHTML = '<p class="text-sm text-rose-500 text-center py-8">載入失敗</p>';
    }
  }

  function resetForm() {
    document.getElementById('admin-reg-id').value = '';
    document.getElementById('admin-regular-form').reset();
    document.getElementById('form-title').textContent = '➕ 新增固定上下車地點常客';
    document.getElementById('admin-btn-cancel').classList.add('hidden');
  }

  document.getElementById('admin-btn-cancel')?.addEventListener('click', resetForm);

  document.getElementById('admin-regular-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      id: document.getElementById('admin-reg-id').value.trim() || undefined,
      customer_name: document.getElementById('admin-reg-name').value.trim(),
      customer_id: document.getElementById('admin-reg-customer-id').value.trim() || null,
      pickup_address: document.getElementById('admin-reg-pickup').value.trim(),
      dropoff_address: document.getElementById('admin-reg-dropoff').value.trim(),
      fixed_fare: Number(document.getElementById('admin-reg-fare').value),
      fixed_route: document.getElementById('admin-reg-route').value.trim(),
      note: document.getElementById('admin-reg-note').value.trim() || null,
    };

    const res = await fetch('/api/admin/regular-customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || '儲存失敗');
      return;
    }

    resetForm();
    loadRegularCustomers();
    const status = document.getElementById('admin-form-status');
    if (status) {
      status.textContent = '✅ 常客設定已儲存！';
      status.classList.remove('hidden');
      setTimeout(() => status.classList.add('hidden'), 2500);
    }
  });

  // 頁籤切換
  const tabReg = document.getElementById('admin-tab-regular');
  const tabTest = document.getElementById('admin-tab-tester');
  const panelReg = document.getElementById('admin-panel-regular');
  const panelTest = document.getElementById('admin-panel-tester');

  tabReg?.addEventListener('click', () => {
    tabReg.className = 'py-3 border-b-2 border-emerald-400 text-emerald-400 font-extrabold flex items-center gap-1.5';
    tabTest.className = 'py-3 border-b-2 border-transparent text-slate-400 hover:text-white flex items-center gap-1.5';
    panelReg?.classList.remove('hidden');
    panelTest?.classList.add('hidden');
  });

  tabTest?.addEventListener('click', () => {
    tabTest.className = 'py-3 border-b-2 border-emerald-400 text-emerald-400 font-extrabold flex items-center gap-1.5';
    tabReg.className = 'py-3 border-b-2 border-transparent text-slate-400 hover:text-white flex items-center gap-1.5';
    panelTest?.classList.remove('hidden');
    panelReg?.classList.add('hidden');
  });

  document.getElementById('btn-run-match-test')?.addEventListener('click', async () => {
    const customerId = document.getElementById('test-customer-id').value.trim();
    const pickupAddress = document.getElementById('test-pickup').value.trim();
    const dropoffAddress = document.getElementById('test-dropoff').value.trim();
    const resEl = document.getElementById('test-match-result');
    if (!resEl) return;

    const res = await fetch('/api/admin/regular-customers/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId, pickupAddress, dropoffAddress }),
    });
    const data = await res.json();
    resEl.classList.remove('hidden');
    if (data.matched && data.customer) {
      resEl.className = 'p-4 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200';
      resEl.innerHTML = `✅ 命中常客【${escapeHtml(data.customer.customer_name)}】！<br>💰 套用固定金額：$${data.customer.fixed_fare}<br>🛣️ 指定路線：${escapeHtml(data.customer.fixed_route || '依導航最佳路線')}`;
    } else {
      resEl.className = 'p-4 rounded-xl text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200';
      resEl.innerHTML = `ℹ️ 上下車地點未完全符合常客固定設定，本趟將以【正常費率】計算車資。`;
    }
  });

  loadRegularCustomers();
})();

