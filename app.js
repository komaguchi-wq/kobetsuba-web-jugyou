// ============================================================
// コベツバ学習アプリ
// ============================================================

let currentUser = null;
let categories = [];
let currentCategory = null;
let currentUnits = [];
let currentUnit = null;
let unitData = null;
let currentPointData = null;
let currentFilter = 'all';
let filteredQuestionIds = null;

// Google Sheets バックアップ用
let SHEETS_API_URL = localStorage.getItem("kobetsuba-sheets-api-url") || "";

// ============================================================
// Screen management & hash routing
// ============================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

// allUnits: flat array of { catId, catName, unitId, unitTitle, _data }
let allUnits = [];

function updateHash() {
  let hash = '';
  if (currentUser) {
    hash = currentUser;
    if (currentCategory && currentUnit) {
      hash += '/' + currentCategory.id + '/' + currentUnit.id;
      if (currentPointData) {
        hash += '/' + currentPointData.id;
      }
    }
  }
  location.hash = hash;
}

async function restoreFromHash() {
  const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (!hash) return;
  const parts = hash.split('/');
  if (!parts[0]) return;

  currentUser = parts[0];
  await loadAllUnits();

  if (!parts[1] || !parts[2]) { showScreen('screen-units'); return; }

  const entry = allUnits.find(e => e.catId === parts[1] && e.unitId === parts[2]);
  if (!entry || !entry._data) { showScreen('screen-units'); return; }
  currentCategory = { id: entry.catId, name: entry.catName };
  currentUnit = { id: entry.unitId, title: entry.unitTitle, _data: entry._data };
  unitData = entry._data;
  currentFilter = 'all';
  filteredQuestionIds = null;
  renderUnitDetail();

  if (!parts[3]) { showScreen('screen-unit-detail'); return; }
  const point = unitData.points.find(p => p.id === parts[3]);
  if (point) {
    currentPointData = point;
    showingPointAnswer = false;
    pointFilter = 'all';
    pointFilteredIds = null;
    renderPointDetail(point, 'point');
    showScreen('screen-point-detail');
  } else if (unitData.test && unitData.test.id === parts[3]) {
    currentPointData = unitData.test;
    showingPointAnswer = false;
    pointFilter = 'all';
    pointFilteredIds = null;
    renderPointDetail(unitData.test, 'test');
    showScreen('screen-point-detail');
  } else {
    showScreen('screen-unit-detail');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (location.hash && location.hash !== '#') restoreFromHash();
});

function goBack(level) {
  if (level === 'user') {
    currentUser = null; currentCategory = null; currentUnit = null; currentPointData = null;
    showScreen('screen-user'); location.hash = '';
  }
}

function goBackToUnits() {
  currentUnit = null; currentPointData = null; currentCategory = null;
  renderUnits();
  showScreen('screen-units'); updateHash();
}

function goBackToUnit() {
  flushPendingPointChanges();
  currentPointData = null;
  renderUnitDetail();
  showScreen('screen-unit-detail');
  updateHash();
}

// ============================================================
// User selection
// ============================================================
async function selectUser(name) {
  currentUser = name;
  await loadAllUnits();
  showScreen('screen-units');
  updateHash();
  autoSyncFromSheets();
}

// ============================================================
// Tracking (LocalStorage)
// ============================================================
// Each question: { attempts, correct, firstRikai, currentRikai }
// rikai values: null | 'maru' | 'sankaku' | 'batsu'
function getTrackingKey() { return `kobetsuba-${currentUser}`; }

function getTracking() {
  try { return JSON.parse(localStorage.getItem(getTrackingKey())) || {}; }
  catch { return {}; }
}

function saveTracking(data) {
  localStorage.setItem(getTrackingKey(), JSON.stringify(data));
}

function getQuestionTracking(questionId) {
  const data = getTracking();
  const key = `${currentCategory.id}/${currentUnit.id}/${questionId}`;
  return data[key] || { attempts: 0, correct: 0, firstRikai: null, currentRikai: null };
}

function recordAnswer(questionId, isCorrect) {
  const data = getTracking();
  const key = `${currentCategory.id}/${currentUnit.id}/${questionId}`;
  if (!data[key]) data[key] = { attempts: 0, correct: 0, firstRikai: null, currentRikai: null };
  data[key].attempts++;
  if (isCorrect) data[key].correct++;
  saveTracking(data);
  backupToSheets();
}

function setRikai(questionId, type, value) {
  const data = getTracking();
  const key = `${currentCategory.id}/${currentUnit.id}/${questionId}`;
  if (!data[key]) data[key] = { attempts: 0, correct: 0, firstRikai: null, currentRikai: null };
  if (type === 'first') {
    if (data[key].firstRikai === null) {
      data[key].firstRikai = value;
      // 最新理解度も未設定なら同じ値を初期セット
      if (data[key].currentRikai === null) {
        data[key].currentRikai = value;
      }
    }
  } else {
    data[key].currentRikai = value;
  }
  saveTracking(data);
  backupToSheets();
}

// ============================================================
// Google Sheets バックアップ
// ============================================================
async function backupToSheets() {
  if (!SHEETS_API_URL) return;
  try {
    await fetch(SHEETS_API_URL, {
      method: "POST", mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: currentUser, timestamp: new Date().toISOString(), data: getTracking() })
    });
  } catch (e) { console.warn("Sheets backup failed:", e); }
}

