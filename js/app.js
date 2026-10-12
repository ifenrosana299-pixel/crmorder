
// ── UTILS ─────────────────────────────────────────────────────────────────────
function nowWIB() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('Z', '+07:00');
}

// ── STATE ─────────────────────────────────────────────────────────────────────
let currentUser   = null;
let currentProfile = null;
let parsedData    = null;   // hasil AI parsing
let todayOrders   = [];     // orderan hari ini milik CS ini

// ── GUDANG ────────────────────────────────────────────────────────────────────
let gudangList    = [];
let selectedGudang = null;

async function loadGudang() {
  const { data } = await sb.from('gudang').select('*').eq('aktif', true).order('id');
  if (!data?.length) return;
  gudangList = data;
  selectedGudang = data.find(g => g.is_default) || data[0];
  ['sel-gudang', 'sel-gudang-ongkir'].forEach(elId => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = data.map(g => `<option value="${g.id}">${g.nama}</option>`).join('');
    el.value = selectedGudang.id;
  });
}

function onGudangChange(id) {
  selectedGudang = gudangList.find(g => g.id == id) || selectedGudang;
  ['sel-gudang', 'sel-gudang-ongkir'].forEach(elId => {
    const el = document.getElementById(elId);
    if (el) el.value = id;
  });
  // Reset ongkir check karena gudang berubah
  scheduleOngkirCheck();
}

// ── DATE RANGE PICKER (port dari BotWA analytics) ────────────────────────────
let drpSelStart = null, drpSelEnd = null, drpPickingEnd = false;
let drpViewYear = new Date().getFullYear(), drpViewMonth = new Date().getMonth();
const MONTHS_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const DAYS_ID   = ['Mo','Tu','We','Th','Fr','Sa','Su'];

// State filter aktif — default pakai cutoff logic (sebelum jam 8 = kemarin)
let filterDateStart = getOrderDate();
let filterDateEnd   = getOrderDate();

function drpFmt(d) {
  if (!d) return '—';
  return d.toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
}

function drpToggle() {
  const dd = document.getElementById('drp-dropdown');
  dd.classList.toggle('open');
  if (dd.classList.contains('open')) { drpRender(); document.addEventListener('click', drpOutside); }
  else document.removeEventListener('click', drpOutside);
}

function drpClose() {
  document.getElementById('drp-dropdown').classList.remove('open');
  document.removeEventListener('click', drpOutside);
}

function drpOutside(e) {
  const dd = document.getElementById('drp-dropdown');
  const tr = document.getElementById('drp-trigger');
  if (dd && tr && !dd.contains(e.target) && !tr.contains(e.target)) drpClose();
}