async function restoreFromSheets() {
  if (!SHEETS_API_URL) { alert("URLが未設定です。"); return; }
  if (!confirm("スプレッドシートから復元しますか？")) return;
  try {
    const res = await fetch(SHEETS_API_URL + "?user=" + encodeURIComponent(currentUser));
    const json = await res.json();
    if (json.status !== "ok" || !json.data) { alert("復元失敗"); return; }
    const current = getTracking();
    for (const key in json.data) current[key] = json.data[key];
    saveTracking(current);
    alert("復元しました");
    if (currentUnit) renderUnitDetail();
  } catch (e) { alert("復元失敗: " + e.message); }
}

async function autoSyncFromSheets() {
  if (!SHEETS_API_URL) return;
  try {
    const res = await fetch(SHEETS_API_URL + "?user=" + encodeURIComponent(currentUser));
    const json = await res.json();
    if (json.status !== "ok" || !json.data) return;
    const current = getTracking();
    let changed = false;
    for (const key in json.data) {
      const remote = json.data[key];
      const local = current[key];
      if (!local || remote.attempts > local.attempts) {
        current[key] = remote;
        changed = true;
      }
    }
    if (changed) {
      saveTracking(current);
      if (currentUnit) renderUnitDetail();
    }
  } catch (e) { console.warn("Auto-sync failed:", e); }
}

function openSettings() {
  document.getElementById("settings-url").value = SHEETS_API_URL;
  showScreen("screen-settings");
}

function saveSettings() {
  SHEETS_API_URL = document.getElementById("settings-url").value.trim();
  localStorage.setItem("kobetsuba-sheets-api-url", SHEETS_API_URL);
  alert("保存しました");
}

// ============================================================
// Load all categories + units
// ============================================================
async function loadAllUnits() {
  const resp = await fetch('categories.json');
  categories = await resp.json();
  allUnits = [];
  for (const cat of categories) {
    try {
      const uResp = await fetch(`categories/${cat.id}/units.json`);
      const units = await uResp.json();
      for (const u of units) {
        try {
          const r = await fetch(`categories/${cat.id}/units/${u.id}/unit.json`);
          const json = await r.json();
          allUnits.push({ catId: cat.id, catName: cat.name, catIcon: cat.icon, unitId: u.id, unitTitle: u.title, _data: json });
        } catch (e) {
          allUnits.push({ catId: cat.id, catName: cat.name, catIcon: cat.icon, unitId: u.id, unitTitle: u.title, _data: null });
        }
      }
    } catch (e) { /* skip */ }
  }
  renderUnits();
}

function getAllQuestions(data) {
  if (!data) return [];
  const qs = [];
  if (data.points) {
    for (const p of data.points) {
      if (p.questions) {
        for (const q of p.questions) qs.push(q);
      }
    }
  }
  if (data.test && data.test.questions) {
    for (const q of data.test.questions) qs.push(q);
  }
  return qs;
}

function getUnitStats(catId, unitId, data) {
  if (!data) return { total: 0, attempted: 0, correct: 0, totalAttempts: 0, rate: -1 };
  const qs = getAllQuestions(data);
  const tracking = getTracking();
  let total = qs.length, attempted = 0, correct = 0, totalAttempts = 0;
  for (const q of qs) {
    const key = `${catId}/${unitId}/${q.id}`;
    const t = tracking[key];
    if (t && t.attempts > 0) {
      attempted++;
      correct += t.correct;
      totalAttempts += t.attempts;
    }
  }
  const rate = totalAttempts > 0 ? Math.round(correct / totalAttempts * 100) : -1;
  return { total, attempted, correct, totalAttempts, rate };
}

function renderUnits() {
  document.getElementById('user-badge-units').textContent = currentUser;
  const list = document.getElementById('unit-list');
  let html = '';
  let lastCatId = null;

  for (const entry of allUnits) {
    // Grade heading
    if (entry.catId !== lastCatId) {
      lastCatId = entry.catId;
      html += `<h3 class="grade-heading">グレード${entry.catIcon} — ${entry.catName}</h3>`;
    }

    const stats = getUnitStats(entry.catId, entry.unitId, entry._data);
    const rateClass = stats.rate < 0 ? 'acc-none' : stats.rate >= 80 ? 'acc-high' : stats.rate >= 50 ? 'acc-mid' : 'acc-low';
    const rateText = stats.rate < 0 ? '未回答' : `${stats.rate}%`;

    html += `
      <div class="card" onclick="openUnit('${entry.catId}', '${entry.unitId}')">
        <div class="card-title">${entry.unitTitle}</div>
        <div class="card-stats">
          <div class="stat">例題数: <span class="stat-value">${stats.total}</span></div>
          <div class="stat">回答済: <span class="stat-value">${stats.attempted}/${stats.total}</span></div>
          <div class="stat">正答率: <span class="stat-value">${rateText}</span></div>
        </div>
        <div class="accuracy-bar">
          <div class="accuracy-bar-fill ${rateClass}" style="width: ${stats.rate < 0 ? 0 : stats.rate}%"></div>
        </div>
      </div>
    `;
  }

  list.innerHTML = html;
}

// ============================================================
// Unit detail
// ============================================================
async function openUnit(catId, unitId) {
  const entry = allUnits.find(e => e.catId === catId && e.unitId === unitId);
  if (!entry || !entry._data) return;
  currentCategory = { id: entry.catId, name: entry.catName };
  currentUnit = { id: entry.unitId, title: entry.unitTitle, _data: entry._data };
  unitData = entry._data;
  currentPointData = null;
  currentFilter = 'all';
  filteredQuestionIds = null;
  renderUnitDetail();
  showScreen('screen-unit-detail');
  updateHash();
}

function setFilter(mode) {
  currentFilter = mode;
  filteredQuestionIds = null;

  const allQ = getAllQuestions(unitData);
  const tracking = getTracking();

  if (mode === 'below50' || mode === 'below67' || mode === 'below99') {
    const threshold = mode === 'below50' ? 50 : mode === 'below67' ? 67 : 99;
    const filtered = allQ.filter(q => {
      const key = `${currentCategory.id}/${currentUnit.id}/${q.id}`;
      const t = tracking[key];
      if (!t || t.attempts === 0) return true;
      return Math.round(t.correct / t.attempts * 100) <= threshold;
    });
    filteredQuestionIds = new Set(filtered.map(q => q.id));
  } else if (mode === 'first-rikai-below') {
    // 初回理解度△以下 = △ or × or null
    const filtered = allQ.filter(q => {
      const key = `${currentCategory.id}/${currentUnit.id}/${q.id}`;
      const t = tracking[key];
      if (!t || t.firstRikai === null) return true;
      return t.firstRikai === 'sankaku' || t.firstRikai === 'batsu';
    });
    filteredQuestionIds = new Set(filtered.map(q => q.id));
  } else if (mode === 'current-rikai-below') {
    // 現在理解度△以下 = △ or × or null
    const filtered = allQ.filter(q => {
      const key = `${currentCategory.id}/${currentUnit.id}/${q.id}`;
      const t = tracking[key];
      if (!t || t.currentRikai === null) return true;
      return t.currentRikai === 'sankaku' || t.currentRikai === 'batsu';
    });
    filteredQuestionIds = new Set(filtered.map(q => q.id));
  }

  // Update filter button states (unit detail screen only)
  document.querySelectorAll('#screen-unit-detail .mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  updateUnitPointCards();
  updateTestCards();
}

function renderUnitDetail() {
  document.getElementById('user-badge-detail').textContent = currentUser;
  document.getElementById('unit-detail-title').textContent = currentUnit.title;

  // Filter buttons
  document.querySelectorAll('#screen-unit-detail .mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === currentFilter);
  });

  renderPointCards();

  // Test section
  const testSection = document.getElementById('test-section');
  if (unitData.test) {
    const t = unitData.test;
    let testHtml = `
      <div class="test-divider">力試しテスト</div>
      <div class="point-card">
        <div class="point-card-header" onclick="openPoint('${t.id}')">
          <div class="point-number test-icon">T</div>
          <div class="point-info">
            <div class="point-title">${t.title}</div>
            <div class="point-meta">${t.range} / ${t.questions ? t.questions.length + '問' : ''}</div>
          </div>
        </div>
        <div class="unit-qc-row" id="unit-qcards-${t.id}">`;

    if (t.questions) {
      for (const q of t.questions) {
        testHtml += `<div class="qc" data-qid="${q.id}" data-point-id="${t.id}" data-is-test="1">
          <span class="qc-name">${q.label}</span>
          <span class="qc-h">正誤</span>
          <span class="qc-h">初回理解度</span>
          <span class="qc-h">最新理解度</span>
          <span class="qc-rate"></span>
          <span class="qc-ans">
            <button class="qc-btn q-btn-ok" onclick="markUnitAnswer('${q.id}', true, event)">○</button>
            <button class="qc-btn q-btn-ng" onclick="markUnitAnswer('${q.id}', false, event)">×</button>
          </span>
          <span class="qc-rikai" data-qid="${q.id}" data-type="first"></span>
          <span class="qc-rikai" data-qid="${q.id}" data-type="current"></span>
        </div>`;
      }
    }

    testHtml += `</div>
        <div class="point-card-actions">
          <button class="btn btn-print-detail" style="font-size:12px; padding:6px 12px;" onclick="printSinglePoint('${t.id}')">印刷</button>
        </div>
      </div>`;
    testSection.innerHTML = testHtml;
    updateTestCards();
  } else {
    testSection.innerHTML = '';
  }
}

function renderPointCards() {
  const container = document.getElementById('point-list');
  let html = '';

  for (const p of unitData.points) {
    const isNankan = p.type === '難関の型';
    const nankanClass = isNankan ? ' nankan' : '';
    const nankanBadge = isNankan ? '<span class="nankan-badge">難関</span>' : '';
    const videoCount = (p.youtube_ids || []).length
      + (p.questions || []).reduce((sum, q) => sum + (q.youtube_ids || []).length, 0);
    html += `<div class="point-card${nankanClass}">
      <div class="point-card-header" onclick="openPoint('${p.id}')">
        <div class="point-number">${p.number}${nankanBadge}</div>
        <div class="point-info">
          <div class="point-title">${p.title}</div>
          <div class="point-meta">動画${videoCount}本</div>
        </div>
      </div>
      <div class="unit-qc-row" id="unit-qcards-${p.id}">`;

    for (const q of p.questions) {
      html += `<div class="qc" data-qid="${q.id}" data-point-id="${p.id}">
        <span class="qc-name">${q.label}</span>
        <span class="qc-h">正誤</span>
        <span class="qc-h">初回理解度</span>
        <span class="qc-h">最新理解度</span>
        <span class="qc-rate"></span>
        <span class="qc-ans">
          <button class="qc-btn q-btn-ok" onclick="markUnitAnswer('${q.id}', true, event)">○</button>
          <button class="qc-btn q-btn-ng" onclick="markUnitAnswer('${q.id}', false, event)">×</button>
        </span>
        <span class="qc-rikai" data-qid="${q.id}" data-type="first"></span>
        <span class="qc-rikai" data-qid="${q.id}" data-type="current"></span>
      </div>`;
    }

    html += `</div>
      <div class="point-card-actions">
        <button class="btn btn-print-detail" style="font-size:12px; padding:6px 12px;" onclick="printSinglePoint('${p.id}')">印刷</button>
      </div>
    </div>`;
  }

  container.innerHTML = html;
  updateUnitPointCards();
}