function drpPreset(days, label, btn) {
  drpSelStart = new Date(Date.now() - (days-1)*864e5); drpSelStart.setHours(0,0,0,0);
  drpSelEnd   = new Date(); drpSelEnd.setHours(23,59,59,999);
  document.querySelectorAll('.drp-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  drpUpdateSel(); drpRender();
}

function drpPresetThisMonth(btn) {
  drpSelStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  drpSelEnd   = new Date(); drpSelEnd.setHours(23,59,59,999);
  document.querySelectorAll('.drp-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  drpUpdateSel(); drpRender();
}

function drpPresetLastMonth(btn) {
  const n = new Date();
  drpSelStart = new Date(n.getFullYear(), n.getMonth()-1, 1);
  drpSelEnd   = new Date(n.getFullYear(), n.getMonth(), 0); drpSelEnd.setHours(23,59,59,999);
  document.querySelectorAll('.drp-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  drpUpdateSel(); drpRender();
}

function drpPresetYesterday(btn) {
  drpSelStart = new Date(Date.now()-864e5); drpSelStart.setHours(0,0,0,0);
  drpSelEnd   = new Date(Date.now()-864e5); drpSelEnd.setHours(23,59,59,999);
  document.querySelectorAll('.drp-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  drpUpdateSel(); drpRender();
}

function drpUpdateSel() {
  document.getElementById('drp-sel-start').textContent = drpFmt(drpSelStart);
  document.getElementById('drp-sel-end').textContent   = drpFmt(drpSelEnd);
}

function drpApply() {
  if (!drpSelStart) return;
  const s = drpSelStart;
  const e = drpSelEnd || drpSelStart;
  e.setHours(23,59,59,999);
  // Simpan sebagai YYYY-MM-DD WIB untuk query Supabase
  filterDateStart = s.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  filterDateEnd   = e.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const label = filterDateStart === filterDateEnd
    ? drpFmt(s)
    : drpFmt(s) + ' — ' + drpFmt(e);
  document.getElementById('drp-label').textContent = label;
  drpClose();
  loadDashboard();
}

function drpClickDay(y, m, d) {
  const clicked = new Date(y, m, d);
  if (!drpSelStart || (drpSelStart && drpSelEnd)) {
    drpSelStart = clicked; drpSelEnd = null; drpPickingEnd = true;
  } else {
    if (clicked < drpSelStart) { drpSelEnd = drpSelStart; drpSelStart = clicked; }
    else drpSelEnd = clicked;
    drpPickingEnd = false;
  }
  drpUpdateSel(); drpRender();
}

function drpRender() {
  const y = drpViewYear, m = drpViewMonth;
  const firstDay    = new Date(y, m, 1).getDay();
  const startPad    = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const prevDays    = new Date(y, m, 0).getDate();
  const today       = new Date(); today.setHours(0,0,0,0);

  let html = `<div class="drp-cal-hdr">
    <button class="drp-nav" onclick="drpNav(-1)">‹</button>
    <div class="drp-cal-title">${MONTHS_ID[m]} ${y}</div>
    <button class="drp-nav" onclick="drpNav(1)">›</button>
  </div>
  <div class="drp-days-hdr">${DAYS_ID.map(d => '<span>' + d + '</span>').join('')}</div>
  <div class="drp-days">`;

  for (let i = startPad; i > 0; i--) {
    html += `<button class="drp-day other-month" onclick="drpNav(-1)">${prevDays-i+1}</button>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cur     = new Date(y, m, d);
    const isToday = cur.getTime() === today.getTime();
    const isStart = drpSelStart && cur.getTime() === new Date(drpSelStart.getFullYear(), drpSelStart.getMonth(), drpSelStart.getDate()).getTime();
    const isEnd   = drpSelEnd   && cur.getTime() === new Date(drpSelEnd.getFullYear(),   drpSelEnd.getMonth(),   drpSelEnd.getDate()).getTime();
    const inRange = drpSelStart && drpSelEnd && cur > drpSelStart && cur < drpSelEnd;

    let cls = 'drp-day';
    if (isStart && isEnd) cls += ' selected';
    else if (isStart)     cls += ' range-start';
    else if (isEnd)       cls += ' range-end';
    else if (inRange)     cls += ' in-range';
    if (isToday) cls += ' today';

    html += `<button class="${cls}" onclick="drpClickDay(${y},${m},${d})">${d}</button>`;
  }

  const total = startPad + daysInMonth;
  const rem   = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let d = 1; d <= rem; d++) {
    html += `<button class="drp-day other-month" onclick="drpNav(1)">${d}</button>`;
  }
  html += '</div>';
  document.getElementById('drp-cal').innerHTML = html;
}

function drpNav(dir) {
  drpViewMonth += dir;
  if (drpViewMonth > 11) { drpViewMonth = 0; drpViewYear++; }
  if (drpViewMonth < 0)  { drpViewMonth = 11; drpViewYear--; }
  drpRender();
}

// Init — set default hari ini sebagai Date object
(function() {
  drpSelStart = new Date(); drpSelStart.setHours(0,0,0,0);
  drpSelEnd   = new Date(); drpSelEnd.setHours(23,59,59,999);
})();

// ── INIT ──────────────────────────────────────────────────────────────────────
(async () => {
  currentUser = await requireAuth();
  if (!currentUser) return;

  // Load profile
  currentProfile = await getProfile(currentUser.id);
  if (!currentProfile) {
    // Buat profile baru kalau belum ada
    const meta = currentUser.user_metadata || {};
    currentProfile = { id: currentUser.id, nama: meta.nama || currentUser.email, no_wa: meta.no_wa || '', email: currentUser.email };
    await sb.from('crm_profiles').upsert(currentProfile);
  }

  // Topbar & avatar
  const nama = currentProfile.nama || currentUser.email;
  document.getElementById('user-nama').textContent         = nama;
  document.getElementById('user-avatar').textContent       = nama.charAt(0).toUpperCase();
  document.getElementById('mobile-avatar').textContent     = nama.charAt(0).toUpperCase();
  document.getElementById('topbar-date').textContent       = new Date().toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  // Admin langsung redirect ke admin panel
  if (currentProfile.role === 'admin') {
    window.location.href = 'admin.html';
    return;
  }

  // Restore theme
  if (localStorage.getItem('cs_theme') === 'dark') {
    document.documentElement.setAttribute('data-theme','dark');
    document.getElementById('theme-icon').textContent        = '☀️';
    document.getElementById('theme-label').textContent       = 'Terang';
    document.getElementById('theme-icon-mobile').textContent = '☀️';
  }

  await loadGudang();
  await loadDashboard();
  await loadHistoryMini();
  checkAndShowLockBanner();
  loadWaTemplate(); // fire and forget — template WA bermasalah

  // Handle redirect balik dari Google OAuth (gmail=success/error/cancelled)
  const qp = new URLSearchParams(window.location.search);
  const gmailParam = qp.get('gmail');
  if (gmailParam) {
    history.replaceState({}, '', window.location.pathname); // bersihkan query string
    if (gmailParam === 'success') {
      const emailParam = qp.get('email') || '';
      switchPage('setting');
      showToast('Gmail berhasil dihubungkan!' + (emailParam ? ' (' + emailParam + ')' : ''), 'success');
    } else if (gmailParam === 'error') {
      switchPage('setting');
      showToast('Gagal menghubungkan Gmail. Coba lagi.', 'error');
    } else if (gmailParam === 'cancelled') {
      switchPage('setting');
      showToast('Koneksi Gmail dibatalkan.', 'info');
    }
  }
})();

// ── NAVIGATION ────────────────────────────────────────────────────────────────
function switchPage(name) {
  ['dashboard','upload','tracking','setting','ongkir'].forEach(p => {
    document.getElementById('page-'+p).classList.toggle('active', p===name);
    // Sidebar nav (desktop)
    const navEl = document.getElementById('nav-'+p);
    if (navEl) navEl.classList.toggle('active', p===name);
    // Bottom nav (mobile)
    const bnavEl = document.getElementById('bnav-'+p);
    if (bnavEl) bnavEl.classList.toggle('active', p===name);
  });
  const titles = { dashboard:'Dashboard', upload:'Upload Order', tracking:'Tracking Order', setting:'Setting', ongkir:'Cek Ongkir' };
  document.getElementById('topbar-title').textContent = titles[name] || '';
  if (name === 'dashboard') loadDashboard();
  if (name === 'upload')    { loadHistoryMini(); checkAndShowLockBanner(); }
  if (name === 'tracking')  loadTracking();
  if (name === 'setting')   loadSetting();
}

// ── DARK MODE ────────────────────────────────────────────────────────────────
function toggleDark() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    document.getElementById('theme-icon').textContent        = '🌙';
    document.getElementById('theme-label').textContent       = 'Gelap';
    document.getElementById('theme-icon-mobile').textContent = '🌙';
    localStorage.setItem('cs_theme','light');
  } else {
    document.documentElement.setAttribute('data-theme','dark');
    document.getElementById('theme-icon').textContent        = '☀️';
    document.getElementById('theme-label').textContent       = 'Terang';
    document.getElementById('theme-icon-mobile').textContent = '☀️';
    localStorage.setItem('cs_theme','dark');
  }
}

// ── HELPER: Render semua badge validasi ──────────────────────────────────────
function buildValBadges(r) {
  const badges = [];
  if (r.is_dup_today)     badges.push('<span class="badge badge-dup">DUP HARI INI</span>');
  if (r.is_dup_all)       badges.push('<span class="badge badge-dup">DUP ALL</span>');
  if (r.is_dup_all && currentProfile?.gmail_email) {
    if (r.iklan_verified === false)
      badges.push('<span class="badge" style="background:var(--danger-light,#fee2e2);color:var(--danger,#dc2626);font-size:10px">⛔ Tidak ada klik iklan dalam 7 hari</span>');
    else if (r.iklan_verified === true)
      badges.push('<span class="badge" style="background:var(--success-light,#dcfce7);color:var(--success,#16a34a);font-size:10px">✅ Klik iklan terverifikasi</span>');
  }
  if (r.is_rts)           badges.push('<span class="badge badge-rts">PERNAH RTS</span>');
  if (r.is_wajib_transfer)badges.push('<span class="badge badge-rts">WAJIB TRANSFER</span>');
  if (r.is_wilayah_rawan) badges.push('<span class="badge badge-warn">RAWAN</span>');
  if (!badges.length)     badges.push('<span class="badge badge-ok">AMAN</span>');
  return badges.join(' ');
}

// ── HELPER: Tombol Bukti SS ───────────────────────────────────────────────────
// Syarat wajib SS bukti — port dari isBadGradeRow() ValidasiOrder (`!grade || grade==='-' ||
// /^[DE]/i` — grade kosong/'-' ITU JUGA dianggep rendah, bukan cuma D/E doang) + Wilayah Rawan
// (keputusan user, sesi 2026-07-11: gak ada preseden di ValidasiOrder buat ini, sengaja
// ditambahin di sini doang). csorder cuma punya A-D (gak ada E), grade kosong = customer belum
// pernah order sama sekali di Mengantar (belum ada rekam jejak) — count sebagai rendah juga,
// sama kayak "-" di ValidasiOrder. Semua kondisi (dup_all/rts/wilayah_rawan/grade
// rendah-atau-kosong) cukup 1 bukti "deal" — numpuk >1 alasan bareng TETAP cuma 1 SS, bukan
// nambah jenis baru per alasan. "iklan" tetap khusus dup_all doang (gak berubah).
function ssNeeds(r) {
  const grade      = r.receiver_score?.grade;
  const isBadGrade = !grade || grade === 'D';
  const needIklan  = r.is_dup_all;
  const needDeal   = r.is_dup_all || r.is_rts || r.is_wilayah_rawan || isBadGrade;
  return { needIklan, needDeal, needSS: needIklan || needDeal };
}

function buildSSBtn(r) {
  const { needIklan, needDeal, needSS } = ssNeeds(r);
  if (!needSS) return '<span style="color:var(--muted);font-size:11px">—</span>';
  const existing = Array.isArray(r.ss_urls) ? r.ss_urls : [];
  const hasIklan  = existing.some(s => s.type === 'iklan');
  const hasDeal   = existing.some(s => s.type === 'deal');
  const allDone   = (!needIklan || hasIklan) && (!needDeal || hasDeal);
  if (allDone) {
    return `<button class="btn-ss btn-ss-done" onclick="openSSModal('${r.id}')">✅ Lihat Bukti</button>`;
  }
  return `<button class="btn-ss btn-ss-upload" onclick="openSSModal('${r.id}')">📎 Upload Bukti</button>`;
}

// ── SS MODAL ──────────────────────────────────────────────────────────────────
const SS_BUCKET = 'ss-bukti';
let ssCurrentOrder = null;
let ssNewFiles = {}; // { iklan: Blob|null, deal: Blob|null }

function openSSModal(orderId) {
  ssCurrentOrder = todayOrders.find(o => o.id === orderId);
  if (!ssCurrentOrder) return;
  ssNewFiles = {};

  const existing = Array.isArray(ssCurrentOrder.ss_urls) ? ssCurrentOrder.ss_urls : [];
  const { needIklan, needDeal } = ssNeeds(ssCurrentOrder);
  const locked = checkSSLock(ssCurrentOrder);

  document.getElementById('ss-modal-sub').textContent = ssCurrentOrder.nama || '';

  let body = '';
  if (needIklan) body += ssBuildSection('iklan', 'SS Customer Masuk Iklan', existing.find(s => s.type === 'iklan')?.url || null, locked);
  if (needDeal)  body += ssBuildSection('deal',  'SS Deal Customer',         existing.find(s => s.type === 'deal')?.url  || null, locked);

  document.getElementById('ss-modal-body').innerHTML = body;
  document.getElementById('ss-modal').style.display  = 'flex';
  const saveBtn = document.getElementById('ss-save-btn');
  if (saveBtn) saveBtn.style.display = locked ? 'none' : '';
}

function closeSSModal() {
  document.getElementById('ss-modal').style.display = 'none';
  ssCurrentOrder = null;
  ssNewFiles = {};
}

function ssBuildSection(type, label, existingUrl, locked) {
  const existingHtml = existingUrl ? `
    <div class="ss-existing-wrap">
      <img src="${existingUrl}" class="ss-thumb" onclick="window.open('${existingUrl}','_blank')" title="Klik untuk buka">
      <span class="ss-badge-done">✅ Sudah ada — klik gambar untuk buka</span>
    </div>` : '';

  // Upload SS ditutup permanen begitu masuk jam 8 WIB (gak kebuka lagi jam 9 kayak lock input
  // order) — CS diarahkan kirim manual ke validator, bukan notif WA otomatis dari sistem.
  const uploadControls = locked
    ? `<div class="ss-locked-notice">🔒 Upload bukti sudah ditutup (lewat jam 8 pagi). Kirim bukti ke validator ya.</div>`
    : `<div id="ss-new-preview-${type}" class="ss-existing-wrap" style="display:none">
      <img id="ss-new-img-${type}" class="ss-thumb">
      <span class="ss-badge-new">📎 Siap diupload</span>
    </div>
    <label class="ss-pick-btn" for="ss-file-${type}">
      ${existingUrl ? '🔄 Ganti SS' : '📎 Pilih Gambar'}
    </label>
    <input type="file" id="ss-file-${type}" accept="image/*" style="display:none" onchange="ssOnFileChange('${type}',this)">`;

  return `
  <div class="ss-section">
    <div class="ss-section-label">${label}</div>
    ${existingHtml}
    ${uploadControls}
  </div>`;
}

async function ssOnFileChange(type, input) {
  if (!input.files[0]) return;
  const compressed = await ssCompress(input.files[0]);
  ssNewFiles[type] = compressed;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById(`ss-new-img-${type}`).src = e.target.result;
    document.getElementById(`ss-new-preview-${type}`).style.display = 'flex';
  };
  reader.readAsDataURL(compressed);
}

// Beberapa browser/device (mode privasi anti-fingerprint, bug WebView tertentu) diam-diam
// ngasilin canvas kosong/hitam pas drawImage — gak ada error yang kelempar, hasilnya cuma
// blob JPEG hitam solid. Fungsi ini sample beberapa titik pixel buat deteksi itu.
function ssCanvasLooksBlank(ctx, width, height) {
  const cols = 5, rows = 5;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = Math.min(width - 1, Math.round((i + 0.5) * width / cols));
      const y = Math.min(height - 1, Math.round((j + 0.5) * height / rows));
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      if (r !== 0 || g !== 0 || b !== 0) return false;
    }
  }
  return true;
}

async function ssCompress(file, maxPx = 1200, quality = 0.75) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (!width || !height) { resolve(file); return; }
      if (width > maxPx || height > maxPx) {
        const r = Math.min(maxPx / width, maxPx / height);
        width = Math.round(width * r); height = Math.round(height * r);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      let blank = false;
      try { blank = ssCanvasLooksBlank(ctx, width, height); } catch (e) { /* getImageData gagal, anggap aman */ }
      if (blank) { resolve(file); return; }
      canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function ssSave() {
  if (!ssCurrentOrder) return;
  const btn = document.getElementById('ss-save-btn');
  btn.disabled = true; btn.textContent = '⏳ Menyimpan...';
  try {
    const existing = Array.isArray(ssCurrentOrder.ss_urls) ? [...ssCurrentOrder.ss_urls] : [];
    const newUrls  = [...existing];

    for (const [type, blob] of Object.entries(ssNewFiles)) {
      if (!blob) continue;
      const path = `${ssCurrentOrder.id}/${type}_${Date.now()}.jpg`;
      const { error: upErr } = await sbSS.storage.from(SS_BUCKET).upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = sbSS.storage.from(SS_BUCKET).getPublicUrl(path);
      const idx = newUrls.findIndex(s => s.type === type);
      if (idx >= 0) newUrls[idx] = { type, url: publicUrl };
      else newUrls.push({ type, url: publicUrl });
    }

    const { error } = await sb.from('orderan_masuk_crm').update({ ss_urls: newUrls }).eq('id', ssCurrentOrder.id);
    if (error) throw error;

    // Update local state supaya tombol langsung berubah tanpa reload
    const idx = todayOrders.findIndex(o => o.id === ssCurrentOrder.id);
    if (idx >= 0) todayOrders[idx].ss_urls = newUrls;

    closeSSModal();
    renderDashTable(todayOrders);
    renderOrderCards(todayOrders);
    showToast('Bukti SS berhasil disimpan!', 'success');
  } catch (e) {
    showToast('Gagal simpan: ' + (e.message || e), 'error');
  } finally {
    btn.disabled = false; btn.textContent = '💾 Simpan';
  }
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  if (!currentUser) return;
  try {
    const { data, error } = await sb.from('orderan_masuk_crm')
      .select('*')
      .eq('cs_id', currentUser.id)
      .gte('tanggal', filterDateStart)
      .lte('tanggal', filterDateEnd)
      .order('created_at', { ascending: false });

    if (error) throw error;
    todayOrders = data || [];

    const total  = todayOrders.length;
    const tunggu = todayOrders.filter(r => !r.acc_spv).length;
    const kirim  = todayOrders.filter(r => r.acc_spv === 'KIRIM').length;
    const hold   = todayOrders.filter(r => r.acc_spv === 'HOLD').length;
    const cancel = todayOrders.filter(r => r.acc_spv === 'CANCEL').length;

    // Label sub sesuai range
    const isSingleDay = filterDateStart === filterDateEnd;
    const subLabel = isSingleDay
      ? drpFmt(drpSelStart)
      : `${drpFmt(drpSelStart)} — ${drpFmt(drpSelEnd)}`;
    document.getElementById('dash-sub').textContent = `Orderan ${subLabel}`;
    document.getElementById('dash-info').textContent = `${total} orderan`;
    document.getElementById('dash-info-mobile').textContent = `${total} orderan`;

    document.getElementById('d-total').textContent  = total;
    document.getElementById('d-tunggu').textContent = tunggu;
    document.getElementById('d-kirim').textContent  = kirim;
    document.getElementById('d-hold').textContent   = hold;
    document.getElementById('d-cancel').textContent = cancel;

    renderDashTable(todayOrders);
    renderOrderCards(todayOrders);
    loadDashboardAlerts(todayOrders);
  } catch(e) {
    showToast('Gagal load dashboard: ' + e.message, 'error');
  }
}

// Banner "N order Bermasalah/Retur" — dipisah dari loadDashboard() supaya gagal cek tracking
// gak ikut nge-block render tabel/summary utama
async function loadDashboardAlerts(masukList) {
  const wrap = document.getElementById('dash-alerts');
  if (!wrap) return;
  try {
    const rows = await trFetchTrackingRows(masukList, { start: filterDateStart, end: filterDateEnd });
    const problem = rows.filter(r => ['BERMASALAH','RETUR'].includes(trEffectiveStage(r)));
    if (!problem.length) { wrap.innerHTML = ''; return; }

    const bermasalah = problem.filter(r => trEffectiveStage(r) === 'BERMASALAH').length;
    const retur       = problem.filter(r => trEffectiveStage(r) === 'RETUR').length;
    const parts = [];
    if (bermasalah) parts.push(`${bermasalah} Bermasalah`);
    if (retur)      parts.push(`${retur} Retur`);

    wrap.innerHTML = `<div class="trk-alert trk-alert-warn" style="cursor:pointer" onclick="switchPage('tracking')">
      ⚠️ <strong>${problem.length} order</strong> butuh perhatian (${parts.join(' · ')}) — klik buat lihat di Tracking Order
    </div>`;
  } catch (e) {
    // Gagal cek tracking gak ganggu Dashboard utama, diam aja
    wrap.innerHTML = '';
  }
}

function renderDashTable(orders) {
  const tbody = document.getElementById('dash-tbody');
  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-state">Belum ada orderan hari ini. Yuk mulai input!</td></tr>';
    return;
  }
  tbody.innerHTML = orders.map((r, i) => {
    const rowClass = r.acc_spv === 'KIRIM' ? 'row-kirim'
      : r.acc_spv === 'HOLD'   ? 'row-hold'
      : r.acc_spv === 'CANCEL' ? 'row-cancel'
      : r.is_dup_today         ? 'row-dup'
      : r.is_rts               ? 'row-rts' : '';

    const valBadge   = buildValBadges(r);
    const gradeBadge = buildGradeBadge(r);

    const accBadge = !r.acc_spv
      ? '<span class="badge badge-pending">Menunggu</span>'
      : r.acc_spv === 'KIRIM'  ? '<span class="badge badge-kirim">KIRIM</span>'
      : r.acc_spv === 'HOLD'   ? '<span class="badge badge-hold">HOLD</span>'
      : r.acc_spv === 'CANCEL' ? '<span class="badge badge-cancel">CANCEL</span>'
      : r.acc_spv;

    const waktu = new Date(r.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    const ssBtn  = buildSSBtn(r);

    return `<tr class="${rowClass}">
      <td style="font-family:var(--mono);color:var(--muted)">${i+1}</td>
      <td style="font-family:var(--mono)">${waktu}</td>
      <td title="${r.nama||''}">${r.nama||'—'}</td>
      <td style="font-family:var(--mono)">${r.hp||'—'}</td>
      <td>${r.jumlah_pesanan||'—'}</td>
      <td>${r.pembayaran||'—'}</td>
      <td style="font-family:var(--mono)">Rp${Number(r.total_pembayaran||0).toLocaleString('id-ID')}</td>
      <td class="td-validasi">${valBadge}</td>
      <td>${gradeBadge}</td>
      <td>${accBadge}</td>
      <td style="color:var(--muted);font-size:11px" title="${r.noted||''}">${r.noted||'—'}</td>
      <td>${ssBtn}</td>
    </tr>`;
  }).join('');
}

// ── MOBILE: RENDER ORDER CARDS ───────────────────────────────────────────────
function renderOrderCards(orders) {
  const wrap = document.getElementById('order-cards');
  if (!orders.length) {
    wrap.innerHTML = '<div style="text-align:center;padding:2.5rem;color:var(--muted);font-size:13px">Belum ada orderan hari ini.<br>Yuk mulai input! 💪</div>';
    return;
  }
  wrap.innerHTML = orders.map((r, i) => {
    const cardClass = r.acc_spv === 'KIRIM'  ? 'oc-kirim'
      : r.acc_spv === 'HOLD'   ? 'oc-hold'
      : r.acc_spv === 'CANCEL' ? 'oc-cancel'
      : r.is_dup_today         ? 'oc-dup'
      : r.is_rts               ? 'oc-rts' : '';

    const valBadge   = buildValBadges(r);
    const gradeBadge = buildGradeBadge(r);

    const accBadge = !r.acc_spv
      ? '<span class="badge badge-pending">Menunggu SPV</span>'
      : r.acc_spv === 'KIRIM'  ? '<span class="badge badge-kirim">✓ KIRIM</span>'
      : r.acc_spv === 'HOLD'   ? '<span class="badge badge-hold">⏸ HOLD</span>'
      : r.acc_spv === 'CANCEL' ? '<span class="badge badge-cancel">✕ CANCEL</span>'
      : r.acc_spv;

    const waktu = new Date(r.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    const total = r.total_pembayaran ? 'Rp'+Number(r.total_pembayaran).toLocaleString('id-ID') : '—';
    const ssBtn = buildSSBtn(r);

    return `<div class="order-card ${cardClass}">
      <div class="oc-header">
        <span class="oc-nama">${i+1}. ${r.nama||'—'}</span>
        <span class="oc-waktu">${waktu}</span>
      </div>
      <div class="oc-row">
        <span class="oc-hp">📱 ${r.hp||'—'}</span>
        <span style="color:var(--border-strong)">·</span>
        <span class="oc-jumlah">${r.jumlah_pesanan||'—'}</span>
      </div>
      <div class="oc-row" style="margin-top:2px">
        <span class="oc-total">${total}</span>
        <span style="color:var(--muted);font-size:12px">${r.pembayaran||''}</span>
      </div>
      <div class="oc-footer">
        <span class="oc-noted">${r.noted ? '📝 '+r.noted : ''}</span>
        <div style="display:flex;gap:4px;flex-shrink:0;align-items:center;flex-wrap:wrap">
          ${valBadge}
          ${gradeBadge}
          ${accBadge}
          ${ssBtn}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── UPLOAD ORDER ──────────────────────────────────────────────────────────────

// Regex parser — coba dulu sebelum hit API
function parseOrderRegex(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  const result = {
    no: '', nama: '', hp: '', alamat: '',
    kelurahan: '', kecamatan: '', kabupaten: '', provinsi: '', kodepos: '',
    jumlah_pesanan: '', quantity: '', pembayaran: '', total_pembayaran: '',
    instruksi_pengiriman: '', keterangan: '', rincian_pembayaran: '', keluhan: ''
  };

  // no: baris pertama
  result.no = lines[0] || '';

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    if (/^Nama\s*:/i.test(l)) {
      // JANGAN dipotong di tanda "|" -- bagian setelah "|" itu kode SKU (format "BUDI|YOU1")
      // yang dibaca parseSKUFromNama()/validateSKU() buat validasi produk vs jumlah_pesanan.
      result.nama = l.replace(/^Nama\s*:\s*/i, '').trim();

    } else if (/^No\.?\s*HP\s*:/i.test(l)) {
      const rawHp = l.replace(/^No\.?\s*HP\s*:\s*/i, '').trim();
      // Ambil hanya nomor HP di awal — abaikan teks alamat yang kadang tercampur di baris sama
      const hpMatch = rawHp.match(/(\+?62|0)[0-9]{7,13}/);
      result.hp = hpMatch ? hpMatch[0] : rawHp;

    } else if (/^Alamat\s*:/i.test(l)) {
      const val   = l.replace(/^Alamat\s*:\s*/i, '').trim();
      const parts = val.split('|');
      result.alamat = parts[0].trim();
      if (parts[1]) result.instruksi_pengiriman = parts[1].trim();
      if (parts.length > 2) result.rincian_pembayaran = parts.slice(2).join('|');

    } else if (/^Jumlah\s*pesanan\s*:/i.test(l)) {
      result.jumlah_pesanan = l.replace(/^Jumlah\s*pesanan\s*:\s*/i, '').trim();
      const qm = result.jumlah_pesanan.match(/^(\d+)/);
      if (qm) result.quantity = qm[1];

    } else if (/^Pembayaran\s*:/i.test(l)) {
      result.pembayaran = l.replace(/^Pembayaran\s*:\s*/i, '').trim();

    } else if (/^Total\s*pembayaran\s*:/i.test(l)) {
      let val = l.replace(/^Total\s*pembayaran\s*:\s*/i, '').trim();
      // Kalau kosong, nilai ada di baris berikutnya (contoh: "99000+9000+5000=113000")
      if (!val && lines[i + 1]) val = lines[i + 1];
      const eqMatch = val.match(/=\s*(\d+)/);
      result.total_pembayaran = eqMatch ? eqMatch[1] : val.replace(/\D/g, '');

    } else if (/^KELUHAN\s*:/i.test(l)) {
      result.keluhan = l.replace(/^KELUHAN\s*:\s*/i, '').trim();
    }
  }

  // Wilayah: cari kodepos (5 digit), 4 baris sebelumnya = kelurahan/kec/kab/prov
  const kpIdx = lines.findIndex(l => /^\d{5}$/.test(l));
  if (kpIdx >= 4) {
    result.kodepos   = lines[kpIdx];
    result.provinsi  = lines[kpIdx - 1];
    result.kabupaten = lines[kpIdx - 2];
    result.kecamatan = lines[kpIdx - 3];
    result.kelurahan = lines[kpIdx - 4];
  }

  // Keterangan: baris antara total_pembayaran dan KELUHAN, bukan baris angka/kalkulasi.
  // Filter lama `!/[+=]/.test(l)` kebablasan — baris keterangan order kombo juga sering ada
  // tanda "+" (contoh: "NEW SALEB OIRI 1 + MAKSIR 1 CS AMBAR"), jadi ikut kebuang kayak baris
  // kalkulasi "167000+47000+5000=219000". Sekarang cuma buang baris yang MURNI angka/operator
  // (gak ada huruf sama sekali), baris keterangan yang ada teksnya tetep lolos walau ada "+".
  const totalIdx   = lines.findIndex(l => /^Total\s*pembayaran\s*:/i.test(l));
  const keluhanIdx = lines.findIndex(l => /^KELUHAN\s*:/i.test(l));
  if (totalIdx >= 0 && keluhanIdx > totalIdx) {
    const between = lines.slice(totalIdx + 1, keluhanIdx)
      .filter(l => !/^[\d\s+\-=]+$/.test(l) && l.length > 2);
    result.keterangan = between.join('\n').trim();
  }

  return result;
}

// Cek apakah hasil regex cukup lengkap untuk dipakai
function isRegexResultValid(d) {
  return !!(d.nama && d.hp && d.alamat && d.kodepos && d.jumlah_pesanan);
}

async function doParse() {
  const text = document.getElementById('paste-input').value.trim();
  if (!text) { showToast('Paste teks orderan dulu ya.', 'warn'); return; }

  const btn     = document.getElementById('btn-parse');
  const loading = document.getElementById('loading-parse');
  btn.disabled  = true;
  loading.classList.add('show');
  hideValBanner();

  try {
    ongkirMismatch = null; // reset sebelum parse baru
    // Coba regex dulu — instant, tanpa API call
    const regexResult = parseOrderRegex(text);

    if (isRegexResultValid(regexResult)) {
      parsedData = regexResult;
    } else {
      // Fallback ke OpenAI API kalau regex kurang lengkap
      const res  = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Parse gagal');
      parsedData = json.data;

      // Regex lebih deterministik buat field yang polanya baku (nama, alamat, instruksi,
      // rincian, keterangan, dll) -- AI kadang salah baca baris yang digabung tanda "|", atau
      // kebablasan nganggep baris mirip itu duplikat terus dikosongin (obs: keterangan kadang
      // ke-skip walau prompt udah eksplisit larang). Field APAPUN yang regex berhasil dapetin
      // (non-empty) menang dipakai, AI cuma ngisi field yang regex-nya bener-bener kosong --
      // walau regexResult SECARA KESELURUHAN gak valid dipakai penuh (isRegexResultValid gagal
      // karena ada field lain yang emang butuh AI buat nebak).
      Object.keys(regexResult).forEach(key => {
        if (regexResult[key]) parsedData[key] = regexResult[key];
      });
    }

    fillPreviewForm(parsedData);
    document.getElementById('preview-card').classList.add('show');
    document.getElementById('btn-submit').disabled = false;
    showToast('Parsing berhasil! Periksa hasilnya.', 'success');
    validateWilayah();
    validateEkspedisi();
    validateRincian();
    validateSKU();
    validateReceiverScore();
    validateOngkirTarif();

    document.getElementById('preview-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch(e) {
    showToast('Gagal parse: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    loading.classList.remove('show');
  }
}

function fillPreviewForm(d) {
  const fields = ['no','nama','hp','pembayaran','alamat','kelurahan','kecamatan',
    'kabupaten','provinsi','kodepos','jumlah','quantity','total','instruksi','rincian','keterangan','keluhan'];
  const keys   = ['no','nama','hp','pembayaran','alamat','kelurahan','kecamatan',
    'kabupaten','provinsi','kodepos','jumlah_pesanan','quantity','total_pembayaran',
    'instruksi_pengiriman','rincian_pembayaran','keterangan','keluhan'];
  fields.forEach((f, i) => {
    const el = document.getElementById('f-'+f);
    if (!el) return;
    let v = d[keys[i]] || '';
    if (f === 'hp') v = v.replace(/[^\d+]/g, ''); // HP: angka saja, buang teks apapun
    el.value = v;
  });
}

// ── VALIDASI WILAYAH ──────────────────────────────────────────────────────────
function valSetField(id, state, msg) {
  const el   = document.getElementById('f-' + id);
  const hint = document.getElementById('hint-' + id);
  if (!el || !hint) return;
  el.classList.remove('val-ok', 'val-err', 'val-warn');
  hint.className = 'val-hint';
  hint.innerHTML = '';
  if (state === 'ok')   { el.classList.add('val-ok');   hint.classList.add('ok');   hint.textContent = msg || ''; }
  if (state === 'err')  { el.classList.add('val-err');  hint.classList.add('err');  hint.textContent = msg || '⚠ Tidak ditemukan di data wilayah'; }
  if (state === 'warn') { el.classList.add('val-warn'); hint.classList.add('warn'); hint.innerHTML   = msg || ''; }
}

function valClearAll() {
  ['kelurahan','kecamatan','kabupaten','provinsi','kodepos'].forEach(id => {
    const el   = document.getElementById('f-' + id);
    const hint = document.getElementById('hint-' + id);
    if (el)   el.classList.remove('val-ok','val-err','val-warn');
    if (hint) { hint.className = 'val-hint'; hint.innerHTML = ''; }
  });
}

async function validateWilayah() {
  const kel  = (document.getElementById('f-kelurahan')?.value || '').trim();
  const kec  = (document.getElementById('f-kecamatan')?.value || '').trim();
  const kab  = (document.getElementById('f-kabupaten')?.value || '').trim();
  const prov = (document.getElementById('f-provinsi')?.value  || '').trim();
  const kpos = (document.getElementById('f-kodepos')?.value   || '').trim();

  if (!kel && !kec && !kab && !prov) return;
  valClearAll();
  hideWilayahLaporBox();

  const norm = s => (s||'').trim().toUpperCase().replace(/^(KABUPATEN|KOTA|KAB\.?)\s*/i, '');

  try {
    // Query Mengantar pakai kombinasi paling spesifik
    const q = [kel, kec, kab].filter(Boolean).join(', ');
    const res = await fetch(`/api/wilayah?q=${encodeURIComponent(q)}`);
    const js  = await res.json();
    const list = js.data || [];

    if (!list.length) {
      // Tidak ketemu sama sekali di data Mengantar -- cek dulu apa udah pernah
      // di-approve manual sebagai wilayah baru/pemekaran sebelum nge-flag merah.
      const override = kel && kec && kab ? await checkWilayahOverride(kel, kec, kab) : null;
      if (override) {
        valSetField('kelurahan', 'ok', '✓ Wilayah baru (disetujui admin)');
        valSetField('kecamatan', 'ok', '✓ Wilayah baru (disetujui admin)');
        valSetField('kabupaten', 'ok', '✓ Wilayah baru (disetujui admin)');
        valSetField('provinsi',  'ok', '✓ Wilayah baru (disetujui admin)');
        return;
      }
      valSetField('kelurahan', 'err');
      valSetField('kecamatan', 'err');
      valSetField('kabupaten', 'err');
      valSetField('provinsi',  'err');
      if (kel && kec && kab) showWilayahLaporBox(kel, kec, kab, prov, kpos);
      return;
    }

    // Score tiap result vs input (sama seperti BotWA scoring)
    // SUBDISTRICT_NAME = kelurahan, DISTRICT_NAME = kecamatan
    const scored = list.map(a => {
      const aKel  = norm(a.SUBDISTRICT_NAME || '');
      const aKec  = norm(a.DISTRICT_NAME    || '');
      const aKab  = norm(a.CITY_NAME        || '');
      const aProv = norm(a.PROVINCE_NAME    || '');
      let s = 0;
      if (kel && aKel.includes(norm(kel)))    s += 4;
      if (kec && aKec.includes(norm(kec)))    s += 3;
      if (kab && aKab.includes(norm(kab)))    s += 2;
      if (prov && aProv.includes(norm(prov))) s += 1;
      return { ...a, _score: s };
    }).sort((a, b) => b._score - a._score);

    const best = scored[0];
    const aKel  = norm(best.SUBDISTRICT_NAME || '');
    const aKec  = norm(best.DISTRICT_NAME    || '');
    const aKab  = norm(best.CITY_NAME        || '');
    const aProv = norm(best.PROVINCE_NAME    || '');
    const aKpos = best.ZIP_CODE || best.posCode || '';

    // Validasi tiap field vs best match
    if (kel) {
      if (aKel.includes(norm(kel)) || norm(kel).includes(aKel))
        valSetField('kelurahan', 'ok');
      else
        valSetField('kelurahan', 'err', `⚠ Mungkin: ${best.SUBDISTRICT_NAME}`);
    }
    if (kec) {
      if (aKec.includes(norm(kec)) || norm(kec).includes(aKec))
        valSetField('kecamatan', 'ok');
      else
        valSetField('kecamatan', 'err', `⚠ Mungkin: ${best.DISTRICT_NAME}`);
    }
    if (kab) {
      if (aKab.includes(norm(kab)) || norm(kab).includes(aKab))
        valSetField('kabupaten', 'ok');
      else
        valSetField('kabupaten', 'err', `⚠ Mungkin: ${best.CITY_NAME}`);
    }
    if (prov) {
      if (aProv.includes(norm(prov)) || norm(prov).includes(aProv))
        valSetField('provinsi', 'ok');
      else
        valSetField('provinsi', 'err', `⚠ Mungkin: ${best.PROVINCE_NAME}`);
    }

    // Kodepos
    if (aKpos) {
      if (kpos === aKpos) {
        valSetField('kodepos', 'ok');
      } else {
        valSetField('kodepos', 'warn',
          `Rekomendasi: <strong>${aKpos}</strong>` +
          `<button class="hint-apply" onclick="applyKodepos('${aKpos}')">Pakai ini</button>`
        );
      }
    }

  } catch(_) { /* gagal → skip validasi */ }
}

// ── WILAYAH BARU/PEMEKARAN: override manual (approved admin) ─────────────────
// Data Mengantar kadang belum kedetect wilayah pemekaran baru -- daripada
// nge-block order valid selamanya, CS bisa lapor sekali, admin approve sekali,
// abis itu kombo alamat yang sama otomatis lolos buat semua order berikutnya.
async function checkWilayahOverride(kel, kec, kab) {
  try {
    const { data } = await sb.from('wilayah_override')
      .select('id')
      .eq('status', 'approved')
      .ilike('kelurahan', kel)
      .ilike('kecamatan', kec)
      .ilike('kabupaten', kab)
      .limit(1);
    return data && data[0];
  } catch (e) { return null; }
}

function hideWilayahLaporBox() {
  const box = document.getElementById('wilayah-lapor-box');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

async function showWilayahLaporBox(kel, kec, kab, prov, kpos) {
  const box = document.getElementById('wilayah-lapor-box');
  if (!box) return;
  box.style.display = 'block';
  box.innerHTML = '<span style="font-size:12px;color:var(--muted)">Mengecek status laporan wilayah...</span>';

  try {
    const { data } = await sb.from('wilayah_override')
      .select('status, reported_at, catatan')
      .ilike('kelurahan', kel)
      .ilike('kecamatan', kec)
      .ilike('kabupaten', kab)
      .order('reported_at', { ascending: false })
      .limit(1);
    const existing = data && data[0];

    if (existing?.status === 'pending') {
      box.innerHTML = `<span style="font-size:12px;color:var(--warn)">⏳ Wilayah ini udah dilaporkan, menunggu approval admin (${new Date(existing.reported_at).toLocaleDateString('id-ID')}). Order gak bisa disubmit dulu sampai disetujui.</span>`;
    } else if (existing?.status === 'rejected') {
      box.innerHTML = `<span style="font-size:12px;color:var(--danger)">✗ Ditolak admin${existing.catatan ? ': ' + existing.catatan : ''}. Cek ulang alamatnya sama customer.</span>`;
    } else {
      box.innerHTML = '<button type="button" class="btn-secondary" style="font-size:12px;padding:6px 12px" onclick="laporWilayahBaru()">🚩 Lapor Wilayah Baru (pemekaran/belum terdaftar)</button>';
    }
  } catch (e) {
    box.innerHTML = '<button type="button" class="btn-secondary" style="font-size:12px;padding:6px 12px" onclick="laporWilayahBaru()">🚩 Lapor Wilayah Baru (pemekaran/belum terdaftar)</button>';
  }
}

async function laporWilayahBaru() {
  const kel  = val('f-kelurahan');
  const kec  = val('f-kecamatan');
  const kab  = val('f-kabupaten');
  const prov = val('f-provinsi');
  const kpos = val('f-kodepos');
  const box  = document.getElementById('wilayah-lapor-box');
  if (!kel || !kec || !kab) return;

  try {
    const { error } = await sb.from('wilayah_override').insert({
      kelurahan: kel, kecamatan: kec, kabupaten: kab, provinsi: prov, kodepos: kpos,
      status: 'pending',
      reported_by: currentProfile?.nama || currentUser?.email || null,
    });
    if (error) throw error;
    box.innerHTML = '<span style="font-size:12px;color:var(--warn)">⏳ Dilaporkan! Order bisa disubmit setelah admin approve.</span>';
    showToast('Wilayah baru dilaporkan ke admin.', 'success');
  } catch (e) {
    showToast('Gagal lapor: ' + e.message, 'error');
  }
}

function confirmSubmitCancel() {
  document.getElementById('confirm-overlay').style.display = 'none';
}

function applyKodepos(val) {
  const el = document.getElementById('f-kodepos');
  if (el) { el.value = val; valSetField('kodepos', 'ok'); }
}

// ── VALIDASI SKU ──────────────────────────────────────────────────────────────
let skuCache = null; // cache biar tidak fetch tiap kali

async function getSkuList() {
  if (skuCache) return skuCache;
  try {
    const { data } = await sb.from('sku_produk').select('kode,nama_produk');
    skuCache = data || [];
  } catch(_) { skuCache = []; }
  return skuCache;
}

function parseSKUFromNama(nama) {
  // Format: "BUDI|YOU1" atau "BUDI|YOU 1" → { kode: 'YOU', qty: 1 }
  if (!nama || !nama.includes('|')) return null;
  const skuRaw = nama.split('|')[1]?.trim().toUpperCase() || '';
  if (!skuRaw) return null;
  const match = skuRaw.match(/^([A-Z]+)\s*(\d*)$/);
  if (!match) return null;
  return { kode: match[1], qty: parseInt(match[2] || '1', 10) || 1, raw: skuRaw };
}

async function validateSKU() {
  const namaVal = (document.getElementById('f-nama')?.value    || '').trim();
  const jumlahVal= (document.getElementById('f-jumlah')?.value || '').trim();
  const ketVal  = (document.getElementById('f-keterangan')?.value || '').trim();

  // Reset hints
  ['nama','jumlah','keterangan'].forEach(id => {
    const el   = document.getElementById('f-' + id);
    const hint = document.getElementById('hint-' + id);
    if (el)   el.classList.remove('val-ok','val-err','val-warn');
    if (hint) { hint.className = 'val-hint'; hint.innerHTML = ''; }
  });

  const parsed = parseSKUFromNama(namaVal);
  if (!parsed) return; // tidak ada SKU di nama → skip

  const skuList   = await getSkuList();
  const skuRecord = skuList.find(s => s.kode.toUpperCase() === parsed.kode);

  if (!skuRecord) {
    valSetField('nama', 'err', `⚠ SKU "${parsed.kode}" tidak dikenali`);
    return;
  }

  valSetField('nama', 'ok', `✓ ${skuRecord.nama_produk} × ${parsed.qty}`);

  const produkNorm = skuRecord.nama_produk.toUpperCase();
  const keywords   = produkNorm.split(/\s+/).filter(w => w.length >= 3);

  // ── Cek qty SKU vs field QTY ──────────────────────────────────────────────
  const qtyField = parseInt((document.getElementById('f-quantity')?.value || '').trim(), 10);
  if (qtyField && qtyField !== parsed.qty) {
    valSetField('nama', 'warn',
      `⚠ SKU qty ${parsed.qty} tapi QTY field ${qtyField} — pastikan yang benar`
    );
  }

  // ── Cek jumlah pesanan ────────────────────────────────────────────────────
  if (jumlahVal) {
    const jumlahUp  = jumlahVal.toUpperCase();
    const prodMatch = keywords.some(w => jumlahUp.includes(w));

    // Cek angka qty di awal jumlah pesanan
    const qtyJumlah = parseInt(jumlahVal.match(/^\d+/)?.[0] || '0', 10);
    const qtyOk     = !qtyJumlah || qtyJumlah === parsed.qty;

    if (prodMatch && qtyOk) {
      valSetField('jumlah', 'ok');
    } else if (!prodMatch) {
      valSetField('jumlah', 'err', `⚠ Produk "${skuRecord.nama_produk}" tidak ditemukan`);
    } else {
      valSetField('jumlah', 'warn', `⚠ Qty di jumlah pesanan (${qtyJumlah}) tidak cocok dengan SKU (${parsed.qty})`);
    }
  }

  // ── Cek keterangan ────────────────────────────────────────────────────────
  if (ketVal) {
    const ketUp     = ketVal.toUpperCase();
    const prodMatch = keywords.some(w => ketUp.includes(w));

    if (!prodMatch) {
      valSetField('keterangan', 'err', `⚠ Produk "${skuRecord.nama_produk}" tidak ditemukan di keterangan`);
    } else {
      // Cari angka setelah keyword produk — format: "YOUZHI 1 CS LATHIFAH"
      // Ambil angka yang muncul setelah salah satu keyword
      let qtyKet = null;
      for (const kw of keywords) {
        const idx = ketUp.indexOf(kw);
        if (idx === -1) continue;
        const after = ketUp.slice(idx + kw.length).trim();
        const m = after.match(/^[\s\w]*?(\d+)/);
        if (m) { qtyKet = parseInt(m[1], 10); break; }
      }

      if (qtyKet !== null && qtyKet !== parsed.qty) {
        valSetField('keterangan', 'warn', `⚠ Qty di keterangan (${qtyKet}) tidak cocok dengan SKU (${parsed.qty})`);
      } else {
        valSetField('keterangan', 'ok');
      }
    }
  }
}

// ── VALIDASI EKSPEDISI (No Order vs Pembayaran) ───────────────────────────────
const EKSPEDISI_LIST = [
  { key: 'JNE',      pattern: /\bJNE\b/i },
  { key: 'JNT',      pattern: /\bJNT\b|\bJ[&\+]?T\b|JALUR\s*NUGRAHA/i },
  { key: 'SICEPAT',  pattern: /\bSICEPAT\b|\bSICE\b/i },
  { key: 'ANTERAJA', pattern: /\bANTERAJA\b|\bANTER\b/i },
  { key: 'NINJA',    pattern: /\bNINJA\b/i },
  { key: 'SAP',      pattern: /\bSAP\b/i },
  { key: 'LION',     pattern: /\bLION\b/i },
  { key: 'TIKI',     pattern: /\bTIKI\b/i },
  { key: 'POS',      pattern: /\bPOS\s*INDONESIA\b|\bPOS\b/i },
  { key: 'REX',      pattern: /\bREX\b/i },
  { key: 'IDEXPRESS',pattern: /\bID\s*EXPRESS\b|\bIDEX\b/i },
  { key: 'GRAB',     pattern: /\bGRAB\b/i },
  { key: 'GOJEK',    pattern: /\bGOJEK\b|\bGOSEND\b/i },
];

function extractEkspedisi(text) {
  if (!text) return null;
  for (const e of EKSPEDISI_LIST) {
    if (e.pattern.test(text)) return e.key;
  }
  return null;
}

function validateEkspedisi() {
  const noVal  = document.getElementById('f-no')?.value || '';
  const bayVal = document.getElementById('f-pembayaran')?.value || '';

  // Reset hint no & pembayaran dulu
  ['no','pembayaran'].forEach(id => {
    const el   = document.getElementById('f-' + id);
    const hint = document.getElementById('hint-' + id);
    if (el)   el.classList.remove('val-ok','val-err','val-warn');
    if (hint) { hint.className = 'val-hint'; hint.innerHTML = ''; }
  });

  const ekspNo  = extractEkspedisi(noVal);
  const ekspBay = extractEkspedisi(bayVal);

  // Kalau salah satu tidak ada ekspedisi → skip
  if (!ekspNo || !ekspBay) return;

  if (ekspNo === ekspBay) {
    valSetField('no',         'ok', `✓ ${ekspNo}`);
    valSetField('pembayaran', 'ok', `✓ ${ekspBay}`);
  } else {
    valSetField('no',         'err', `⚠ Ekspedisi: ${ekspNo} — tidak cocok dengan Pembayaran (${ekspBay})`);
    valSetField('pembayaran', 'err', `⚠ Ekspedisi: ${ekspBay} — tidak cocok dengan No Order (${ekspNo})`);
  }
}

// ── VALIDASI RINCIAN vs TOTAL ─────────────────────────────────────────────────
function validateRincian() {
  const rincianVal = (document.getElementById('f-rincian')?.value || '').trim();
  const totalVal   = (document.getElementById('f-total')?.value   || '').trim();

  ['rincian','total'].forEach(id => {
    const el   = document.getElementById('f-' + id);
    const hint = document.getElementById('hint-' + id);
    if (el)   el.classList.remove('val-ok','val-err','val-warn');
    if (hint) { hint.className = 'val-hint'; hint.innerHTML = ''; }
  });

  if (!rincianVal || !totalVal) return;

  const parts = rincianVal.split('|').map(s => parseInt(s.trim(), 10));
  if (![5, 6].includes(parts.length) || parts.some(isNaN)) {
    valSetField('rincian', 'err', '⚠ Format harus: ongkir|pot.ongkir|admin|pot.admin|harga atau ongkir|pot.ongkir|admin|pot.admin|harga|pot.produk');
    return;
  }

  const [ongkir, potOngkir, admin, potAdmin, harga, potProduk = 0] = parts;
  const totalHitung = harga - potProduk + ongkir - potOngkir + admin - potAdmin;
  const totalInput  = parseInt(totalVal.replace(/\D/g, ''), 10);

  const fmt = n => n.toLocaleString('id-ID');
  const potProdukStr = potProduk ? ` - ${fmt(potProduk)} pot.produk` : '';

  if (totalHitung === totalInput) {
    valSetField('rincian', 'ok', `✓ ${fmt(harga)}${potProdukStr} + ${fmt(ongkir-potOngkir)} ongkir + ${fmt(admin-potAdmin)} admin = ${fmt(totalHitung)}`);
    valSetField('total',   'ok');
  } else {
    valSetField('rincian', 'err',
      `⚠ Hasil hitung: ${fmt(totalHitung)} (harga ${fmt(harga)}${potProdukStr} + ongkir ${fmt(ongkir-potOngkir)} + admin ${fmt(admin-potAdmin)})`
    );
    valSetField('total', 'err', `⚠ Tidak cocok dengan rincian. Seharusnya: ${fmt(totalHitung)}`);
  }
}

// ── CEK ONGKIR: bandingkan ongkir di rincian vs estimasi Mengantar ──────────────
// Kalau beda > 10% → masuk ongkirMismatch → muncul di popup konfirmasi submit.
// CS masih bisa tetap submit (soft block via popup), tapi admin akan lihat warning-nya.
let ongkirMismatch = null; // null=belum dicek/api error, false=sesuai, string=pesan mismatch

async function validateOngkirTarif() {
  ongkirMismatch = null;
  const hint = document.getElementById('hint-ongkir-check');
  if (!hint) return;
  hint.className = 'val-hint';
  hint.textContent = '';

  const kel     = val('f-kelurahan');
  const kec     = val('f-kecamatan');
  const kab     = val('f-kabupaten');
  const eksp = extractEkspedisi(val('f-no'));
  const rincianVal = val('f-rincian');
  if (!kec || !kab || !eksp || !rincianVal) return;

  const parts = rincianVal.split('|').map(s => parseInt(s.trim(), 10));
  if (parts.length !== 5 || parts.some(isNaN)) return;
  const [ongkir] = parts; // ongkir KOTOR -- pot.ongkir itu diskon promo CS ke customer,
  if (!ongkir) return;    // bukan bagian tarif asli, jadi gak ikut dibandingin ke estimasi

  // Gabungan kelurahan+kecamatan+kabupaten paling presisi (1 kodepos bisa nyakup
  // beberapa kelurahan beda tarif) -- fallback ke kec+kab kalau kelurahan kosong
  const keyword = (kel ? kel + ' ' : '') + kec + ' ' + kab;

  let json;
  try {
    const params = new URLSearchParams({ keyword, weight: 1, kelurahan: kel, kecamatan: kec, kabupaten: kab });
    if (selectedGudang?.origin_id) params.set('origin_id', selectedGudang.origin_id);
    const r = await fetch(`/api/ongkir?${params}`);
    json = await r.json();
  } catch (e) { return; }
  if (!json?.ok) return;

  const match = json.couriers.find(c => c.key.toUpperCase() === (eksp || '').toUpperCase());
  if (!match || match.unsupported || !match.price) return;

  const fmt = n => n.toLocaleString('id-ID');
  const diff = match.price - ongkir; // positif = CS input lebih kecil dari estimasi
  const pct  = diff / match.price * 100;

  if (ongkir >= match.price) {
    // CS input lebih besar atau sama — aman, tidak perlu warning
    ongkirMismatch = false;
    hint.classList.add('ok');
    hint.textContent = `✓ Ongkir sesuai estimasi (Rp${fmt(match.price)})`;
  } else if (pct > 15) {
    // CS input lebih kecil >15% dari estimasi — hard block
    const msg = `Ongkir tercatat Rp${fmt(ongkir)}, estimasi ${eksp} ke ${kec}: Rp${fmt(match.price)} (kurang ${pct.toFixed(0)}%)`;
    ongkirMismatch = msg;
    hint.classList.add('err');
    hint.textContent = `⚠ ${msg}`;
  } else if (pct > 5) {
    // CS input lebih kecil 5-15% — soft warning saja
    hint.classList.add('warn');
    hint.textContent = `⚠ Ongkir tercatat Rp${fmt(ongkir)}, estimasi ${eksp} ke ${kec}: Rp${fmt(match.price)} (kurang ${pct.toFixed(0)}%)`;
    ongkirMismatch = false;
  } else {
    ongkirMismatch = false;
    hint.classList.add('ok');
    hint.textContent = `✓ Ongkir sesuai estimasi (Rp${fmt(match.price)})`;
  }
}

let _ongkirCheckTimer = null;
function scheduleOngkirCheck() {
  clearTimeout(_ongkirCheckTimer);
  _ongkirCheckTimer = setTimeout(validateOngkirTarif, 800);
}

// ── CEK ONGKIR: halaman mandiri (tools CS, gak perlu buka web Mengantar) ───────
const ONGKIR_DISPLAY = {
  JNE: 'JNE', JNT: 'J&T', SICEPAT: 'SiCepat', ANTERAJA: 'AnterAja',
  NINJA: 'Ninja', LION: 'Lion', POS: 'POS Indonesia', SAP: 'SAP', IDEXPRESS: 'ID Express',
};

// Autocomplete alamat (mode=search) -- niru UX "Cek Ongkos Kirim" Mengantar
let _ongkirSearchTimer = null;
let ongkirSelectedDest = null; // { id, kecamatan, kabupaten, provinsi, label }

function scheduleOngkirSearch() {
  clearTimeout(_ongkirSearchTimer);
  _ongkirSearchTimer = setTimeout(runOngkirSearch, 300);
}

async function runOngkirSearch() {
  const box = document.getElementById('ongkir-suggest');
  const keyword = document.getElementById('ongkir-search').value.trim();

  // Ketikan berubah dari yang udah dipilih -> batalin pilihan lama
  if (ongkirSelectedDest && ongkirSelectedDest.label !== keyword) ongkirSelectedDest = null;

  if (keyword.length < 3) { box.style.display = 'none'; return; }

  try {
    const r = await fetch(`/api/ongkir?mode=search&keyword=${encodeURIComponent(keyword)}`);
    const json = await r.json();
    if (!json.ok || !json.data.length) {
      box.innerHTML = '<div class="ongkir-suggest-empty">Alamat tidak ditemukan</div>';
      box.style.display = 'block';
      return;
    }
    box.innerHTML = json.data.map((d, i) => `
      <div class="ongkir-suggest-item" data-idx="${i}">${d.label}</div>
    `).join('');
    box.style.display = 'block';
    box.querySelectorAll('.ongkir-suggest-item').forEach((el, i) => {
      el.onclick = () => {
        const d = json.data[i];
        ongkirSelectedDest = d;
        document.getElementById('ongkir-search').value = d.label;
        box.style.display = 'none';
      };
    });
  } catch (e) { box.style.display = 'none'; }
}

document.getElementById('ongkir-search')?.addEventListener('input', scheduleOngkirSearch);
document.addEventListener('click', (e) => {
  const box = document.getElementById('ongkir-suggest');
  const input = document.getElementById('ongkir-search');
  if (box && !box.contains(e.target) && e.target !== input) box.style.display = 'none';
});

async function doCekOngkir() {
  const berat = parseFloat(document.getElementById('ongkir-berat').value) || 1;
  const errEl  = document.getElementById('ongkir-error');
  const resultCard = document.getElementById('ongkir-result-card');
  errEl.style.display = 'none';
  resultCard.style.display = 'none';

  if (!ongkirSelectedDest) {
    errEl.textContent = 'Pilih alamat tujuan dari daftar saran dulu.';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('btn-cek-ongkir');
  const loading = document.getElementById('loading-ongkir');
  btn.disabled = true;
  loading.classList.add('show');

  try {
    const d = ongkirSelectedDest;
    const params = new URLSearchParams({
      destination_id: d.id,
      kecamatan: d.kecamatan,
      kabupaten: d.kabupaten,
      provinsi: d.provinsi,
      weight: berat,
    });
    if (selectedGudang?.origin_id) params.set('origin_id', selectedGudang.origin_id);
    const r = await fetch(`/api/ongkir?${params.toString()}`);
    const json = await r.json();
    if (!json.ok) {
      errEl.textContent = json.reason || 'Gagal ambil estimasi ongkir.';
      errEl.style.display = 'block';
      return;
    }
    document.getElementById('ongkir-dest-label').textContent =
      `Tujuan: ${json.destination.kecamatan}, ${json.destination.kabupaten}`;

    const sorted = [...json.couriers].sort((a, b) => {
      if (a.unsupported && !b.unsupported) return 1;
      if (!a.unsupported && b.unsupported) return -1;
      return (a.price || 0) - (b.price || 0);
    });
    const fmt = n => n.toLocaleString('id-ID');
    document.getElementById('ongkir-result-list').innerHTML = sorted.map(c => {
      const scoreClass = c.unsupported ? 'none'
        : c.score == null ? 'none'
        : c.score >= 95 ? 'high'
        : c.score >= 80 ? 'mid'
        : 'low';
      const scoreLabel = c.unsupported ? '✕' : (c.score ?? '—');
      return `
      <div class="ongkir-card${c.unsupported ? ' unsupported' : ''}${c.recommended ? ' recommended' : ''}">
        ${c.recommended ? '<div class="ongkir-reco-badge">⭐ Rekomendasi Mengantar</div>' : ''}
        <div class="ongkir-card-head">
          <div class="ongkir-card-name">
            <div class="ongkir-icon">${(ONGKIR_DISPLAY[c.key] || c.key).slice(0, 2).toUpperCase()}</div>
            <span>${ONGKIR_DISPLAY[c.key] || c.key}</span>
          </div>
          <div class="ongkir-score ${scoreClass}">${scoreLabel}</div>
        </div>
        <div class="ongkir-row"><span>Biaya Pengiriman</span><strong>${c.unsupported ? '—' : 'Rp' + fmt(c.price)}</strong></div>
        <div class="ongkir-row"><span>Estimasi</span><strong>${c.unsupported ? '—' : (c.estimate_delivery || '—')}</strong></div>
      </div>`;
    }).join('');
    resultCard.style.display = 'block';
  } catch (e) {
    errEl.textContent = 'Gagal terhubung ke server.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    loading.classList.remove('show');
  }
}

// ── GRADE / SKOR PENERIMA (Mengantar) ──────────────────────────────────────────
let lastReceiverScore = null; // dikirim ke orderan_masuk_crm pas submit

function rateToGrade(rate) {
  if (rate === null || rate === undefined) return null;
  return rate >= 9 ? 'A' : rate >= 7 ? 'B' : rate >= 5 ? 'C' : 'D';
}

function summarizeReceiverScore(data) {
  const meta = new Set(['_id', 'phone', 'createdAt', 'updatedAt']);
  const couriers = Object.keys(data)
    .filter(k => !meta.has(k) && data[k] && typeof data[k].total === 'number' && data[k].total > 0)
    .map(k => ({ nama: k, ...data[k], grade: rateToGrade(data[k].rate) }));

  const totalOrder = couriers.reduce((sum, c) => sum + (c.total || 0), 0);
  // Rata-rata sederhana antar ekspedisi yang ada histori — sama seperti "Average Score/Number" di dashboard Mengantar
  const avgRate = couriers.length
    ? couriers.reduce((sum, c) => sum + (c.rate || 0), 0) / couriers.length
    : null;
  const grade = rateToGrade(avgRate);

  return { totalOrder, avgRate, grade, couriers };
}

async function validateReceiverScore() {
  const hint = document.getElementById('hint-hp');
  lastReceiverScore = null;
  if (hint) { hint.className = 'val-hint'; hint.innerHTML = ''; }
  document.getElementById('f-hp')?.classList.remove('val-ok', 'val-err', 'val-warn');

  const hpNorm = normalizeHP(document.getElementById('f-hp')?.value || '');
  const phone  = hpNorm.startsWith('0') ? hpNorm.slice(1) : hpNorm;
  if (phone.length < 8) return;

  try {
    const res  = await fetch(`/api/grade?phone=${encodeURIComponent(phone)}`);
    const json = await res.json();
    if (!json.success || !json.data) {
      valSetField('hp', 'ok', 'ℹ️ Belum ada histori Mengantar (customer baru)');
      return;
    }

    const summary = summarizeReceiverScore(json.data);
    if (!summary.totalOrder) {
      valSetField('hp', 'ok', 'ℹ️ Belum ada histori Mengantar (customer baru)');
      return;
    }
    lastReceiverScore = summary;

    const state = (summary.grade === 'A' || summary.grade === 'B') ? 'ok'
      : summary.grade === 'C' ? 'warn' : 'err';
    valSetField('hp', state, `Grade ≈${summary.grade} — Skor ${summary.avgRate.toFixed(1)}/10 (${summary.totalOrder} order)`);
    // valSetField pakai textContent utk state ok/err, jadi tombol ditambah manual lewat innerHTML di sini
    const hintEl = document.getElementById('hint-hp');
    if (hintEl) hintEl.innerHTML += ` <button class="hint-apply" onclick="showGradeDetail()">Detail</button>`;
  } catch(_) { /* gagal cek grade → jangan blokir input CS */ }
}

function showGradeDetail(score) {
  const s = score || lastReceiverScore;
  if (!s) return;
  const rows = [...s.couriers]
    .sort((a, b) => b.total - a.total)
    .map(c => `
      <tr>
        <td>${c.nama}</td>
        <td style="text-align:center">${c.total}</td>
        <td style="text-align:center">${c.delivered ?? 0}</td>
        <td style="text-align:center">${c.rts ?? 0}</td>
        <td style="text-align:center">${c.undelivered ?? 0}</td>
        <td style="text-align:center">${(c.rate || 0).toFixed(1)}</td>
        <td style="text-align:center">≈${c.grade || '-'}</td>
      </tr>`).join('');

  document.getElementById('grade-modal-body').innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:.9rem">
      <thead>
        <tr>
          <th style="text-align:left">Ekspedisi</th><th>Total</th><th>Sampai</th><th>RTS</th><th>Gagal</th><th>Skor</th><th>Grade</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  document.getElementById('grade-modal-sub').textContent =
    `Grade ≈${s.grade} — rata-rata skor ${s.avgRate.toFixed(1)}/10 dari ${s.totalOrder} order`;
  document.getElementById('grade-modal').style.display = 'flex';
}

// ── HELPER: Badge Grade utk tabel/kartu Dashboard ─────────────────────────────
const dashGradeCache = {}; // id order -> receiver_score, dipakai onclick badge buat buka modal detail
function buildGradeBadge(r) {
  const s = r.receiver_score;
  if (!s || !s.grade) return '<span class="badge" style="opacity:.5">—</span>';
  dashGradeCache[r.id] = s;
  const cls = (s.grade === 'A' || s.grade === 'B') ? 'badge-ok' : s.grade === 'C' ? 'badge-warn' : 'badge-rts';
  return `<span class="badge ${cls}" style="cursor:pointer" onclick="showGradeDetail(dashGradeCache['${r.id}'])">≈${s.grade} (${(s.avgRate || 0).toFixed(1)})</span>`;
}
function closeGradeModal() {
  document.getElementById('grade-modal').style.display = 'none';
}

// Re-validasi saat CS edit manual — debounce 800ms
let _valTimer = null;
function scheduleValidasi() {
  clearTimeout(_valTimer);
  _valTimer = setTimeout(() => validateWilayah(), 800);
}
let _gradeTimer = null;
function scheduleGradeCheck() {
  clearTimeout(_gradeTimer);
  _gradeTimer = setTimeout(() => validateReceiverScore(), 800);
}

document.getElementById('f-hp')?.addEventListener('input', scheduleGradeCheck);

['f-kelurahan','f-kecamatan','f-kabupaten','f-provinsi','f-kodepos'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', scheduleValidasi);
});
['f-no','f-pembayaran'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', validateEkspedisi);
});
['f-rincian','f-total'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', validateRincian);
});
['f-kecamatan','f-kabupaten','f-no','f-pembayaran','f-rincian'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', scheduleOngkirCheck);
});
['f-nama','f-jumlah','f-keterangan'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => validateSKU());
});

function getFormValues() {
  return {
    no                  : val('f-no'),
    nama                : val('f-nama'),
    hp                  : val('f-hp'),
    pembayaran          : val('f-pembayaran'),
    alamat              : val('f-alamat'),
    kelurahan           : val('f-kelurahan'),
    kecamatan           : val('f-kecamatan'),
    kabupaten           : val('f-kabupaten'),
    provinsi            : val('f-provinsi'),
    kodepos             : val('f-kodepos'),
    jumlah_pesanan      : val('f-jumlah'),
    quantity            : val('f-quantity'),
    total_pembayaran    : val('f-total'),
    instruksi_pengiriman: val('f-instruksi'),
    rincian_pembayaran  : val('f-rincian'),
    keterangan          : val('f-keterangan'),
    keluhan             : val('f-keluhan'),
  };
}

function val(id) {
  return (document.getElementById(id)?.value || '').trim();
}

// Field yang dicek pas submit -- gabungan semua sumber validasi (wilayah, ekspedisi, rincian,
// SKU). Semua wajib diisi.
const SUBMIT_CHECK_FIELDS = [
  { id: 'no',           label: 'No Order' },
  { id: 'nama',         label: 'Nama' },
  // hp sengaja tidak dimasukkan — val-err/val-warn di f-hp hanya dari grade receiver score,
  // bukan error format. Grade D → wajib SS saja, tidak boleh blokir submit.
  { id: 'alamat',       label: 'Alamat' },
  { id: 'kelurahan',    label: 'Kelurahan' },
  { id: 'kecamatan',    label: 'Kecamatan' },
  { id: 'kabupaten',    label: 'Kabupaten' },
  { id: 'provinsi',     label: 'Provinsi' },
  { id: 'kodepos',      label: 'Kode Pos' },
  { id: 'jumlah',       label: 'Jumlah Pesanan' },
  { id: 'pembayaran',   label: 'Pembayaran' },
  { id: 'rincian',      label: 'Rincian Pembayaran' },
  { id: 'total',        label: 'Total Pembayaran' },
  { id: 'keterangan',   label: 'Keterangan' },
];

// Ambil teks hint asli (rekomendasi dari validateWilayah/Ekspedisi/Rincian/SKU) tanpa tombol
// interaktif (misal tombol "Pakai ini" di kodepos) biar bersih dipakai di popup konfirmasi.
function hintText(id) {
  const hint = document.getElementById('hint-' + id);
  if (!hint) return '';
  return hint.innerHTML
    .replace(/<button[\s\S]*?<\/button>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

async function doSubmit() {
  const form = getFormValues();
  if (!form.nama && !form.hp) {
    showToast('Minimal nama atau HP harus diisi.', 'warn');
    return;
  }

  // Cek tiap field: kosong (wajib diisi) ATAU ada hint error/warning dari validasi yang udah
  // jalan pas parsing/edit -- popup nampilin ISI masalahnya + rekomendasi asli, bukan cuma nama field.
  const problems = [];
  SUBMIT_CHECK_FIELDS.forEach(f => {
    const el = document.getElementById('f-' + f.id);
    if (!el) return;
    const isEmpty = !(el.value || '').trim();
    if (isEmpty) {
      if (!f.optional) problems.push(`• <strong>${f.label}</strong> — kosong, wajib diisi`);
      return;
    }
    if (el.classList.contains('val-err') || el.classList.contains('val-warn')) {
      const detail = hintText(f.id);
      problems.push(`• <strong>${f.label}</strong>${detail ? ': ' + detail : ' — tidak valid'}`);
    }
  });

  // Cek format HP — harus angka saja
  const hpVal = (document.getElementById('f-hp')?.value || '').trim();
  if (hpVal && /[^\d]/.test(hpVal)) {
    problems.push(`• <strong>No. HP</strong>: mengandung karakter selain angka — "${hpVal}"`);
  }

  // Cek ongkir mismatch (> 15% dari estimasi Mengantar)
  if (typeof ongkirMismatch === 'string') {
    problems.push(`• <strong>Ongkir</strong>: ${ongkirMismatch}`);
  }

  if (problems.length > 0) {
    document.getElementById('confirm-body').innerHTML = problems.join('<br>');
    document.getElementById('confirm-overlay').style.display = 'flex';
    return; // tunggu user klik di modal
  }

  doSubmitExec();
}

async function doSubmitExec() {
  // Cek lock jam 08:00–08:59
  if (checkUploadLock()) {
    checkAndShowLockBanner();
    return;
  }

  const form    = getFormValues();
  const btn     = document.getElementById('btn-submit');
  const loading = document.getElementById('loading-submit');
  btn.disabled  = true;
  loading.classList.add('show');

  try {
    const today   = getOrderDate(); // pakai cutoff logic, bukan todayStr()
    const hpVar   = hpVariants(form.hp);             // [08xxx, 8xxx, 628xxx] — buat query, jaga-jaga format tersimpan beda-beda
    const profile  = currentProfile;

    // 1. Insert ke orderan_masuk_crm
    const insertRow = {
      ...form,
      cs_id      : currentUser.id,
      cs_nama    : profile.nama,
      tanggal    : today,
      raw_input  : document.getElementById('paste-input').value.trim(),
      created_at : nowWIB(),
      gudang_id  : selectedGudang?.id   || null,
      gudang_nama: selectedGudang?.nama || null,
    };

    const { data: inserted, error: insertErr } = await sb
      .from('orderan_masuk_crm').insert(insertRow).select().single();
    if (insertErr) {
      // Unique constraint violation — HP + tanggal sudah ada (race condition / submit ganda)
      if (insertErr.code === '23505') {
        showToast('⚠️ Order dengan nomor HP ini sudah masuk hari ini oleh CRM lain. Cek dashboard.', 'error');
        return;
      }
      throw insertErr;
    }

    const insertedId = inserted.id;

    // 2. Validasi — semua query parallel
    const kodepos = String(form.kodepos || '').trim().replace(/\.0$/, '');

    const [dupTodayRes, allOrderanRes, kpStatsRes, eksRes] = await Promise.all([
      // Cek dup hari ini (HP sama, hari sama, bukan row ini sendiri)
      hpVar.length ? sb.from('orderan_masuk_crm')
        .select('id, nama, cs_nama, created_at')
        .in('hp', hpVar)
        .eq('tanggal', today)
        .neq('id', insertedId)
        .limit(5) : Promise.resolve({ data: [] }),

      // Cek dup all team + ambil status_akhir & resi untuk deteksi RTS
      hpVar.length ? sb.from('all_orderan')
        .select('nama, hp, tanggal, cs, team, status_akhir, resi')
        .in('hp', hpVar)
        .limit(10) : Promise.resolve({ data: [] }),

      // Cek wilayah rawan dari kodepos_stats
      kodepos ? sb.from('kodepos_stats')
        .select('kodepos, total, retur, pct')
        .eq('kodepos', kodepos)
        .single() : Promise.resolve({ data: null }),

      // Cek rekomendasi ekspedisi dari ekspedisi_rekomendasi
      kodepos ? sb.from('ekspedisi_rekomendasi')
        .select('kodepos, jne_del, jnt_del, ninja_del, lion_del')
        .eq('kodepos', kodepos)
        .single() : Promise.resolve({ data: null }),
    ]);

    const dupToday   = dupTodayRes.data   || [];
    const allOrderan = allOrderanRes.data || [];
    const kpStat     = kpStatsRes.data    || null;
    const eksData    = eksRes.data        || null;

    // Rekomendasi ekspedisi — sama persis logika ValidasiOrder
    const usedEks = extractEkspedisi(form.pembayaran || '');
    let rekEkspedisi = '';
    let eksColor = 'none'; // 'green' | 'yellow' | 'red' | 'none'
    if (eksData) {
      const candidates = [
        { name: 'JNE',   del: eksData.jne_del   || 0 },
        { name: 'JNT',   del: eksData.jnt_del   || 0 },
        { name: 'Ninja', del: eksData.ninja_del || 0 },
        { name: 'Lion',  del: eksData.lion_del  || 0 },
      ].filter(e => e.del > 0).sort((a, b) => b.del - a.del);
      if (candidates.length) {
        rekEkspedisi = candidates.slice(0, 3).map(e => e.name + '(' + Math.round(e.del) + '%)').join(' > ');
        if (usedEks) {
          const rekList  = candidates.map(e => e.name.toLowerCase());
          const topRek   = candidates[0].name.toLowerCase();
          if (!rekList.includes(usedEks.toLowerCase()))          eksColor = 'red';
          else if (topRek !== usedEks.toLowerCase())             eksColor = 'yellow';
          else                                                    eksColor = 'green';
        }
      }
    }
    const isEkspedisiWrong = eksColor === 'red' || eksColor === 'yellow';

    // Wilayah rawan: sama persis ValidasiOrder
    // pct >= 30 → RAWAN TINGGI, pct >= 15 → PERLU DIPERHATIKAN, pct < 15 → aman
    // Flag notif hanya kalau >= 15 (sama dengan filter dashboard ValidasiOrder)
    const kpPct          = kpStat ? (kpStat.pct || Math.round((kpStat.retur / kpStat.total) * 100)) : 0;
    const kpStatus       = kpPct >= 30 ? 'RAWAN TINGGI' : kpPct >= 15 ? 'PERLU DIPERHATIKAN' : 'RELATIF AMAN';
    const isWilayahRawan = kpStat && kpStat.total >= 5 && kpPct >= 15;

    const isDupToday = dupToday.length > 0;
    const isDupAll   = allOrderan.length > 0;

    // RTS: sama persis ValidasiOrder doValidasiHarian()
    // 1. Cek status_akhir → returMatches = order yang pernah retur
    const returMatches = allOrderan.filter(m =>
      (m.status_akhir||'').toLowerCase().includes('retur')
    );
    const isRetur = returMatches.length > 0;

    // 2. Ambil resi untuk cek detail di all_rts
    //    Kalau ada retur → cek resi dari returMatches saja
    //    Kalau tidak ada retur → tetap cek semua resi (jaga-jaga all_rts punya data)
    const checkMatches = isRetur ? returMatches : allOrderan;
    const resiList = checkMatches.map(m => (m.resi||'').trim().toLowerCase()).filter(Boolean);

    let rtsData = [];
    if (resiList.length) {
      const { data: rtsRows } = await sb.from('all_rts')
        .select('resi, bulan, reason, status, pihak')
        .in('resi', resiList)
        .limit(10);
      rtsData = rtsRows || [];
    }

    // 3. isRTSFinal: positif jika retur di status_akhir ATAU resi ditemukan di all_rts
    const isRTSFinal = isRetur || rtsData.length > 0;
    // Fallback: kalau all_rts kosong tapi ada returMatches, pakai returMatches untuk detail
    if (!rtsData.length && isRetur) rtsData = returMatches;

    // Hitung total RTS dari status_akhir — kebijakan: >= 2x wajib Transfer
    const rtsCount        = returMatches.length;
    const isWajibTransfer = isRTSFinal && rtsCount >= 2;

    // 3a. Cek iklan_verified — apakah HP ini ada di gmail_leads CS ini dalam 7 hari terakhir
    let iklanVerified = null; // null = tidak perlu dicek (bukan dup_all)
    if (isDupAll) {
      const cutoff7 = new Date(Date.now() - 7 * 864e5).toISOString();
      const { data: leadRows } = await sb.from('gmail_leads')
        .select('id')
        .eq('hp', normalizeHP(form.hp))
        .eq('cs_id', currentUser.id)
        .gte('email_date', cutoff7)
        .limit(1);
      iklanVerified = !!(leadRows && leadRows.length > 0);
    }

    // 3. Update row dengan hasil validasi
    const valUpdate = {
      is_dup_today      : isDupToday,
      is_dup_all        : isDupAll,
      is_rts            : isRTSFinal,
      is_wajib_transfer : isWajibTransfer  || false,
      is_wilayah_rawan  : isWilayahRawan   || false,
      is_eks_wrong      : isEkspedisiWrong || false,
      dup_detail        : isDupAll         ? allOrderan : null,
      rts_detail        : isRTSFinal       ? rtsData    : null,
      kp_stat           : kpStat           ? { total: kpStat.total, retur: kpStat.retur, pct: kpStat.pct } : null,
      eks_detail        : rekEkspedisi     ? { dipakai: usedEks, rekomendasi: rekEkspedisi, status: eksColor } : null,
      receiver_score    : lastReceiverScore || null,
      iklan_verified    : iklanVerified,
    };

    await sb.from('orderan_masuk_crm').update(valUpdate).eq('id', insertedId);

    // 4. Kirim WA notifikasi kalau ada masalah
    const masalah = [];
    if (isDupToday)        masalah.push('⚠️ DUPLIKAT HARI INI — HP ini sudah diinput ' + dupToday.length + 'x hari ini');
    if (isDupAll)          masalah.push('ℹ️ DUPLIKAT ALL TEAM — HP pernah order sebelumnya');
    if (isRTSFinal)        masalah.push('🔴 PERNAH RTS — customer ini pernah retur barang (' + rtsCount + 'x)');
    if (isWajibTransfer)   masalah.push('🚫 WAJIB TRANSFER — customer sudah RTS ' + rtsCount + 'x, tidak boleh COD');
    if (isWilayahRawan)    masalah.push('📍 WILAYAH ' + kpStatus + ' — ' + kpPct + '% RTS (' + kpStat.retur + '/' + kpStat.total + ' order historis)');
    if (isEkspedisiWrong)  masalah.push('🚚 EKSPEDISI ' + (eksColor === 'red' ? 'TIDAK DIREKOMENDASIKAN' : 'BUKAN TERBAIK') + ' — rekomendasi: ' + rekEkspedisi);
    const isGradeBuruk = lastReceiverScore && lastReceiverScore.grade === 'D';
    if (isGradeBuruk)      masalah.push('⚙️ SKOR PENERIMA RENDAH — Grade D (' + lastReceiverScore.avgRate.toFixed(1) + '/10) dari ' + lastReceiverScore.totalOrder + ' order historis Mengantar');

    if (masalah.length > 0 && profile.no_wa) {
      const csName = profile.nama || 'CS';

      // Info customer
      const totalRp = form.total_pembayaran
        ? 'Rp' + Number(form.total_pembayaran).toLocaleString('id-ID')
        : '—';
      const produkLine = [form.jumlah_pesanan, form.pembayaran, totalRp]
        .filter(Boolean).join(' / ');

      // Detail per flag
      const flagLines = [];

      if (isDupToday) {
        const detail = dupToday.map(m => {
          const jam = new Date(m.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
          return `   → Sudah diinput oleh ${m.cs_nama||'CRM lain'} jam ${jam}`;
        }).join('\n');
        flagLines.push(`⚠️ *DUPLIKAT HARI INI*\n${detail}`);
      }

      if (isDupAll) {
        const detail = allOrderan.slice(0, 3)
          .map(m => `   → Pernah order${m.tanggal ? ' '+m.tanggal : ''}${m.team ? ' ('+m.team+')' : ''}${m.cs ? ' · CS: '+m.cs : ''}`)
          .join('\n') || '   → Data historis ditemukan';
        flagLines.push(`ℹ️ *DUPLIKAT ALL TEAM*\n${detail}`);
      }

      if (isRTSFinal) {
        const detail = rtsData.slice(0, 3).map(m => {
          const alasan = m.reason || '';
          const tgl    = m.bulan  || m.tanggal || '';
          return `   → ${alasan ? 'Alasan: '+alasan : 'Pernah retur'}${tgl ? ' ('+tgl+')' : ''}`;
        }).join('\n') || '   → Riwayat retur ditemukan';
        flagLines.push(`🔴 *PERNAH RTS* (${rtsCount}x)\n${detail}`);
      }

      if (isWajibTransfer) {
        flagLines.push(
          `🚫 *WAJIB TRANSFER*\n` +
          `   → Customer ini sudah RTS ${rtsCount}x\n` +
          `   → Tidak boleh diproses COD, harus Transfer terlebih dahulu`
        );
      }

      if (isWilayahRawan) {
        flagLines.push(
          `📍 *WILAYAH ${kpStatus}*\n` +
          `   → Kode Pos ${kodepos}: ${kpPct}% RTS (${kpStat.retur}/${kpStat.total} order historis)`
        );
      }

      if (isEkspedisiWrong) {
        const eksLabel = eksColor === 'red' ? 'TIDAK DIREKOMENDASIKAN' : 'BUKAN YANG TERBAIK';
        flagLines.push(
          `🚚 *EKSPEDISI ${eksLabel}*\n` +
          `   → Dipakai: ${usedEks || '—'}\n` +
          `   → Rekomendasi: ${rekEkspedisi}`
        );
      }

      if (isGradeBuruk) {
        flagLines.push(
          `⚙️ *SKOR PENERIMA RENDAH (Grade D)*\n` +
          `   → Skor ${lastReceiverScore.avgRate.toFixed(1)}/10 dari ${lastReceiverScore.totalOrder} order historis Mengantar`
        );
      }

      const msg =
        `⚠️ *CS Input — Peringatan Order*\n\n` +
        `Halo ${csName} 👋\n` +
        `Order baru kamu ada masalah:\n\n` +
        `👤 Nama  : ${form.nama||'—'}\n` +
        `📱 HP    : ${form.hp||'—'}\n` +
        `📦 Produk: ${produkLine||'—'}\n\n` +
        flagLines.join('\n\n') +
        `\n\nMohon segera konfirmasi ke validator sebelum order dilanjutkan.\nTerima Kasih 🙏`;

      try {
        await fetch('/api/notif', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: profile.no_wa, message: msg })
        });
        await sb.from('orderan_masuk_crm').update({ wa_notif_sent: true }).eq('id', insertedId);
      } catch(_) { /* WA notif fail, tetap lanjut */ }
    }

    // 5. Tampilkan hasil validasi
    if (masalah.length > 0) {
      showValBanner('warn', '⚠️ Order tersimpan dengan catatan:\n' + masalah.join('\n'));
    } else {
      showValBanner('aman', '✅ Order aman — tidak ada duplikat dan tidak ada riwayat RTS.');
    }

    showToast('Order berhasil disimpan!', 'success');

    // E-Member: cek apakah order ini transfer
    if (isMemberTransfer(form)) {
      try {
        const member = await upsertCsMember(form);
        if (member) showMemberCardPopup(member);
      } catch(_) { /* jangan ganggu flow utama */ }
    }

    // Reset form paste, sembunyikan preview, refresh history
    document.getElementById('paste-input').value = '';
    document.getElementById('preview-card').classList.remove('show');
    parsedData = null;

    await loadHistoryMini();
    await loadDashboard();

  } catch(e) {
    showToast('Gagal submit: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    loading.classList.remove('show');
  }
}

function clearPaste() {
  document.getElementById('paste-input').value = '';
  document.getElementById('preview-card').classList.remove('show');
  hideValBanner();
  parsedData = null;
}

// ── E-MEMBER CARD (Transfer) ──────────────────────────────────────────────────

let _memberCardDownloadName = 'emember-card.png';

function isMemberTransfer(form) {
  const nama      = (form.nama       || '').toUpperCase();
  const bayar     = (form.pembayaran || '').toUpperCase();
  return nama.includes('|TF') || bayar.includes('TRANSFER');
}

function extractNamaMember(namRaw) {
  // "PRAMONO|HRB 2|TF" → "PRAMONO"
  return (namRaw || '').split('|')[0].trim();
}

async function upsertCsMember(form) {
  const namaRaw  = form.nama || '';
  const nama     = extractNamaMember(namaRaw);
  const no_hp    = form.hp || '';
  if (!no_hp) return null;

  // Cek apakah sudah ada
  const { data: existing } = await sb
    .from('cs_members')
    .select('id, nama, no_hp, total_closing, point')
    .eq('no_hp', no_hp)
    .maybeSingle();

  if (existing) {
    // Update: tambah closing + point
    const newClosing = (existing.total_closing || 0) + 1;
    const newPoint   = (existing.point          || 0) + 50;
    const { data: updated } = await sb
      .from('cs_members')
      .update({ total_closing: newClosing, point: newPoint, updated_at: nowWIB() })
      .eq('id', existing.id)
      .select()
      .single();
    return updated;
  } else {
    // Insert baru
    const { data: inserted } = await sb
      .from('cs_members')
      .insert({ nama, no_hp, total_closing: 1, point: 50 })
      .select()
      .single();
    return inserted;
  }
}

function showMemberCardPopup(member) {
  const nama         = member.nama         || '—';
  const totalClosing = member.total_closing || 1;
  const point        = member.point        || 50;

  drawHerbanesiaCard(nama, totalClosing, point);

  _memberCardDownloadName = `emember-${nama.replace(/\s+/g,'-')}.png`;

  const sub = document.getElementById('emember-modal-sub');
  if (sub) sub.textContent = totalClosing > 1
    ? `Closing ke-${totalClosing} — Point: ${point}`
    : 'Member baru terdaftar — Point: 50';

  document.getElementById('emember-modal').style.display = 'flex';
}

function closeMemberModal() {
  document.getElementById('emember-modal').style.display = 'none';
}

function downloadMemberCardFromModal() {
  const canvas = document.getElementById('memberCardCanvas');
  const link   = document.createElement('a');
  link.download = _memberCardDownloadName;
  link.href     = canvas.toDataURL('image/png');
  link.click();
}

function drawHerbanesiaCard(nama, totalClosing, point) {
  const canvas = document.getElementById('memberCardCanvas');
  const ctx    = canvas.getContext('2d');
  const W = 760, H = 440;
  ctx.clearRect(0, 0, W, H);

  // ── Background cream ──────────────────────────────────────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 18);
  ctx.clip();

  // Gradient cream
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0,   '#fdf5e9');
  bgGrad.addColorStop(0.5, '#faf0df');
  bgGrad.addColorStop(1,   '#f5e8d0');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Subtle texture lines diagonal
  ctx.strokeStyle = 'rgba(180,130,60,.06)';
  ctx.lineWidth   = 1;
  for (let i = -H; i < W + H; i += 22) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke();
  }

  ctx.restore();

  // ── Decorative leaf/wheat pattern (background, kiri bawah) ───────────────
  _drawLeafDecor(ctx, 30, H - 20, 0.9, 'rgba(160,110,30,.10)');

  // ── Decorative leaf kanan atas (balik) ───────────────────────────────────
  ctx.save();
  ctx.translate(W - 10, 30);
  ctx.scale(-1, 1);
  _drawLeafDecor(ctx, 0, 0, 0.55, 'rgba(160,110,30,.07)');
  ctx.restore();

  // ── Medal besar kiri ─────────────────────────────────────────────────────
  _drawBronzeMedalLarge(ctx, 148, 226, 130);

  // ── Divider vertikal ─────────────────────────────────────────────────────
  ctx.save();
  const divGrad = ctx.createLinearGradient(310, 60, 310, H - 60);
  divGrad.addColorStop(0, 'rgba(160,110,40,.0)');
  divGrad.addColorStop(0.3, 'rgba(160,110,40,.30)');
  divGrad.addColorStop(0.7, 'rgba(160,110,40,.30)');
  divGrad.addColorStop(1, 'rgba(160,110,40,.0)');
  ctx.fillStyle = divGrad;
  ctx.fillRect(308, 60, 2, H - 120);
  ctx.restore();

  // ── Kanan: konten utama ───────────────────────────────────────────────────
  const rx = 330; // x mulai konten kanan

  // Logo / Brand name
  ctx.save();
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = '#7c4a03';
  ctx.fillText('🌿', rx, 72);
  ctx.restore();

  ctx.save();
  ctx.font = 'bold 28px serif';
  ctx.fillStyle = '#4a2800';
  ctx.letterSpacing = '2px';
  ctx.fillText('HERBANESIA', rx + 26, 74);
  ctx.restore();

  // Badge "MEMBER CARD"
  _drawMemberBadge(ctx, rx, 90, 180, 30);

  // Badge bronze kanan atas
  _drawBronzeBadgeSmall(ctx, W - 72, 72, 56);

  // ── Field: NAMA MEMBER ────────────────────────────────────────────────────
  const fy1 = 195;
  _drawFieldLabel(ctx, rx, fy1, '🌿 NAMA MEMBER');
  _drawFieldLine(ctx, rx, fy1 + 8, 360);
  ctx.save();
  ctx.font = 'bold 18px sans-serif';
  ctx.fillStyle = '#3a1f00';
  ctx.fillText(nama.toUpperCase(), rx + 4, fy1 + 28);
  ctx.restore();

  // ── Field: TOTAL CLOSING + JUMLAH POINT ──────────────────────────────────
  const fy2 = 290;
  _drawFieldLabel(ctx, rx, fy2, '🌿 TOTAL CLOSING');
  _drawFieldBox(ctx, rx, fy2 + 10, 155, 44);
  ctx.save();
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = '#3a1f00';
  ctx.textAlign = 'center';
  ctx.fillText(String(totalClosing), rx + 77, fy2 + 38);
  ctx.restore();

  const px = rx + 175;
  _drawFieldLabel(ctx, px, fy2, '🌿 JUMLAH POINT');
  _drawFieldBox(ctx, px, fy2 + 10, 155, 44);
  ctx.save();
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = '#3a1f00';
  ctx.textAlign = 'center';
  ctx.fillText(String(point), px + 77, fy2 + 38);
  ctx.restore();

  // ── Border card ──────────────────────────────────────────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 18);
  const borderGrad = ctx.createLinearGradient(0, 0, W, H);
  borderGrad.addColorStop(0,   'rgba(180,120,20,.55)');
  borderGrad.addColorStop(0.5, 'rgba(210,160,40,.30)');
  borderGrad.addColorStop(1,   'rgba(140,80,10,.55)');
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth   = 3;
  ctx.stroke();
  ctx.restore();
}

// ── Helper drawers ────────────────────────────────────────────────────────────

function _drawLeafDecor(ctx, x, y, scale, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2;
  // Batang utama
  for (let i = 0; i < 7; i++) {
    const bx = i * 28, by = -i * 22;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.bezierCurveTo(bx - 18, by - 30, bx + 10, by - 55, bx + 5, by - 70);
    ctx.stroke();
    // Daun kiri
    ctx.beginPath();
    ctx.moveTo(bx, by - 20);
    ctx.bezierCurveTo(bx - 35, by - 30, bx - 40, by - 52, bx - 10, by - 58);
    ctx.stroke();
    // Daun kanan
    ctx.beginPath();
    ctx.moveTo(bx, by - 20);
    ctx.bezierCurveTo(bx + 30, by - 28, bx + 35, by - 50, bx + 12, by - 56);
    ctx.stroke();
  }
  ctx.restore();
}

function _drawBronzeMedalLarge(ctx, cx, cy, r) {
  // Outer ring
  ctx.save();
  const ringGrad = ctx.createRadialGradient(cx - r*0.25, cy - r*0.25, r*0.1, cx, cy, r);
  ringGrad.addColorStop(0,    '#f5d27a');
  ringGrad.addColorStop(0.35, '#c8860a');
  ringGrad.addColorStop(0.7,  '#8b5e0a');
  ringGrad.addColorStop(1,    '#5a3800');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = ringGrad;
  ctx.fill();
  ctx.restore();

  // Inner circle
  ctx.save();
  const innerGrad = ctx.createRadialGradient(cx - r*0.2, cy - r*0.2, r*0.05, cx, cy, r*0.75);
  innerGrad.addColorStop(0,   '#fce9a0');
  innerGrad.addColorStop(0.4, '#d4980f');
  innerGrad.addColorStop(1,   '#7a4800');
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
  ctx.fillStyle = innerGrad;
  ctx.fill();
  ctx.restore();

  // Star
  _drawStar(ctx, cx, cy, 6, r * 0.52, r * 0.22, '#fff8dc', '#d4a017', 3);
}

function _drawBronzeBadgeSmall(ctx, cx, cy, r) {
  ctx.save();
  const g = ctx.createRadialGradient(cx - r*0.2, cy - r*0.2, r*0.05, cx, cy, r);
  g.addColorStop(0,   '#f5d27a');
  g.addColorStop(0.4, '#c8860a');
  g.addColorStop(1,   '#5a3800');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  _drawStar(ctx, cx, cy, 5, r * 0.55, r * 0.23, '#fff8dc', '#d4a017', 2.5);

  // Label BRONZE di bawah badge
  ctx.save();
  ctx.font      = 'bold 11px sans-serif';
  ctx.fillStyle = '#7c4a03';
  ctx.textAlign = 'center';
  ctx.fillText('BRONZE', cx, cy + r + 14);
  ctx.restore();
}

function _drawStar(ctx, cx, cy, points, outerR, innerR, fillColor, strokeColor, lineWidth) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = (i * Math.PI / points) - Math.PI / 2;
    const radius = i % 2 === 0 ? outerR : innerR;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle   = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth   = lineWidth;
  ctx.stroke();
  ctx.restore();
}

function _drawMemberBadge(ctx, x, y, w, h) {
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0,   '#8b5a00');
  g.addColorStop(0.5, '#c8860a');
  g.addColorStop(1,   '#8b5a00');
  ctx.beginPath();
  // Banner shape (sisi kiri kanan serong)
  const pad = 8;
  ctx.moveTo(x + pad, y);
  ctx.lineTo(x + w - pad, y);
  ctx.lineTo(x + w, y + h / 2);
  ctx.lineTo(x + w - pad, y + h);
  ctx.lineTo(x + pad, y + h);
  ctx.lineTo(x, y + h / 2);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.font      = 'bold 13px sans-serif';
  ctx.fillStyle = '#fff8dc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MEMBER CARD', x + w / 2, y + h / 2);
  ctx.restore();
}

function _drawFieldLabel(ctx, x, y, text) {
  ctx.save();
  ctx.font      = '11px sans-serif';
  ctx.fillStyle = '#8b5a00';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function _drawFieldLine(ctx, x, y, w) {
  ctx.save();
  ctx.strokeStyle = 'rgba(140,90,10,.40)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y + 2);
  ctx.lineTo(x + w, y + 2);
  ctx.stroke();
  ctx.restore();
}

function _drawFieldBox(ctx, x, y, w, h) {
  ctx.save();
  ctx.strokeStyle = 'rgba(140,90,10,.35)';
  ctx.lineWidth   = 1.5;
  ctx.fillStyle   = 'rgba(255,240,200,.30)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ── HISTORY MINI (Upload page) ────────────────────────────────────────────────
async function loadHistoryMini() {
  if (!currentUser) return;
  const today = getOrderDate();
  const { data } = await sb.from('orderan_masuk_crm')
    .select('id, nama, hp, created_at, acc_spv, is_dup_today, is_rts')
    .eq('cs_id', currentUser.id)
    .eq('tanggal', today)
    .order('created_at', { ascending: false })
    .limit(10);

  const list = data || [];
  const card = document.getElementById('history-card');
  const ul   = document.getElementById('history-list');

  if (!list.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';

  ul.innerHTML = list.map(r => {
    const badge = r.acc_spv === 'KIRIM'  ? '<span class="badge badge-kirim">KIRIM</span>'
      : r.acc_spv === 'HOLD'   ? '<span class="badge badge-hold">HOLD</span>'
      : r.acc_spv === 'CANCEL' ? '<span class="badge badge-cancel">CANCEL</span>'
      : r.is_dup_today         ? '<span class="badge badge-dup">DUP</span>'
      : r.is_rts               ? '<span class="badge badge-rts">RTS</span>'
      : '<span class="badge badge-pending">Menunggu</span>';
    const waktu = new Date(r.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    return `<div class="history-item">
      <span class="h-nama">${r.nama||'—'}</span>
      <span class="h-hp">${r.hp||''}</span>
      ${badge}
      <span class="h-time">${waktu}</span>
    </div>`;
  }).join('');
}

// ── SETTING ───────────────────────────────────────────────────────────────────
async function loadSetting() {
  if (!currentUser || !currentProfile) return;
  document.getElementById('s-nama').value  = currentProfile.nama  || '';
  document.getElementById('s-wa').value    = currentProfile.no_wa || '';
  document.getElementById('s-email').value = currentProfile.email || currentUser.email || '';
  document.getElementById('info-email').textContent = currentProfile.email || currentUser.email || '—';
  const joined = new Date(currentUser.created_at).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
  document.getElementById('info-join').textContent  = joined;

  const { count } = await sb.from('orderan_masuk_crm')
    .select('*', { count:'exact', head:true })
    .eq('cs_id', currentUser.id)
    .eq('tanggal', getOrderDate());
  document.getElementById('info-today').textContent = (count||0) + ' order';

  await loadGmailStatus();
}

// ── GMAIL SETTING ─────────────────────────────────────────────────────────────
async function loadGmailStatus() {
  if (!currentUser) return;
  try {
    const res  = await fetch(`/api/gmail-cs?action=status&cs_id=${currentUser.id}`);
    const data = await res.json();
    const dot   = document.getElementById('gmail-status-dot');
    const label = document.getElementById('gmail-status-label');
    const email = document.getElementById('gmail-status-email');
    const btnConn = document.getElementById('gmail-connect-btn');
    const btnDisc = document.getElementById('gmail-disconnect-btn');
    if (data.connected) {
      dot.style.background   = 'var(--success)';
      label.textContent      = 'Terhubung';
      label.style.color      = 'var(--success)';
      email.textContent      = data.gmail_email || '';
      btnConn.style.display  = 'none';
      btnDisc.style.display  = 'inline-block';
    } else {
      dot.style.background   = 'var(--muted)';
      label.textContent      = 'Belum terhubung';
      label.style.color      = 'var(--muted)';
      email.textContent      = '';
      btnConn.style.display  = 'inline-block';
      btnDisc.style.display  = 'none';
    }
  } catch(e) {
    document.getElementById('gmail-status-label').textContent = 'Gagal memuat status';
  }
}

async function gmailConnect() {
  const btn = document.getElementById('gmail-connect-btn');
  btn.disabled = true;
  btn.textContent = 'Menghubungkan...';
  try {
    const res  = await fetch(`/api/gmail-cs?action=url&cs_id=${currentUser.id}`);
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else throw new Error(data.error || 'Gagal ambil URL');
  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Hubungkan Gmail';
    showToast('Gagal: ' + e.message, 'error');
  }
}

async function gmailDisconnect() {
  const btn = document.getElementById('gmail-disconnect-btn');
  btn.disabled = true;
  try {
    await fetch(`/api/gmail-cs?action=disconnect&cs_id=${currentUser.id}`);
    showToast('Gmail berhasil diputus.', 'success');
    await loadGmailStatus();
  } catch(e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function saveProfil() {
  const nama = document.getElementById('s-nama').value.trim();
  const wa   = document.getElementById('s-wa').value.trim();
  const statusEl = document.getElementById('profil-status');

  if (!nama) { showStatus(statusEl, 'Nama tidak boleh kosong.', 'error'); return; }

  try {
    await updateProfile(currentUser.id, { nama, no_wa: wa, updated_at: new Date().toISOString() });
    currentProfile.nama  = nama;
    currentProfile.no_wa = wa;
    document.getElementById('user-nama').textContent   = nama;
    document.getElementById('user-avatar').textContent = nama.charAt(0).toUpperCase();
    showStatus(statusEl, '✓ Profil berhasil disimpan.', 'success');
    showToast('Profil disimpan!', 'success');
  } catch(e) {
    showStatus(statusEl, '✗ Gagal: ' + e.message, 'error');
  }
}

async function savePassword() {
  const pass  = document.getElementById('s-pass').value;
  const pass2 = document.getElementById('s-pass2').value;
  const statusEl = document.getElementById('pass-status');

  if (!pass)        { showStatus(statusEl, 'Password baru wajib diisi.', 'error'); return; }
  if (pass.length < 6) { showStatus(statusEl, 'Password minimal 6 karakter.', 'error'); return; }
  if (pass !== pass2)  { showStatus(statusEl, 'Konfirmasi password tidak cocok.', 'error'); return; }

  try {
    const { error } = await sb.auth.updateUser({ password: pass });
    if (error) throw error;
    document.getElementById('s-pass').value  = '';
    document.getElementById('s-pass2').value = '';
    showStatus(statusEl, '✓ Password berhasil diganti.', 'success');
    showToast('Password diperbarui!', 'success');
  } catch(e) {
    showStatus(statusEl, '✗ Gagal: ' + e.message, 'error');
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function extractEkspedisi(pembayaran) {
  if (!pembayaran) return '';
  const p = String(pembayaran).toUpperCase();
  const list = ['SICEPAT','ANTERAJA','NINJA','LION','TIKI','SAP','IDX','JNE','JNT','SCP','POS'];
  for (const eks of list) {
    if (p.includes(eks)) {
      if (eks === 'SCP' || eks === 'SICEPAT') return 'SiCepat';
      if (eks === 'ANTERAJA') return 'Anteraja';
      if (eks === 'NINJA')    return 'Ninja';
      if (eks === 'LION')     return 'Lion';
      if (eks === 'POS')      return 'POS Indonesia';
      return eks; // JNE, JNT, TIKI, SAP, IDX
    }
  }
  return '';
}

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); // format YYYY-MM-DD WIB
}

// ── CUTOFF JAM 08.00 WIB ──────────────────────────────────────────────────────
// 00:00–07:59 → tanggal = kemarin, bisa upload
// 08:00–08:59 → LOCKED
// 09:00+      → tanggal = hari ini, bisa upload
function getWIBHour() {
  return parseInt(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }), 10);
}

function getOrderDate() {
  const hour = getWIBHour();
  if (hour < 8) {
    // Sebelum jam 8 → tanggal kemarin
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  }
  return todayStr();
}

function checkUploadLock() {
  const hour = getWIBHour();
  return hour === 8; // jam 08:00–08:59 = locked
}

// Beda dari checkUploadLock (yang cuma ngunci 08:00–08:59 lalu kebuka lagi jam 9 buat siklus
// hari berikutnya) — upload SS dikunci PERMANEN per-order begitu siklus (tanggal) order itu
// sudah lewat, bukan cuma ngecek jam sekarang. Order dari siklus yang MASIH aktif tetap bisa
// upload kapan aja meski udah malam; baru kekunci begitu getOrderDate() gonta ke tanggal baru
// (jam 8 pagi berikutnya).
function checkSSLock(order) {
  if (!order || !order.tanggal) return getWIBHour() >= 8;
  return String(order.tanggal).slice(0, 10) !== getOrderDate();
}

let _lockTimer = null;
function startLockCountdown() {
  const banner = document.getElementById('upload-lock-banner');
  if (!banner) return;
  clearInterval(_lockTimer);
  _lockTimer = setInterval(() => {
    const now  = new Date();
    const wib  = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const hour = wib.getHours();
    if (hour >= 9) {
      clearInterval(_lockTimer);
      banner.style.display = 'none';
      document.getElementById('btn-submit').disabled = !parsedData;
      return;
    }
    const sisa = 60 - wib.getMinutes();
    const detik = 60 - wib.getSeconds();
    const cd = document.getElementById('lock-countdown');
    if (cd) cd.textContent = `${sisa - 1} menit ${detik < 60 ? detik : 0} detik`;
  }, 1000);
}

function checkAndShowLockBanner() {
  const banner = document.getElementById('upload-lock-banner');
  if (!banner) return;
  if (checkUploadLock()) {
    banner.style.display = 'flex';
    document.getElementById('btn-submit').disabled = true;
    startLockCountdown();
  } else {
    banner.style.display = 'none';
  }
}

function showValBanner(type, msg) {
  const el = document.getElementById('val-banner');
  el.className = 'val-banner show';
  if (type === 'aman') el.classList.add('val-aman');
  else if (type === 'warn') el.classList.add('val-warn');
  else el.classList.add('val-danger');
  el.textContent = msg;
}

function hideValBanner() {
  const el = document.getElementById('val-banner');
  if (el) el.classList.remove('show','val-aman','val-warn','val-danger');
}

function showStatus(el, msg, type) {
  el.textContent   = msg;
  el.style.display = 'block';
  el.style.color   = type === 'success' ? 'var(--success)' : 'var(--danger)';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function showToast(msg, type = 'info') {
  let wrap = document.getElementById('toast-wrap');
  const t  = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ── TRACKING ORDER ────────────────────────────────────────────────────────────
let trkAllData = []; // cache untuk applyTrkFilter tanpa re-query

// ── TRACKING RESI (live, sama engine dengan AdsyCRM) ─────────────────────────
const TR_STEP_LABELS = ['Konfirmasi','Dikirim','Kota Tujuan','OTW','Sampai'];
const TR_STAGE_META = {
  MENUNGGU_RESI: { label:'⏳ Menunggu Resi', color:'var(--warn)',    bg:'var(--warn-light)',    step:1 },
  BELUM_DICEK:   { label:'🔍 Belum Dicek',   color:'var(--muted)',   bg:'var(--bg)',             step:1 },
  DIKIRIM:       { label:'🚚 Dikirim',       color:'var(--accent)',  bg:'var(--accent-light)',   step:2 },
  KOTA_TUJUAN:   { label:'🏙️ Kota Tujuan',  color:'var(--accent)',  bg:'var(--accent-light)',   step:3 },
  OTW:           { label:'🛵 OTW',           color:'var(--accent)',  bg:'var(--accent-light)',   step:4 },
  SAMPAI:        { label:'✅ Sampai',        color:'var(--success)', bg:'var(--success-light)',  step:5 },
  BERMASALAH:    { label:'⚠️ Bermasalah',    color:'var(--danger)',  bg:'var(--danger-light)',   step:2, problem:true },
  RETUR:         { label:'↩️ Retur',         color:'var(--danger)',  bg:'var(--danger-light)',   step:2, problem:true },
};

const TR_COURIER_MAP = {
  'JNE':'JNE','JNT':'JT','SICEPAT':'SiCepat','LION':'lion',
  'SAP':'SAP','ANTERAJA':'anteraja','NINJA':'Ninja','IDEXPRESS':'iDexpress'
};

// Bucket ringkasan 4 kategori buat angka stat card (Total/Proses/Undell/Delivered/Retur)
function trCardState(stage) {
  if (stage === 'SAMPAI')     return 'delivered';
  if (stage === 'RETUR')      return 'retur';
  if (stage === 'BERMASALAH') return 'undell';
  return 'proses'; // MENUNGGU_RESI, BELUM_DICEK, DIKIRIM, KOTA_TUJUAN, OTW
}

// Status efektif satu order: resi kosong → menunggu, resi ada tapi belum pernah dicek cron/manual → belum dicek
function trEffectiveStage(row) {
  if (!row.resi) return 'MENUNGGU_RESI';
  if (!row.status_resi || !TR_STAGE_META[row.status_resi]) return 'BELUM_DICEK';
  return row.status_resi;
}

function trTimeAgo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1)   return 'baru saja';
  if (mins < 60)  return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

// Port dari js/shared.js AdsyCRM (sesi 2026-07-10, validasi ~15 resi asli JNT/Lion/JNE/POS):
// - trIsPickupPhase: entry code ada kata "PICKUP" (fase jemput dari pengirim di kota ASAL) di-skip
//   dari cek OTW/Bermasalah/Kota Tujuan — kata "gagal"/"percobaan" di fase ini soal jemput dari
//   toko, bukan progress ke penerima (resi Lion asli C1QSTIEB: "GAGAL DIJEMPUT...PERCOBAAN
//   PENJEMPUTAN ULANG" kepancing OTW/Bermasalah padahal blm sampai kota tujuan sama sekali).
// - trIsSelfReceipt: "diterima oleh X" cuma SAMPAI kalau X beda dari counter/kota entry itu
//   sendiri (J&T pake frasa sama buat "diterima oleh COUNTER ASAL buat manifest" vs "diterima
//   oleh PENERIMA" — resi asli JJ6000055580).
// - trHasReceivedBy: field `receiver` J&T cuma keisi PAS beneran diterima penerima; J&T juga
//   punya format "Paket telah diterima" TANPA kata "oleh X" yang gak ketangkep regex (JJ6000043832).
function trIsPickupPhase(e) {
  return !!(e && e.code && /pickup/i.test(e.code));
}
function trIsSelfReceipt(e) {
  if (!e || !e.place) return false;
  const m = /diterima oleh\s+(.+)/i.exec(e.descOnly || '');
  if (!m) return false;
  const norm = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return norm(m[1]) === norm(e.place);
}
function trHasReceivedBy(e) {
  return !!(e && e.receivedBy);
}

function _trNormalizeMengantar(json) {
  if (!json || !json.success || !json.data) return null;
  const d = json.data;
  const history = Array.isArray(d.history) ? d.history : [];
  const entries = history.map(h => ({
    desc: [h.desc, h.code].filter(Boolean).join(' '),
    descOnly: h.desc || '',
    code: h.code || null,
    place: h.counter_name || h.city_name || null,
    receivedBy: (h.receiver || '').trim() || null,
    group: h.type?.group || null, tag: h.type?.tag || null, reasonDelivery: null
  }));
  return {
    statusCategory: d.statusCategory || d.status || '',
    entries,
    detail: { history, receiver: d.RECEIVER_NAME || null, city: d.RECEIVER_CITY || null }
  };
}

function _trNormalizePos(json) {
  if (!json || !json.success || !json.data) return null;
  const d = json.data;
  const history = Array.isArray(d.connote_history) ? d.connote_history : [];
  // reasonDelivery = ANY percobaan antar gagal/reschedule -- by design langsung BERMASALAH dari
  // percobaan pertama gagal (keputusan user, sesi 2026-07-10 AdsyCRM). isPos = true -> skip
  // tebak-kata generik di bawah (problem POS murni dari reasonDelivery). destNopen buat deteksi
  // "tiba di cabang TUJUAN" (POS pake teks "tiba di Cabang X", bukan "tiba di kota").
  const destNopen = d.connote_customfield?.destination_nopen || null;
  const entries = history.map(h => ({
    desc: [h.content, h.content2].filter(Boolean).join(' '),
    group: null, tag: null, isPos: true,
    atDestination: !!(destNopen && h.state === 'INLOCATION' && h.nopen === destNopen),
    reasonDelivery: h.reason_delivery || null
  }));
  return {
    statusCategory: d.connote_state || '',
    entries,
    detail: { history, receiver: d.connote_receiver_name || null, city: null }
  };
}

// Sama persis dengan heuristik di api/cron-check-resi.js — disinkron manual (tidak ada build step)
function trMapTrackingStage({ resi, statusCategory, entries }) {
  if (!resi) return { stage: 'MENUNGGU_RESI', step: 1 };
  const cat = (statusCategory || '').toUpperCase();
  const arr = Array.isArray(entries) ? entries : [];
  const latest = arr.length ? arr[arr.length - 1] : null;
  const latestDesc = (latest?.desc || '').toLowerCase();
  let reachedStep = 2;
  arr.forEach(e => {
    if (trIsPickupPhase(e)) return;
    const d = (e.desc || '').toLowerCase();
    if (/sedang diantar|dalam pengantaran|out for delivery|kurir menuju|\botw\b|akan dikirim ke alamat penerima|with delivery courier|delivery courier|diantar ke alamat|on delivery|1st attempt|2nd attempt|percobaan/i.test(d)) reachedStep = Math.max(reachedStep, 4);
    else if (e.atDestination || /kota tujuan|gudang tujuan|tiba di kota|received at destination|received at warehouse|process and forward|inbound|sti-dest/i.test(d)) reachedStep = Math.max(reachedStep, 3);
  });

  let stage;
  if (cat.includes('RETUR') || cat.includes('RETURN') || arr.some(e => /retur|dikembalikan|\brts\b|\brto\b|return to sender/i.test(e.desc||''))) {
    stage = 'RETUR';
  } else if (cat === 'DELIVERED' || (/diterima oleh|\bdelivered\b|\bpod\b/.test(latestDesc) && !trIsSelfReceipt(latest)) || trHasReceivedBy(latest)) {
    stage = 'SAMPAI';
  } else {
    const hasStructuredProblem = arr.some(e => !trIsPickupPhase(e) && (e.group === 'UNDELIVERED' || e.tag === 'actionRequired' || !!e.reasonDelivery));
    if (hasStructuredProblem || arr.some(e => !trIsPickupPhase(e) && !e.isPos && /gagal|kendala|bermasalah|problematic|tidak ditemukan|alamat tidak (lengkap|dikenal)|tidak ada orang|tidak ditempat|tidak dihuni|menunggu konfirmasi|disimpan di gudang|ditolak|pindah alamat|box undel/i.test(e.desc||''))) {
      stage = 'BERMASALAH';
    } else if (reachedStep >= 4) {
      stage = 'OTW';
    } else if (reachedStep >= 3) {
      stage = 'KOTA_TUJUAN';
    } else {
      stage = 'DIKIRIM';
    }
  }
  return { stage, step: stage === 'SAMPAI' ? 5 : reachedStep };
}

// Cek satu resi ke Mengantar/POS on-demand dari browser, kembalikan { stage, step, detail } atau null
async function checkResiTracking(resi, ekspedisi) {
  if (!resi) return null;
  const eks = (ekspedisi || '').toUpperCase();
  try {
    let normalized;
    if (eks === 'POS' || eks.includes('POS')) {
      const r = await fetch('/api/pos-tracking?resi=' + encodeURIComponent(resi));
      normalized = _trNormalizePos(await r.json());
    } else {
      const courier = TR_COURIER_MAP[ekspedisi] || TR_COURIER_MAP[eks] || ekspedisi;
      if (!courier) return null;
      const r = await fetch('/api/tracking?tracking_number=' + encodeURIComponent(resi) + '&courier=' + encodeURIComponent(courier));
      normalized = _trNormalizeMengantar(await r.json());
    }
    if (!normalized) return null;
    const { stage, step } = trMapTrackingStage({ resi, ...normalized });
    return { stage, step, detail: normalized.detail };
  } catch (e) {
    return null;
  }
}

// ── WA TEMPLATE ──────────────────────────────────────────────────────────────
let waTemplate = null;
const WA_TEMPLATE_DEFAULT = `Halo {nama} 👋\n\nPaket kamu sedang mengalami kendala pengiriman nih.\n\n📦 Resi: {resi} ({ekspedisi})\n⚠️ Kendala: {masalah}\n\nBisa tolong konfirmasi alamat / ketersediaan kamu biar kurir bisa kirim ulang?\n\nTerima kasih 🙏`;

async function loadWaTemplate() {
  try {
    const { data } = await sbSS.from('wa_template').select('template_text').eq('key','bermasalah').single();
    if (data?.template_text) waTemplate = data.template_text;
  } catch(e) { /* pakai default */ }
}

function extractMasalah(row) {
  const detail = row.status_resi_detail;
  if (!detail) return 'Kendala pengiriman';
  const history = Array.isArray(detail.history) ? [...detail.history].reverse() : [];
  const PROBLEM = /gagal|kendala|bermasalah|tidak ditemukan|alamat tidak|tidak ada orang|tidak ditempat|tidak dihuni|menunggu konfirmasi|disimpan di gudang|ditolak|pindah alamat/i;
  for (const h of history) {
    const desc = (h.desc || h.content || '').trim();
    if (!desc) continue;
    const group = (h.type && h.type.group) || '';
    const tag   = (h.type && h.type.tag)   || '';
    if (group === 'UNDELIVERED' || tag === 'actionRequired' || PROBLEM.test(desc)) return desc;
  }
  const latest = history[0];
  return (latest && (latest.desc || latest.content || '').trim()) || 'Kendala pengiriman';
}

function trBuildWaUrl(row) {
  const tpl = waTemplate || WA_TEMPLATE_DEFAULT;
  const eks  = extractEkspedisi(row.pembayaran) || row.pembayaran || '';
  const msg  = tpl
    .replace(/{nama}/g,      row.nama   || '')
    .replace(/{resi}/g,      row.resi   || '')
    .replace(/{ekspedisi}/g, eks)
    .replace(/{masalah}/g,   extractMasalah(row))
    .replace(/{produk}/g,    row.jumlah || '');
  let hp = (row.hp || '').replace(/\D/g, '');
  if (hp.startsWith('0'))        hp = '62' + hp.slice(1);
  else if (!hp.startsWith('62')) hp = '62' + hp;
  return `https://wa.me/${hp}?text=${encodeURIComponent(msg)}`;
}

// ── TRACKING DATE RANGE PICKER ───────────────────────────────────────────────
let trkDrpSelStart = null, trkDrpSelEnd = null, trkDrpPickingEnd = false;
let trkDrpViewYear = new Date().getFullYear(), trkDrpViewMonth = new Date().getMonth();
let trkDrpStart = null, trkDrpEnd = null;

// Init default: 30 hari terakhir
(function() {
  trkDrpSelStart = new Date(Date.now() - 29*864e5); trkDrpSelStart.setHours(0,0,0,0);
  trkDrpSelEnd   = new Date(); trkDrpSelEnd.setHours(23,59,59,999);
  trkDrpStart = trkDrpSelStart.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  trkDrpEnd   = trkDrpSelEnd.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
})();

function trkDrpToggle() {
  const dd = document.getElementById('trk-drp-dropdown');
  dd.classList.toggle('open');
  if (dd.classList.contains('open')) { trkDrpRender(); document.addEventListener('click', trkDrpOutside); }
  else document.removeEventListener('click', trkDrpOutside);
}

function trkDrpClose() {
  document.getElementById('trk-drp-dropdown').classList.remove('open');
  document.removeEventListener('click', trkDrpOutside);
}

function trkDrpOutside(e) {
  const dd = document.getElementById('trk-drp-dropdown');
  const tr = document.getElementById('trk-drp-trigger');
  if (dd && tr && !dd.contains(e.target) && !tr.contains(e.target)) trkDrpClose();
}

function trkDrpPreset(days, label, btn) {
  trkDrpSelStart = new Date(Date.now() - (days-1)*864e5); trkDrpSelStart.setHours(0,0,0,0);
  trkDrpSelEnd   = new Date(); trkDrpSelEnd.setHours(23,59,59,999);
  document.querySelectorAll('.trk-drp-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  trkDrpUpdateSel(); trkDrpRender();
}

function trkDrpPresetYesterday(btn) {
  trkDrpSelStart = new Date(Date.now()-864e5); trkDrpSelStart.setHours(0,0,0,0);
  trkDrpSelEnd   = new Date(Date.now()-864e5); trkDrpSelEnd.setHours(23,59,59,999);
  document.querySelectorAll('.trk-drp-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  trkDrpUpdateSel(); trkDrpRender();
}

function trkDrpPresetThisMonth(btn) {
  trkDrpSelStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  trkDrpSelEnd   = new Date(); trkDrpSelEnd.setHours(23,59,59,999);
  document.querySelectorAll('.trk-drp-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  trkDrpUpdateSel(); trkDrpRender();
}

function trkDrpPresetLastMonth(btn) {
  const n = new Date();
  trkDrpSelStart = new Date(n.getFullYear(), n.getMonth()-1, 1);
  trkDrpSelEnd   = new Date(n.getFullYear(), n.getMonth(), 0); trkDrpSelEnd.setHours(23,59,59,999);
  document.querySelectorAll('.trk-drp-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  trkDrpUpdateSel(); trkDrpRender();
}

function trkDrpUpdateSel() {
  document.getElementById('trk-drp-sel-start').textContent = drpFmt(trkDrpSelStart);
  document.getElementById('trk-drp-sel-end').textContent   = drpFmt(trkDrpSelEnd);
}

function trkDrpApply() {
  if (!trkDrpSelStart) return;
  const s = trkDrpSelStart;
  const e = trkDrpSelEnd || trkDrpSelStart;
  e.setHours(23,59,59,999);
  trkDrpStart = s.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  trkDrpEnd   = e.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const label = trkDrpStart === trkDrpEnd
    ? drpFmt(s)
    : drpFmt(s) + ' — ' + drpFmt(e);
  document.getElementById('trk-drp-label').textContent = label;
  trkDrpClose();
  loadTracking();
}

function trkDrpClickDay(y, m, d) {
  const clicked = new Date(y, m, d);
  if (!trkDrpSelStart || (trkDrpSelStart && trkDrpSelEnd)) {
    trkDrpSelStart = clicked; trkDrpSelEnd = null; trkDrpPickingEnd = true;
  } else {
    if (clicked < trkDrpSelStart) { trkDrpSelEnd = trkDrpSelStart; trkDrpSelStart = clicked; }
    else trkDrpSelEnd = clicked;
    trkDrpPickingEnd = false;
  }
  trkDrpUpdateSel(); trkDrpRender();
}

function trkDrpRender() {
  const y = trkDrpViewYear, m = trkDrpViewMonth;
  const firstDay    = new Date(y, m, 1).getDay();
  const startPad    = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const prevDays    = new Date(y, m, 0).getDate();
  const today       = new Date(); today.setHours(0,0,0,0);

  let html = `<div class="drp-cal-hdr">
    <button class="drp-nav" onclick="trkDrpNav(-1)">‹</button>
    <div class="drp-cal-title">${MONTHS_ID[m]} ${y}</div>
    <button class="drp-nav" onclick="trkDrpNav(1)">›</button>
  </div>
  <div class="drp-days-hdr">${DAYS_ID.map(d => '<span>' + d + '</span>').join('')}</div>
  <div class="drp-days">`;

  for (let i = startPad; i > 0; i--) {
    html += `<button class="drp-day other-month" onclick="trkDrpNav(-1)">${prevDays-i+1}</button>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cur     = new Date(y, m, d);
    const isToday = cur.getTime() === today.getTime();
    const isStart = trkDrpSelStart && cur.getTime() === new Date(trkDrpSelStart.getFullYear(), trkDrpSelStart.getMonth(), trkDrpSelStart.getDate()).getTime();
    const isEnd   = trkDrpSelEnd   && cur.getTime() === new Date(trkDrpSelEnd.getFullYear(),   trkDrpSelEnd.getMonth(),   trkDrpSelEnd.getDate()).getTime();
    const inRange = trkDrpSelStart && trkDrpSelEnd && cur > trkDrpSelStart && cur < trkDrpSelEnd;

    let cls = 'drp-day';
    if (isStart && isEnd) cls += ' selected';
    else if (isStart)     cls += ' range-start';
    else if (isEnd)       cls += ' range-end';
    else if (inRange)     cls += ' in-range';
    if (isToday) cls += ' today';

    html += `<button class="${cls}" onclick="trkDrpClickDay(${y},${m},${d})">${d}</button>`;
  }

  const total = startPad + daysInMonth;
  const rem   = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let d = 1; d <= rem; d++) {
    html += `<button class="drp-day other-month" onclick="trkDrpNav(1)">${d}</button>`;
  }
  html += '</div>';
  document.getElementById('trk-drp-cal').innerHTML = html;
}

function trkDrpNav(dir) {
  trkDrpViewMonth += dir;
  if (trkDrpViewMonth > 11) { trkDrpViewMonth = 0; trkDrpViewYear++; }
  if (trkDrpViewMonth < 0)  { trkDrpViewMonth = 11; trkDrpViewYear--; }
  trkDrpRender();
}

// Tabs status — sama persis dengan CRM (BELUM_DICEK sengaja tidak punya tab sendiri, cuma nongol di "Semua")
const TR_TABS = [
  { key:'SEMUA',         label:'Semua' },
  { key:'MENUNGGU_RESI', label:'⏳ Menunggu Resi' },
  { key:'DIKIRIM',       label:'🚚 Dikirim' },
  { key:'KOTA_TUJUAN',   label:'🏙️ Kota Tujuan' },
  { key:'OTW',           label:'🛵 OTW' },
  { key:'SAMPAI',        label:'✅ Sampai' },
  { key:'BERMASALAH',    label:'⚠️ Bermasalah' },
  { key:'RETUR',         label:'↩️ Retur' },
];
const TR_ON_PROSES_STAGES = ['MENUNGGU_RESI','BELUM_DICEK','DIKIRIM','KOTA_TUJUAN','OTW'];
let trFilterStage = 'SEMUA';

function trSetFilter(key) {
  trFilterStage = key;
  renderTrkTabs();
  applyTrkFilter();
}

function renderTrkTabs() {
  const wrap = document.getElementById('trk-tabs');
  if (!wrap) return;
  wrap.innerHTML = TR_TABS.map(t =>
    `<div class="tr-tab ${trFilterStage===t.key?'tr-tab-active':''}" onclick="trSetFilter('${t.key}')">${t.label}</div>`
  ).join('');
  const cardMap = { SEMUA:'SEMUA', ON_PROSES:'ON_PROSES_GROUP', BERMASALAH:'BERMASALAH', RETUR:'RETUR', SAMPAI:'SAMPAI' };
  Object.entries(cardMap).forEach(([cardKey, filterKey]) => {
    document.getElementById('trk-stat-'+cardKey)?.classList.toggle('tr-stat-active', trFilterStage===filterKey);
  });
}

// Ambil order (dari orderan_masuk_crm) + status tracking live-nya (all_orderan + cs_order_tracking_crm), keyed by HP+tanggal.
// Dipakai bareng oleh loadTracking() (halaman Tracking Order) dan loadDashboard() (banner notif Bermasalah/Retur).
async function trFetchTrackingRows(masukList, range) {
  if (!masukList.length) return [];

  // 1. Kumpulkan HP+tanggal dari orderan_masuk_crm, build lookup map
  const hpTanggalMap = {};
  const hpVariantSet = new Set();
  masukList.forEach(r => {
    const hp = normalizeHP(r.hp);
    if (!hp) return;
    if (!hpTanggalMap[hp]) hpTanggalMap[hp] = new Set();
    if (r.tanggal) hpTanggalMap[hp].add(r.tanggal.slice(0, 10));
    hpVariants(r.hp).forEach(v => hpVariantSet.add(v));
  });

  const hpList = [...hpVariantSet];
  if (!hpList.length) return [];

  // 2. Batch query all_orderan: split hpList per 100 item, query paralel, hindari URL terlalu panjang
  const CHUNK = 100;
  const chunks = [];
  for (let i = 0; i < hpList.length; i += CHUNK) chunks.push(hpList.slice(i, i + CHUNK));

  const chunkResults = await Promise.all(chunks.map(chunk => {
    let q = sb.from('all_orderan')
      .select('no, tanggal, nama, hp, jumlah, pembayaran, resi, kabupaten, status_akhir')
      .eq('sumber', 'cs_input')
      .in('hp', chunk)
      .limit(500);
    if (range?.start) q = q.gte('tanggal', range.start);
    if (range?.end)   q = q.lte('tanggal', range.end);
    return q.order('tanggal', { ascending: false });
  }));

  const allData = [];
  for (const res of chunkResults) {
    if (res.error) throw res.error;
    allData.push(...(res.data || []));
  }

  // 3. Filter: pastikan HP+tanggal cocok persis dengan orderan_masuk_crm CS ini
  const filtered = allData.filter(r => {
    const tgl = (r.tanggal || '').slice(0, 10);
    return hpTanggalMap[normalizeHP(r.hp)]?.has(tgl);
  });

  // 3.5: Isi resi yang kosong — cari di all_orderan by HP+tanggal (any sumber)
  const emptyResiRows = filtered.filter(r => !r.resi);
  if (emptyResiRows.length) {
    const emptyHpSet = new Set();
    emptyResiRows.forEach(r => {
      const hp = String(r.hp || '');
      emptyHpSet.add(hp);
      emptyHpSet.add(hp.replace(/^0+/, ''));
      if (!hp.startsWith('0')) emptyHpSet.add('0' + hp);
    });
    const { data: resiLookup } = await sb.from('all_orderan')
      .select('hp, tanggal, resi')
      .in('hp', [...emptyHpSet])
      .not('resi', 'is', null)
      .neq('resi', '')
      .gte('tanggal', range?.start || '')
      .lte('tanggal', range?.end || '9999-12-31');
    const resiByHpTgl = {};
    (resiLookup || []).forEach(r => {
      if (!r.resi) return;
      const key = normalizeHP(String(r.hp || '')) + '_' + (r.tanggal || '').slice(0, 10);
      if (!resiByHpTgl[key]) resiByHpTgl[key] = r.resi;
    });
    filtered.forEach(r => {
      if (r.resi) return;
      const key = normalizeHP(String(r.hp || '')) + '_' + (r.tanggal || '').slice(0, 10);
      if (resiByHpTgl[key]) r.resi = resiByHpTgl[key];
    });
  }

  // 4. Merge status tracking dari cs_order_tracking_crm, keyed by resi
  const resiList = [...new Set(filtered.map(r => (r.resi || '').trim()).filter(Boolean))];
  let trkByResi = {};
  if (resiList.length) {
    const RESI_CHUNK = 500;
    for (let i = 0; i < resiList.length; i += RESI_CHUNK) {
      const { data: trkData } = await sb.from('cs_order_tracking_crm')
        .select('resi, ekspedisi, status_resi, status_resi_step, status_resi_updated_at, status_resi_detail')
        .in('resi', resiList.slice(i, i + RESI_CHUNK));
      (trkData || []).forEach(t => { trkByResi[t.resi] = t; });
    }
  }
  filtered.forEach(r => {
    const t = r.resi ? trkByResi[r.resi.trim()] : null;
    r.status_resi            = t?.status_resi            || null;
    r.status_resi_step       = t?.status_resi_step        || null;
    r.status_resi_updated_at = t?.status_resi_updated_at  || null;
    r.status_resi_detail     = t?.status_resi_detail      || null;
  });

  return filtered;
}

async function loadTracking() {
  if (!currentUser) return;

  renderTrkTabs();

  const trkStart = trkDrpStart || todayStr();
  const trkEnd   = trkDrpEnd   || todayStr();

  const cardsEl = document.getElementById('trk-cards');
  if (cardsEl) cardsEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:13px;grid-column:1/-1">Memuat data...</div>';

  try {
    const { data: masukData, error: masukErr } = await sb.from('orderan_masuk_crm')
      .select('hp, nama, tanggal')
      .eq('cs_id', currentUser.id)
      .gte('tanggal', trkStart)
      .lte('tanggal', trkEnd);

    if (masukErr) throw masukErr;

    const masukList = masukData || [];
    if (!masukList.length) {
      trkAllData = [];
      updateTrkCards([]);
      document.getElementById('trk-alerts').innerHTML = '';
      document.getElementById('trk-info').textContent = '0 data';
      if (cardsEl) cardsEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:13px;grid-column:1/-1">Tidak ada orderan di periode ini.</div>';
      return;
    }

    trkAllData = await trFetchTrackingRows(masukList, { start: trkStart, end: trkEnd });

    updateTrkCards(trkAllData);
    showTrkAlerts(trkAllData);
    applyTrkFilter();

  } catch(e) {
    showToast('Gagal load tracking: ' + e.message, 'error');
    if (cardsEl) cardsEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:13px;grid-column:1/-1">Gagal memuat data.</div>';
  }
}

function applyTrkFilter() {
  const eksF   = document.getElementById('trk-filter-eks')?.value    || '';
  const search = (document.getElementById('trk-search')?.value || '').toLowerCase();

  let filtered = trkAllData.filter(r => {
    const stage = trEffectiveStage(r);
    if (trFilterStage === 'ON_PROSES_GROUP') {
      if (!TR_ON_PROSES_STAGES.includes(stage)) return false;
    } else if (trFilterStage !== 'SEMUA' && stage !== trFilterStage) {
      return false;
    }
    return true;
  });

  if (eksF)    filtered = filtered.filter(r => extractEkspedisi(r.pembayaran) === eksF);
  if (search)  filtered = filtered.filter(r =>
    (r.nama   || '').toLowerCase().includes(search) ||
    (r.hp     || '').includes(search)               ||
    (r.resi   || '').toLowerCase().includes(search)
  );

  renderTrkCards(filtered);
  const info = filtered.length < trkAllData.length
    ? `${filtered.length} dari ${trkAllData.length} data`
    : `${trkAllData.length} data`;
  document.getElementById('trk-info').textContent = info;
}

function trBadgeHtml(row) {
  const stage = trEffectiveStage(row);
  const meta  = TR_STAGE_META[stage];
  const ago   = row.status_resi_updated_at ? ` <span style="opacity:.6;font-weight:400">· ${trTimeAgo(row.status_resi_updated_at)}</span>` : '';
  return `<span class="badge" style="background:${meta.bg};color:${meta.color}">${meta.label}${ago}</span>`;
}

function trStepperHtml(row) {
  const stage    = trEffectiveStage(row);
  const meta     = TR_STAGE_META[stage];
  const step     = row.status_resi_step || meta.step;
  const allDone  = stage === 'SAMPAI';
  return `<div class="tr-stepper">${TR_STEP_LABELS.map((label, i) => {
    const idx = i + 1;
    let cls = 'tr-step';
    if (allDone || idx < step) cls += ' tr-step-done';
    else if (idx === step) cls += meta.problem ? ' tr-step-problem' : ' tr-step-active';
    const icon = (allDone || idx < step) ? '✓' : idx;
    return `<div class="${cls}"><div class="tr-step-line"></div><div class="tr-step-circle">${icon}</div><div class="tr-step-label">${label}</div></div>`;
  }).join('')}</div>`;
}

function updateTrkCards(list) {
  const total     = list.length;
  const proses    = list.filter(r => trCardState(trEffectiveStage(r)) === 'proses').length;
  const undell    = list.filter(r => trCardState(trEffectiveStage(r)) === 'undell').length;
  const delivered = list.filter(r => trCardState(trEffectiveStage(r)) === 'delivered').length;
  const retur     = list.filter(r => trCardState(trEffectiveStage(r)) === 'retur').length;
  document.getElementById('trk-total').textContent     = total     || '—';
  document.getElementById('trk-proses').textContent    = proses    || '—';
  document.getElementById('trk-undell').textContent    = undell    || '—';
  document.getElementById('trk-delivered').textContent = delivered || '—';
  document.getElementById('trk-retur').textContent     = retur     || '—';
}

function showTrkAlerts(list) {
  const wrap = document.getElementById('trk-alerts');
  if (!wrap) return;

  const alerts = [];

  const undellCount = list.filter(r => trCardState(trEffectiveStage(r)) === 'undell').length;
  if (undellCount > 0) {
    alerts.push(`<div class="trk-alert trk-alert-warn">⚠️ <strong>${undellCount} paket</strong> berstatus Bermasalah — segera hubungi customer untuk konfirmasi pengiriman ulang.</div>`);
  }

  // On Proses > 7 hari
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const oldProses = list.filter(r =>
    trCardState(trEffectiveStage(r)) === 'proses' &&
    r.tanggal && r.tanggal < cutoffStr
  ).length;
  if (oldProses > 0) {
    alerts.push(`<div class="trk-alert trk-alert-info">🕐 <strong>${oldProses} paket</strong> masih On Proses lebih dari 7 hari — cek resi atau konfirmasi ke ekspedisi.</div>`);
  }

  wrap.innerHTML = alerts.join('');
}

function renderTrkCards(list) {
  const wrap = document.getElementById('trk-cards');
  if (!wrap) return;
  if (!list.length) {
    wrap.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:13px;grid-column:1/-1">Tidak ada data yang cocok.</div>';
    return;
  }
  wrap.innerHTML = list.map(r => {
    const eks      = extractEkspedisi(r.pembayaran) || r.pembayaran || '';
    const hp08     = r.hp ? (r.hp.startsWith('0') ? r.hp : '0' + r.hp) : '—';
    const cat      = trCardState(trEffectiveStage(r));
    const cardCls  = cat === 'delivered' ? 'oc-kirim' : cat === 'retur' ? 'oc-rts' : cat === 'undell' ? 'oc-hold' : '';
    const resiPart = r.resi
      ? `<span class="trk-resi-link" style="font-size:11px">${r.resi} ↗</span>`
      : '<span style="color:var(--muted);font-size:11px">Belum ada resi</span>';
    const isBermasalah = trEffectiveStage(r) === 'BERMASALAH';
    const waBtnHtml = (isBermasalah && r.hp)
      ? `<a href="${trBuildWaUrl(r)}" target="_blank" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;gap:4px;background:#25D366;color:#fff;font-size:11px;font-weight:600;padding:4px 9px;border-radius:6px;text-decoration:none;white-space:nowrap">💬 WA Customer</a>`
      : '';
    return `<div class="order-card ${cardCls}"${r.resi ? ` onclick="trOpenDetail('${r.resi.replace(/'/g,"\\'")}')" style="cursor:pointer"` : ''}>
      <div class="oc-header">
        <span class="oc-nama">${r.nama || '—'}</span>
        <span class="oc-waktu">${r.tanggal || ''}</span>
      </div>
      <div class="oc-row">
        <span class="oc-hp">📱 ${hp08}</span>
        <span style="color:var(--border-strong)">·</span>
        <span style="font-size:12px">${eks}</span>
      </div>
      <div class="oc-row" style="margin-top:2px">${resiPart}</div>
      ${trStepperHtml(r)}
      <div class="oc-footer">
        <span style="font-size:12px;color:var(--muted)">${r.jumlah || ''}</span>
        <div style="display:flex;gap:6px;align-items:center">${waBtnHtml}${trBadgeHtml(r)}</div>
      </div>
    </div>`;
  }).join('');
}

// ── MODAL DETAIL RESI ─────────────────────────────────────────────────────────
let trModalResi = null;

function trOpenDetail(resi) {
  const row = trkAllData.find(r => r.resi === resi);
  if (!row) return;
  trModalResi = resi;

  const eks = extractEkspedisi(row.pembayaran) || row.pembayaran || '';
  document.getElementById('tr-modal-title').textContent = row.nama || 'Detail Pengiriman';
  document.getElementById('tr-modal-sub').textContent = (row.resi ? row.resi + ' · ' : '') + eks;

  const detail  = row.status_resi_detail || null;
  const history = detail && Array.isArray(detail.history) ? detail.history.slice().reverse() : [];
  const meta    = TR_STAGE_META[trEffectiveStage(row)];

  let historyHtml = '<div style="font-size:12px;color:var(--muted);margin-top:12px">Belum ada history — klik "Cek Ulang".</div>';
  if (history.length) {
    historyHtml = `<div style="margin-top:14px">${history.map((h,i) => `
      <div class="tr-history-item">
        <div class="tr-history-dot" style="background:${i===0 ? meta.color : 'var(--border-strong)'}"></div>
        <div>
          <div style="font-size:12.5px;${i===0?'font-weight:700':''}">${(h.desc || h.content || h.content2 || '-')}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${h.date || ''}${h.location_name ? ' · '+h.location_name : ''}</div>
        </div>
      </div>`).join('')}</div>`;
  }

  const isBermasalah = trEffectiveStage(row) === 'BERMASALAH';
  document.getElementById('tr-modal-body').innerHTML = `
    <div style="margin-top:10px">${trBadgeHtml(row)}</div>
    ${trStepperHtml(row)}
    ${historyHtml}
  `;
  const actionsEl = document.getElementById('tr-modal-actions');
  if (actionsEl) {
    actionsEl.innerHTML = `
      ${(isBermasalah && row.hp) ? `<a href="${trBuildWaUrl(row)}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;background:#25D366;color:#fff;font-size:13px;font-weight:600;padding:8px 16px;border-radius:8px;text-decoration:none">💬 WA Customer</a>` : ''}
      <button class="btn-secondary" onclick="trManualCheckFromModal()">🔄 Cek Ulang</button>
    `;
  }
  document.getElementById('tr-modal').style.display = 'flex';
}

function trCloseModal() {
  document.getElementById('tr-modal').style.display = 'none';
  trModalResi = null;
}

async function trSaveTracking(resi, ekspedisi, result) {
  await sb.from('cs_order_tracking_crm').upsert({
    resi,
    ekspedisi,
    status_resi: result.stage,
    status_resi_step: result.step,
    status_resi_updated_at: new Date().toISOString(),
    status_resi_detail: result.detail
  }, { onConflict: 'resi' });
}

async function trManualCheckFromModal() {
  const row = trkAllData.find(r => r.resi === trModalResi);
  if (!row) return;
  if (!row.resi) { showToast('Belum ada resi untuk order ini.', 'error'); return; }
  const eks = extractEkspedisi(row.pembayaran) || row.pembayaran;
  const result = await checkResiTracking(row.resi, eks);
  if (!result) { showToast('Gagal cek resi — pastikan ekspedisi terisi & resi valid.', 'error'); return; }
  await trSaveTracking(row.resi, eks, result);
  row.status_resi            = result.stage;
  row.status_resi_step       = result.step;
  row.status_resi_updated_at = new Date().toISOString();
  row.status_resi_detail     = result.detail;
  trOpenDetail(row.resi);
  updateTrkCards(trkAllData);
  applyTrkFilter();
}

async function trRefreshAll() {
  const btn = document.getElementById('trk-refresh-all-btn');
  if (!btn) return;
  const btns = [btn];
  const origLabel = btn.textContent;
  btn.disabled = true;
  try {
    const targets = trkAllData.filter(r => r.resi && r.status_resi !== 'SAMPAI' && r.status_resi !== 'RETUR');
    if (!targets.length) { showToast('Tidak ada resi yang perlu dicek.', 'info'); return; }
    const BATCH = 5;
    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH);
      await Promise.all(batch.map(async row => {
        const eks = extractEkspedisi(row.pembayaran) || row.pembayaran;
        const result = await checkResiTracking(row.resi, eks);
        if (!result) return;
        await trSaveTracking(row.resi, eks, result);
        row.status_resi            = result.stage;
        row.status_resi_step       = result.step;
        row.status_resi_updated_at = new Date().toISOString();
        row.status_resi_detail     = result.detail;
      }));
      const progress = `Mengecek... (${Math.min(i+BATCH, targets.length)}/${targets.length})`;
      btns.forEach(b => b.textContent = progress);
    }
    updateTrkCards(trkAllData);
    showTrkAlerts(trkAllData);
    applyTrkFilter();
    showToast(`✅ Selesai cek ${targets.length} resi!`, 'success');
  } finally {
    btns.forEach(b => { b.disabled = false; b.textContent = origLabel; });
  }
}