function updateUnitPointCards() {
  const tracking = getTracking();
  const cards = document.querySelectorAll('#point-list .qc[data-qid]');

  for (const card of cards) {
    const qId = card.dataset.qid;
    const key = `${currentCategory.id}/${currentUnit.id}/${qId}`;
    const t = tracking[key] || { attempts: 0, correct: 0, firstRikai: null, currentRikai: null };
    const rate = t.attempts > 0 ? Math.round(t.correct / t.attempts * 100) : -1;
    const rateClass = rate < 0 ? 'rate-none' : rate >= 80 ? 'rate-high' : rate >= 50 ? 'rate-mid' : 'rate-low';
    const rateText = rate < 0 ? '-' : rate + '%';
    const attText = t.attempts > 0 ? ` (${t.correct}/${t.attempts})` : '';

    card.querySelector('.qc-rate').innerHTML =
      `<span class="${rateClass}">${rateText}</span><span class="qc-att">${attText}</span>`;

    const firstCell = card.querySelector('.qc-rikai[data-type="first"]');
    const currentCell = card.querySelector('.qc-rikai[data-type="current"]');
    firstCell.innerHTML = rikaiButtonsInlineUnit(qId, 'first', t.firstRikai);
    currentCell.innerHTML = rikaiButtonsInlineUnit(qId, 'current', t.currentRikai);

    const isDimmed = filteredQuestionIds && !filteredQuestionIds.has(qId);
    card.classList.toggle('dimmed', isDimmed);
  }
}

function rikaiButtonsInlineUnit(qId, type, currentVal) {
  if (type === 'first' && currentVal !== null) {
    return rikaiSymbol(currentVal);
  }
  const vals = [
    { key: 'maru', sym: '○', cls: 'rikai-btn-maru' },
    { key: 'sankaku', sym: '△', cls: 'rikai-btn-sankaku' },
    { key: 'batsu', sym: '×', cls: 'rikai-btn-batsu' },
  ];
  return vals.map(v =>
    `<button class="rikai-btn ${v.cls} ${currentVal === v.key ? 'selected' : ''}"
             onclick="doSetRikaiUnit('${qId}', '${type}', '${v.key}')">${v.sym}</button>`
  ).join('');
}

function updateTestCards() {
  const tracking = getTracking();
  const cards = document.querySelectorAll('#test-section .qc[data-qid]');

  for (const card of cards) {
    const qId = card.dataset.qid;
    const key = `${currentCategory.id}/${currentUnit.id}/${qId}`;
    const t = tracking[key] || { attempts: 0, correct: 0, firstRikai: null, currentRikai: null };
    const rate = t.attempts > 0 ? Math.round(t.correct / t.attempts * 100) : -1;
    const rateClass = rate < 0 ? 'rate-none' : rate >= 80 ? 'rate-high' : rate >= 50 ? 'rate-mid' : 'rate-low';
    const rateText = rate < 0 ? '-' : rate + '%';
    const attText = t.attempts > 0 ? ` (${t.correct}/${t.attempts})` : '';

    card.querySelector('.qc-rate').innerHTML =
      `<span class="${rateClass}">${rateText}</span><span class="qc-att">${attText}</span>`;

    const firstCell = card.querySelector('.qc-rikai[data-type="first"]');
    const currentCell = card.querySelector('.qc-rikai[data-type="current"]');
    firstCell.innerHTML = rikaiButtonsInlineUnit(qId, 'first', t.firstRikai);
    currentCell.innerHTML = rikaiButtonsInlineUnit(qId, 'current', t.currentRikai);

    const isDimmed = filteredQuestionIds && !filteredQuestionIds.has(qId);
    card.classList.toggle('dimmed', isDimmed);
  }
}

function markUnitAnswer(questionId, isCorrect, event) {
  event.stopPropagation();
  recordAnswer(questionId, isCorrect);
  updateUnitPointCards();
  updateTestCards();
}

function doSetRikaiUnit(questionId, type, value) {
  setRikai(questionId, type, value);
  updateUnitPointCards();
  updateTestCards();
}

function printSinglePoint(pointId) {
  let point = unitData.points.find(p => p.id === pointId);
  if (!point && unitData.test && unitData.test.id === pointId) point = unitData.test;
  if (!point || !point.problemPages || point.problemPages.length === 0) return;

  const container = document.getElementById('print-container');
  const basePath = `categories/${currentCategory.id}/units/${currentUnit.id}/`;

  const isTest = point.id && point.id.startsWith('chikaradameshi');
  const printPages = [];
  for (let pageIdx = isTest ? 0 : 1; pageIdx < point.problemPages.length; pageIdx++) {
    const highlights = [];
    if (filteredQuestionIds) {
      for (const q of point.questions) {
        if (q.numberPage === pageIdx && q.numberPos && filteredQuestionIds.has(q.id)) {
          highlights.push({ cx: q.numberPos[0], cy: q.numberPos[1] });
        }
      }
    }
    printPages.push({ src: basePath + point.problemPages[pageIdx], highlights });
  }

  if (!filteredQuestionIds) {
    container.innerHTML = printPages.map(p => `<img src="${p.src}">`).join('');
    const imgs = container.querySelectorAll('img');
    let loadCount = 0;
    const onAllLoaded = () => { if (++loadCount >= imgs.length) window.print(); };
    imgs.forEach(img => { if (img.complete) onAllLoaded(); else img.onload = onAllLoaded; });
    return;
  }

  let loaded = 0;
  const images = [];
  printPages.forEach((p, idx) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      loaded++;
      images[idx] = { img, highlights: p.highlights };
      if (loaded === printPages.length) renderPrintCanvases(images, container);
    };
    img.src = p.src;
  });
}

function rikaiSymbol(val) {
  if (val === 'maru') return '<span class="rikai-maru">○</span>';
  if (val === 'sankaku') return '<span class="rikai-sankaku">△</span>';
  if (val === 'batsu') return '<span class="rikai-batsu">×</span>';
  return '<span class="rikai-none">-</span>';
}

// ============================================================
// Point detail (算数演習と同じ構造)
// ============================================================
let showingPointAnswer = false;
let pointFilter = 'all';
let pointFilteredIds = null;

function openPoint(pointId) {
  const point = unitData.points.find(p => p.id === pointId);
  const isTest = !point && unitData.test && unitData.test.id === pointId;
  const data = point || unitData.test;
  if (!data) return;
  currentPointData = data;
  showingPointAnswer = false;
  pointFilter = 'all';
  pointFilteredIds = null;
  renderPointDetail(data, isTest ? 'test' : 'point');
  showScreen('screen-point-detail');
  updateHash();
}

function renderPointDetail(data, type) {
  const nankanLabel = data.type === '難関の型' ? '【難関の型】' : '';
  const title = type === 'test' ? data.title : `Point ${data.number} ${data.title}${nankanLabel}`;
  document.getElementById('point-detail-title').textContent = title;
  document.getElementById('user-badge-point').textContent = currentUser;

  // Point・テスト共通の構造
  document.getElementById('point-fixed-top').style.display = '';

  // Filter button states
  document.querySelectorAll('#point-filter-buttons .mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === pointFilter);
  });

  // Answer toggle button state
  const ansBtn = document.getElementById('point-answer-toggle-btn');
  ansBtn.textContent = showingPointAnswer ? '問題に戻る' : '解答';
  ansBtn.classList.toggle('active', showingPointAnswer);

  // Question cards
  renderPointQuestionCards(data);

  // Page images
  renderPointPageImages(data);
}

function renderPointQuestionCards(data) {
  const container = document.getElementById('point-question-cards');
  let html = '';
  for (const q of data.questions) {
    html += `<div class="qc" data-qid="${q.id}">
      <span class="qc-name">${q.label}</span>
      <span class="qc-h">正誤</span>
      <span class="qc-h">初回理解度</span>
      <span class="qc-h">最新理解度</span>
      <span class="qc-rate"></span>
      <span class="qc-ans">
        <button class="qc-btn q-btn-ok" onclick="markPointAnswer('${q.id}', true, event)">○</button>
        <button class="qc-btn q-btn-ng" onclick="markPointAnswer('${q.id}', false, event)">×</button>
      </span>
      <span class="qc-rikai" data-qid="${q.id}" data-type="first"></span>
      <span class="qc-rikai" data-qid="${q.id}" data-type="current"></span>
    </div>`;
  }
  container.innerHTML = html;
  updatePointQuestionCards(data);
}

function updatePointQuestionCards(data) {
  const tracking = getTracking();
  const cards = document.querySelectorAll('#point-question-cards .qc[data-qid]');

  for (const card of cards) {
    const qId = card.dataset.qid;
    const key = `${currentCategory.id}/${currentUnit.id}/${qId}`;
    const t = { ...(tracking[key] || { attempts: 0, correct: 0, firstRikai: null, currentRikai: null }) };

    // pending状態を反映（UIプレビュー用）
    if (qId in pendingAnswers) {
      t.attempts++;
      if (pendingAnswers[qId]) t.correct++;
    }
    const pendingFirstKey = `${qId}/first`;
    const pendingCurrentKey = `${qId}/current`;
    let firstVal = t.firstRikai;
    let currentVal = t.currentRikai;
    if (pendingFirstKey in pendingRikai && t.firstRikai === null) {
      firstVal = pendingRikai[pendingFirstKey];
      if (currentVal === null) currentVal = firstVal;
    }
    if (pendingCurrentKey in pendingRikai) {
      currentVal = pendingRikai[pendingCurrentKey];
    }

    const rate = t.attempts > 0 ? Math.round(t.correct / t.attempts * 100) : -1;
    const rateClass = rate < 0 ? 'rate-none' : rate >= 80 ? 'rate-high' : rate >= 50 ? 'rate-mid' : 'rate-low';
    const rateText = rate < 0 ? '-' : rate + '%';
    const attText = t.attempts > 0 ? ` (${t.correct}/${t.attempts})` : '';

    card.querySelector('.qc-rate').innerHTML =
      `<span class="${rateClass}">${rateText}</span><span class="qc-att">${attText}</span>`;

    const firstCell = card.querySelector('.qc-rikai[data-type="first"]');
    const currentCell = card.querySelector('.qc-rikai[data-type="current"]');
    firstCell.innerHTML = rikaiButtonsInline(qId, 'first', firstVal);
    currentCell.innerHTML = rikaiButtonsInline(qId, 'current', currentVal);

    const isDimmed = pointFilteredIds && !pointFilteredIds.has(qId);
    card.classList.toggle('dimmed', isDimmed);
  }
}

function rikaiButtonsInline(qId, type, currentVal) {
  if (type === 'first' && currentVal !== null) {
    return rikaiSymbol(currentVal);
  }
  const vals = [
    { key: 'maru', sym: '○', cls: 'rikai-btn-maru' },
    { key: 'sankaku', sym: '△', cls: 'rikai-btn-sankaku' },
    { key: 'batsu', sym: '×', cls: 'rikai-btn-batsu' },
  ];
  return vals.map(v =>
    `<button class="rikai-btn ${v.cls} ${currentVal === v.key ? 'selected' : ''}"
             onclick="doSetRikai('${qId}', '${type}', '${v.key}')">${v.sym}</button>`
  ).join('');
}

function getExampleVideos(data) {
  const entries = [];
  if (!data.questions) return entries;
  const isTest = data.id && data.id.startsWith('chikaradameshi');
  const seen = new Set();

  for (const q of data.questions) {
    if (q.youtube_ids && q.youtube_ids.length > 0) {
      q.youtube_ids.forEach((id, i) => {
        if (isTest) {
          // テスト: 同じ大問の小問は同じ動画を共有するので重複除外
          if (seen.has(id)) return;
          seen.add(id);
          // "1番(1)" → "1番" のように大問番号でラベル付け
          const mainLabel = q.label.replace(/\(.*$/, '').replace(/個数$|整数$/, '');
          entries.push({ id, label: mainLabel });
        } else {
          const suffix = q.youtube_ids.length > 1 ? ` (${i + 1})` : '';
          entries.push({ id, label: `${q.label}【例題】${suffix}` });
        }
      });
    }
  }
  return entries;
}

function renderPointPageImages(data) {
  const preview = document.getElementById('point-pages-preview');
  const basePath = `categories/${currentCategory.id}/units/${currentUnit.id}/`;
  const isTest = data.id && data.id.startsWith('chikaradameshi');
  let html = '';

  // Problem pages
  if (data.problemPages) {
    const startIdx = isTest ? 0 : 1; // テストは表紙なし、Pointは表紙(p00)スキップ
    for (let i = startIdx; i < data.problemPages.length; i++) {
      html += `
      <div class="page-preview" data-page-type="question">
        <div class="preview-image-wrapper">
          <img src="${basePath}${data.problemPages[i]}" alt="問題ページ${i}"
               data-page-idx="${i}" data-page-type="question"
               onload="onPointPageLoad(this)">
          <canvas class="preview-canvas" data-page-idx="${i}" data-page-type="question"></canvas>
        </div>
        <div class="page-preview-label">問題ページ ${i + 1 - startIdx}</div>
      </div>`;
    }
  }

  // Answer pages
  if (data.answerPages && data.answerPages.length > 0) {
    const ansCount = isTest ? data.answerPages.length : 1; // テストは全ページ、Pointは1枚
    for (let i = 0; i < ansCount; i++) {
      html += `
      <div class="page-preview" data-page-type="answer" style="display:none">
        <div class="preview-image-wrapper">
          <img src="${basePath}${data.answerPages[i]}" alt="解答ページ${i + 1}" data-page-type="answer">
        </div>
        <div class="page-preview-label">解答${ansCount > 1 ? ` ${i + 1}` : ''}</div>
      </div>`;
    }
  }

  // YouTube: 解説動画
  const videoEntries = getExampleVideos(data);
  const videoTitle = isTest ? '解説動画' : '例題 解説動画';
  if (videoEntries.length > 0) {
    html += `<div class="point-video-section" data-page-type="answer" style="display:none">
      <div class="point-section"><h3>${videoTitle} (${videoEntries.length}本)</h3><div class="video-grid">`;
    for (const v of videoEntries) {
      const safeLabel = v.label.replace(/'/g, "\\'");
      html += `<div class="video-item" onclick="openVideoModal('${v.id}', '${safeLabel}')">
        <div class="video-thumb" style="background-image:url('https://img.youtube.com/vi/${v.id}/mqdefault.jpg')"></div>
        <div class="video-label">${v.label}</div>
      </div>`;
    }
    html += '</div></div></div>';
  }

  // ポイント解説動画
  if (data.point_videos && data.point_videos.length > 0) {
    html += `<div class="point-video-section" data-page-type="answer" style="display:none">
      <div class="point-section"><h3>ポイント解説 (${data.point_videos.length}本)</h3><div class="video-grid">`;
    for (const v of data.point_videos) {
      const safeTitle = v.title.replace(/'/g, "\\'");
      html += `<div class="video-item" onclick="openVideoModal('${v.id}', '${safeTitle}')">
        <div class="video-thumb" style="background-image:url('https://img.youtube.com/vi/${v.id}/mqdefault.jpg')"></div>
        <div class="video-label">${v.title}</div>
      </div>`;
    }
    html += '</div></div></div>';
  }

  preview.innerHTML = html;
}

function onPointPageLoad(img) {
  drawPointPreviewHighlights();
}

function drawPointPreviewHighlights() {
  if (showingPointAnswer) return;
  const data = currentPointData;
  if (!data || !data.questions) return;

  const canvases = document.querySelectorAll('#point-pages-preview .preview-canvas[data-page-type="question"]');
  for (const canvas of canvases) {
    const pageIdx = parseInt(canvas.dataset.pageIdx);
    const img = canvas.parentElement.querySelector('img');
    if (!img || !img.naturalWidth) continue;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!pointFilteredIds) continue; // No filter = no highlights

    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const r = Math.max(W, H) * 0.022;

    for (const q of data.questions) {
      if (q.numberPage !== pageIdx || !q.numberPos) continue;
      if (!pointFilteredIds.has(q.id)) continue;
      drawNumberHighlight(ctx, q.numberPos[0] * W, q.numberPos[1] * H, r, '#ff3b30');
    }
  }
}

// ============================================================
// Point filter
// ============================================================
function setPointFilter(mode) {
  pointFilter = mode;
  pointFilteredIds = null;
  const data = currentPointData;
  if (!data || !data.questions) return;

  const tracking = getTracking();

  if (mode === 'below50' || mode === 'below67' || mode === 'below99') {
    const threshold = mode === 'below50' ? 50 : mode === 'below67' ? 67 : 99;
    const filtered = data.questions.filter(q => {
      const key = `${currentCategory.id}/${currentUnit.id}/${q.id}`;
      const t = tracking[key];
      if (!t || t.attempts === 0) return true;
      return Math.round(t.correct / t.attempts * 100) <= threshold;
    });
    pointFilteredIds = new Set(filtered.map(q => q.id));
  } else if (mode === 'first-rikai-below') {
    const filtered = data.questions.filter(q => {
      const key = `${currentCategory.id}/${currentUnit.id}/${q.id}`;
      const t = tracking[key];
      if (!t || t.firstRikai === null) return true;
      return t.firstRikai === 'sankaku' || t.firstRikai === 'batsu';
    });
    pointFilteredIds = new Set(filtered.map(q => q.id));
  } else if (mode === 'current-rikai-below') {
    const filtered = data.questions.filter(q => {
      const key = `${currentCategory.id}/${currentUnit.id}/${q.id}`;
      const t = tracking[key];
      if (!t || t.currentRikai === null) return true;
      return t.currentRikai === 'sankaku' || t.currentRikai === 'batsu';
    });
    pointFilteredIds = new Set(filtered.map(q => q.id));
  }

  document.querySelectorAll('#point-filter-buttons .mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  updatePointQuestionCards(data);
  drawPointPreviewHighlights();
}

// ============================================================
// Point answer toggle
// ============================================================
function togglePointAnswer() {
  showingPointAnswer = !showingPointAnswer;

  const ansBtn = document.getElementById('point-answer-toggle-btn');
  ansBtn.textContent = showingPointAnswer ? '問題に戻る' : '解答';
  ansBtn.classList.toggle('active', showingPointAnswer);

  // Update cards (show/hide ○× and rikai buttons)
  updatePointQuestionCards(currentPointData);

  // Toggle page visibility
  const questionPages = document.querySelectorAll('#point-pages-preview [data-page-type="question"]');
  const answerPages = document.querySelectorAll('#point-pages-preview [data-page-type="answer"]');
  questionPages.forEach(el => el.style.display = showingPointAnswer ? 'none' : '');
  answerPages.forEach(el => el.style.display = showingPointAnswer ? '' : 'none');
}

// ─── Point詳細ページ: 遅延コミット方式 ───
// ページ滞在中は最後の○×のみ保持し、離脱時に確定
let pendingAnswers = {};  // { questionId: isCorrect }
let pendingRikai = {};    // { "questionId/type": value }

function markPointAnswer(questionId, isCorrect, event) {
  event.stopPropagation();
  pendingAnswers[questionId] = isCorrect;
  updatePointQuestionCards(currentPointData);
}

function doSetRikai(questionId, type, value) {
  pendingRikai[`${questionId}/${type}`] = value;
  updatePointQuestionCards(currentPointData);
}

function flushPendingPointChanges() {
  for (const [qId, isCorrect] of Object.entries(pendingAnswers)) {
    recordAnswer(qId, isCorrect);
  }
  for (const [key, value] of Object.entries(pendingRikai)) {
    const [qId, type] = key.split('/');
    setRikai(qId, type, value);
  }
  pendingAnswers = {};
  pendingRikai = {};
}

// 画面非表示時に確定
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushPendingPointChanges();
});

// ============================================================
// Print with highlights
// ============================================================
function drawNumberHighlight(ctx, cx, cy, r, color) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color + '30';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

function printProblems() {
  const container = document.getElementById('print-container');
  const basePath = `categories/${currentCategory.id}/units/${currentUnit.id}/`;

  // Collect pages to print from each point
  // Each entry: { src, highlights: [{cx, cy}] }
  const printPages = [];

  for (const point of unitData.points) {
    if (!point.problemPages || point.problemPages.length === 0) continue;

    // Determine which questions in this point match the filter
    const matchingQs = point.questions.filter(q => {
      if (!filteredQuestionIds) return false; // no filter = no highlights
      return filteredQuestionIds.has(q.id);
    });

    // If filter is active and no matching questions in this point, skip it
    if (filteredQuestionIds && matchingQs.length === 0) continue;

    // Collect pages (skip cover page p00)
    for (let pageIdx = 1; pageIdx < point.problemPages.length; pageIdx++) {
      const pagePath = point.problemPages[pageIdx];
      const highlights = [];

      // Find questions on this page
      for (const q of matchingQs) {
        if (q.numberPage === pageIdx && q.numberPos) {
          highlights.push({ cx: q.numberPos[0], cy: q.numberPos[1] });
        }
      }

      printPages.push({
        src: basePath + pagePath,
        highlights: highlights,
      });
    }
  }

  if (printPages.length === 0) {
    alert('印刷対象のページがありません。');
    return;
  }

  if (!filteredQuestionIds) {
    // No filter: print plain images
    container.innerHTML = printPages.map(p =>
      `<img src="${p.src}">`
    ).join('');
    const imgs = container.querySelectorAll('img');
    let loadCount = 0;
    const onAllLoaded = () => { if (++loadCount >= imgs.length) window.print(); };
    imgs.forEach(img => {
      if (img.complete) onAllLoaded();
      else img.onload = onAllLoaded;
    });
    return;
  }

  // With filter: render highlights onto canvases
  let loaded = 0;
  const images = [];

  printPages.forEach((p, idx) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      loaded++;
      images[idx] = { img, highlights: p.highlights };
      if (loaded === printPages.length) {
        renderPrintCanvases(images, container);
      }
    };
    img.src = p.src;
  });
}

function renderPrintCanvases(imageData, container) {
  container.innerHTML = '';

  for (const { img, highlights } of imageData) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const r = Math.max(W, H) * 0.022;
    const printScale = W / 800;
    ctx.lineWidth = 2.5 * printScale;

    for (const h of highlights) {
      drawNumberHighlight(ctx, h.cx * W, h.cy * H, r, '#ff3b30');
    }

    const printImg = document.createElement('img');
    printImg.src = canvas.toDataURL('image/png');
    container.appendChild(printImg);
  }

  setTimeout(() => window.print(), 300);
}

function printPointProblems() {
  const data = currentPointData;
  if (!data) return;

  const container = document.getElementById('print-container');
  const basePath = `categories/${currentCategory.id}/units/${currentUnit.id}/`;

  // Answer mode: print answer page (1枚目のみ)
  if (showingPointAnswer && data.answerPages && data.answerPages.length > 0) {
    container.innerHTML = `<img src="${basePath}${data.answerPages[0]}">`;
    const imgs = container.querySelectorAll('img');
    let loadCount = 0;
    const onAllLoaded = () => { if (++loadCount >= imgs.length) window.print(); };
    imgs.forEach(img => {
      if (img.complete) onAllLoaded();
      else img.onload = onAllLoaded;
    });
    return;
  }

  // Problem mode: print problem pages with highlights
  if (!data.problemPages || data.problemPages.length === 0) return;

  const printPages = [];
  for (let pageIdx = 1; pageIdx < data.problemPages.length; pageIdx++) {
    const highlights = [];
    if (pointFilteredIds) {
      for (const q of data.questions) {
        if (q.numberPage === pageIdx && q.numberPos && pointFilteredIds.has(q.id)) {
          highlights.push({ cx: q.numberPos[0], cy: q.numberPos[1] });
        }
      }
    }
    printPages.push({
      src: basePath + data.problemPages[pageIdx],
      highlights: highlights,
    });
  }

  if (!pointFilteredIds) {
    // No filter: plain images
    container.innerHTML = printPages.map(p => `<img src="${p.src}">`).join('');
    const imgs = container.querySelectorAll('img');
    let loadCount = 0;
    const onAllLoaded = () => { if (++loadCount >= imgs.length) window.print(); };
    imgs.forEach(img => {
      if (img.complete) onAllLoaded();
      else img.onload = onAllLoaded;
    });
    return;
  }

  // With filter: canvas highlights
  let loaded = 0;
  const images = [];
  printPages.forEach((p, idx) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      loaded++;
      images[idx] = { img, highlights: p.highlights };
      if (loaded === printPages.length) {
        renderPrintCanvases(images, container);
      }
    };
    img.src = p.src;
  });
}

// ─── 動画モーダル（YouTube IFrame Player API）───
let ytPlayer = null;
let ytPlayerReady = false;
let pendingVideoId = null;
let currentVideoSpeed = 1.5;

function onYouTubeIframeAPIReady() {
  ytPlayerReady = true;
  if (pendingVideoId) {
    createPlayer(pendingVideoId);
    pendingVideoId = null;
  }
}

function createPlayer(videoId) {
  const wrap = document.getElementById('video-player-wrap');
  wrap.innerHTML = '<div id="yt-player"></div>';
  ytPlayer = new YT.Player('yt-player', {
    videoId: videoId,
    width: '100%',
    height: '100%',
    playerVars: {
      autoplay: 1,
      playsinline: 1,
      rel: 0,
      vq: 'hd720'
    },
    events: {
      onReady: function(e) {
        e.target.setPlaybackRate(currentVideoSpeed);
      },
      onPlaybackRateChange: function(e) {
        currentVideoSpeed = e.data;
        updateSpeedButtons();
      }
    }
  });
}

function openVideoModal(videoId, label) {
  currentVideoSpeed = 1.5;
  document.getElementById('video-modal-title').textContent = label || '';
  document.getElementById('video-modal').classList.add('active');
  updateSpeedButtons();

  if (ytPlayerReady) {
    createPlayer(videoId);
  } else {
    pendingVideoId = videoId;
  }
}

function closeVideoModal(e) {
  if (e && e.target !== e.currentTarget && !e.target.classList.contains('video-modal-close')) return;
  document.getElementById('video-modal').classList.remove('active');
  if (ytPlayer && ytPlayer.destroy) {
    ytPlayer.destroy();
    ytPlayer = null;
  }
  document.getElementById('video-player-wrap').innerHTML = '';
}

function setVideoSpeed(speed) {
  currentVideoSpeed = speed;
  if (ytPlayer && ytPlayer.setPlaybackRate) {
    ytPlayer.setPlaybackRate(speed);
  }
  updateSpeedButtons();
}

function updateSpeedButtons() {
  document.querySelectorAll('.video-speed-btn').forEach(btn => {
    const s = parseFloat(btn.textContent);
    btn.classList.toggle('active', s === currentVideoSpeed);
  });
}
