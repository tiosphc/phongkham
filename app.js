/* TBVN Treatment Timeline · Netlify frontend with Supabase persistence */
'use strict';

const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalized = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase();
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const pad = n => String(n).padStart(2, '0');
const range = source => (String(source).match(/\d+(?:\.\d+)?/g) || []).map(Number);
const durationLabel = raw => String(raw || '')
  .replace(/minutes?|phút/g, 'phút')
  .replace('/nodule', '/nốt')
  .replace(/\s*-\s*/g, '–')
  .replace(/\s+/g, ' ')
  .trim();

const TECHS = [
  ...CATALOG.techs.map(t => ({
    stt: t.stt,
    en: t.en,
    group_vi: t.group_vi,
    group_jp: t.group_jp,
    inds: t.inds.map((ind, index) => ({
      id: `${t.stt}:${index}`,
      vi: ind.vi,
      jp: ind.jp,
      raw: ind.t,
      base: range(ind.t).at(-1) || 5,
      perUnit: String(ind.t).includes('/nodule')
    }))
  })),
  {
    stt: '+',
    en: 'Thao tác bổ sung',
    group_vi: 'Thao tác bổ sung',
    group_jp: '追加処置',
    inds: CATALOG.aux.map((ind, index) => ({
      id: `extra:${index}`,
      vi: ind.en === 'Basic' ? 'Thao tác cơ bản' : ind.en,
      jp: ['基本処置', '麻酔クリーム塗布', 'PRP・PRF用採血と遠心分離'][index] || '',
      raw: ind.t,
      base: range(ind.t).at(-1) || 5,
      perUnit: false
    }))
  }
];
const TECH_BY = Object.fromEntries(TECHS.map(t => [t.stt, t]));
const SERVICE_BY = Object.fromEntries(TECHS.flatMap(t => t.inds.map(ind => [ind.id, { ...ind, tech: t.en, group: t.group_vi, techId: t.stt }] )));
const ALL_GROUPS = [...new Set(TECHS.map(t => t.group_vi))];
const ROOMS = [
  { id: 'room_1', label: 'Treatment 1' },
  { id: 'room_2', label: 'Treatment 2' },
  { id: 'room_3', label: 'Treatment 3' }
];
const ROOM_BY = Object.fromEntries(ROOMS.map(room => [room.id, room]));
const roomLabel = room => ROOM_BY[room]?.label || 'Chưa phân phòng';
const CASES_PER_PAGE = 6;

const state = {
  cases: [],
  connection: 'loading',
  syncBusy: false,
  syncError: '',
  view: 'dashboard',
  filter: 'all',
  roomFilter: 'all',
  activeRoom: 'room_1',
  casePage: 1,
  caseSearch: '',
  timelineDate: null,
  catalogSearch: '',
  catalogGroup: '',
  catalogActiveTechId: TECHS[0]?.stt || '',
  form: null,
  expanded: new Set()
};

let audioCtx = null;
let toastId = null;
let highlightedCaseId = null;
let jumpSequence = 0;
let jumpDelayTimer = null;
let highlightTimer = null;

function enableSound() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
}
function beep() {
  try {
    if (!audioCtx) return;
    const n = audioCtx.currentTime;
    [0, .22].forEach(d => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(850, n + d);
      g.gain.setValueAtTime(.0001, n + d);
      g.gain.exponentialRampToValueAtTime(.16, n + d + .02);
      g.gain.exponentialRampToValueAtTime(.0001, n + d + .18);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(n + d); o.stop(n + d + .2);
    });
  } catch {}
}
function toast(message, duration = 2400) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastId);
  toastId = setTimeout(() => el.classList.remove('show'), duration);
}

function minsLabel(total) {
  const m = Math.max(0, Math.round(total));
  return m >= 60 ? `${Math.floor(m / 60)} giờ${m % 60 ? ' ' + (m % 60) + ' phút' : ''}` : `${m} phút`;
}
function formatTimer(seconds) {
  const overdue = seconds < 0;
  const s = overdue ? Math.floor(Math.abs(seconds)) : Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  const sec = s % 60;
  return (overdue ? '+' : '') + (h ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`);
}
function startMinutes(source) {
  const [h, m] = String(source || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function timeFromMinutes(minutes) {
  const n = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const days = Math.floor(minutes / 1440);
  return `${pad(Math.floor(n / 60))}:${pad(n % 60)}` + (days > 0 ? ` +${days} ngày` : '');
}
function vietnamParts(epoch = TBVNSync.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(epoch));
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}
function vietnamDate(epoch = TBVNSync.now()) {
  const p = vietnamParts(epoch);
  return `${p.year}-${p.month}-${p.day}`;
}
function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function selectedTimelineDate() { return state.timelineDate || vietnamDate(); }
function shiftTimelineDate(days) {
  const date = new Date(`${selectedTimelineDate()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  state.timelineDate = date.toISOString().slice(0, 10);
}
function renderTimelineSelection() {
  const input = $('#timelineDate');
  if (input) input.value = selectedTimelineDate();
  const label = $('#timelineDateLabel');
  if (label) label.textContent = displayDate(selectedTimelineDate());
  const content = $('#timelineContent');
  if (content) content.innerHTML = timelineHTML();
}
function scheduledStartEpoch(c) {
  const created = Date.parse(c.createdAt);
  const date = c.appointmentDate || vietnamDate(Number.isFinite(created) ? created : TBVNSync.now());
  return Date.parse(`${date}T${c.start}:00+07:00`);
}
function currentTime(now = TBVNSync.now()) {
  const p = vietnamParts(now);
  return `${p.hour}:${p.minute}:${p.second}`;
}
function readableDate(now = TBVNSync.now()) {
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(now));
}
function caseLeft(c, now = TBVNSync.now()) {
  if (c.completed) return 0;
  if (!c.started) return c.plannedSec;
  return c.running ? (c.deadline - now) / 1000 : c.remaining;
}
function caseStatus(c, now = TBVNSync.now()) {
  if (c.completed) return 'done';
  if (!c.started) return 'waiting';
  if (caseLeft(c, now) <= 0) return 'overdue';
  if (c.running) return 'running';
  return 'paused';
}
function scheduledEnd(c) {
  return clockFromEpoch(scheduledStartEpoch(c) + c.plannedSec * 1000);
}
function displayDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date.slice(8,10)}/${date.slice(5,7)}/${date.slice(0,4)}` : date;
}
function clockFromEpoch(epoch, now = TBVNSync.now()) {
  if (!Number.isFinite(epoch)) return 'Chưa xác định';
  const date = vietnamParts(epoch);
  const today = vietnamParts(now);
  const day = Date.parse(`${date.year}-${date.month}-${date.day}T00:00:00Z`);
  const currentDay = Date.parse(`${today.year}-${today.month}-${today.day}T00:00:00Z`);
  const offset = Math.round((day - currentDay) / 86400000);
  return `${date.hour}:${date.minute}${offset ? ` ${offset > 0 ? '+' : ''}${offset} ngày` : ''}`;
}
function actualEnd(c, now = TBVNSync.now()) {
  if (c.completed) return c.finishedAt ? clockFromEpoch(c.finishedAt, now) : 'Đã hoàn tất';
  if (c.running && c.deadline) return clockFromEpoch(c.deadline, now);
  return c.started ? 'Chờ tiếp tục' : 'Chưa bắt đầu';
}
function appointmentDelayMinutes(c, now = TBVNSync.now()) {
  if (c.started || c.completed) return 0;
  return Math.max(0, Math.floor((now - scheduledStartEpoch(c)) / 60000));
}
function lateBadgeHTML(c, now = TBVNSync.now()) {
  const minutes = appointmentDelayMinutes(c, now);
  return `<span class="late-start" data-late="${esc(c.id)}" ${minutes ? '' : 'hidden'}>Trễ bắt đầu ${minutes} phút<small lang="ja">開始遅れ ${minutes}分</small></span>`;
}
function initials(s) {
  const parts = String(s || 'K').trim().split(/\s+/);
  return esc((parts.at(-1) || 'K').slice(0, 1).toUpperCase());
}
function dateMinutesDefault() {
  const p = vietnamParts();
  let mins = Number(p.hour) * 60 + Number(p.minute);
  mins = Math.ceil(mins / 5) * 5;
  return timeFromMinutes(mins).slice(0, 5);
}
function dateDefault() {
  const now = TBVNSync.now();
  const p = vietnamParts(now);
  const mins = Math.ceil((Number(p.hour) * 60 + Number(p.minute)) / 5) * 5;
  return vietnamDate(now + (mins >= 1440 ? 86400000 : 0));
}
function countdownBaseline(c) {
  return c.plannedSec;
}
function scheduledOverlapCount(c) {
  const a = scheduledStartEpoch(c);
  const b = a + c.plannedSec * 1000;
  return state.cases.filter(other => {
    if (other.id === c.id || other.completed) return false;
    const otherStart = scheduledStartEpoch(other);
    return a < otherStart + other.plannedSec * 1000 && b > otherStart;
  }).length;
}
function concurrentRunningCount(c) {
  return c.running && !c.completed ? state.cases.filter(other => other.id !== c.id && other.running && !other.completed).length : 0;
}
function stats() {
  const now = TBVNSync.now();
  return {
    total: state.cases.length,
    running: state.cases.filter(c => caseStatus(c, now) === 'running').length,
    overdue: state.cases.filter(c => caseStatus(c, now) === 'overdue').length,
    minutes: Math.round(state.cases.reduce((sum, c) => sum + c.plannedSec / 60, 0))
  };
}
function passesStatusFilter(c) {
  const status = caseStatus(c);
  return state.filter === 'all' || {
    running: status === 'running',
    waiting: status === 'waiting',
    late: status === 'waiting' && appointmentDelayMinutes(c) > 0,
    paused: status === 'paused',
    overdue: status === 'overdue',
    done: status === 'done'
  }[state.filter];
}
function caseSearchText(c) {
  return normalized(c.name + ' ' + c.technician + ' ' + c.items.map(it => SERVICE_BY[it.id]?.vi || '').join(' '));
}
function visibleCases() {
  const q = normalized(state.caseSearch.trim());
  return state.cases.filter(c => {
    return passesStatusFilter(c) && (!q || caseSearchText(c).includes(q)) &&
      (state.roomFilter === 'all' || c.room === state.roomFilter);
  });
}

function formErrors(f = state.form) {
  if (!f) return {};
  const errors = {};
  const name = f.name.trim();
  if (!name) errors.name = 'Vui lòng nhập tên khách hàng trước khi chọn chỉ định điều trị.';
  else if (Array.from(name).length > 80) errors.name = 'Tên khách hàng không được vượt quá 80 ký tự.';
  if (!['Nam', 'Nữ', 'Khác'].includes(f.sex)) errors.sex = 'Vui lòng chọn giới tính.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.start)) errors.start = 'Vui lòng nhập giờ hẹn / bắt đầu hợp lệ.';
  if (!validIsoDate(f.appointmentDate)) {
    errors.appointmentDate = 'Vui lòng chọn ngày hẹn hợp lệ.';
  }
  if (!ROOM_BY[f.room]) errors.room = 'Vui lòng chọn phòng điều trị.';
  if (f.age !== '' && (!/^\d{1,3}$/.test(String(f.age)) || Number(f.age) > 120)) errors.age = 'Tuổi cần là số từ 0 đến 120.';
  if (Array.from(f.technician.trim()).length > 80) errors.technician = 'Tên bác sĩ không được vượt quá 80 ký tự.';
  return errors;
}
function validSelections(f = state.form) {
  if (!f?.opts.size) return false;
  const list = [...f.opts.values()];
  return list.every(item => SERVICE_BY[item.id] && Number.isInteger(item.minutes) && item.minutes >= 1 && item.minutes <= 600 &&
    (!item.perUnit || (Number.isInteger(item.qty) && item.qty >= 1 && item.qty <= 100))) &&
    formMinutes() >= 1 && formMinutes() <= 2880;
}
function canSaveCase() {
  return !state.syncBusy && !Object.keys(formErrors()).length && validSelections();
}
function updateFormErrors(changedField) {
  if (!state.form) return;
  const errors = formErrors();
  if (changedField && state.form.errors[changedField]) {
    if (errors[changedField]) state.form.errors[changedField] = errors[changedField];
    else delete state.form.errors[changedField];
  }
  if (state.form.step === 'techs') {
    document.querySelectorAll('[data-field]').forEach(field => {
      const key = field.dataset.field;
      field.classList.toggle('field-error', !!state.form.errors[key]);
      field.querySelector('input,select')?.setAttribute('aria-invalid', String(!!state.form.errors[key]));
      const message = field.querySelector('.field-message');
      if (message) message.textContent = state.form.errors[key] || '';
    });
  }
  document.querySelectorAll('[data-action="save-case"]').forEach(button => button.disabled = !canSaveCase());
}
function showFormErrors() {
  const errors = formErrors();
  if (!Object.keys(errors).length) return false;
  state.form.errors = errors;
  if (state.form.step !== 'techs') {
    state.form.step = 'techs';
    TBVNRouter.push({ view: 'builder', step: 'techs' });
  }
  render();
  toast(Object.values(errors)[0]);
  const first = Object.keys(errors)[0];
  const field = document.querySelector(`[data-field="${first}"]`);
  field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  field?.querySelector('input,select,button')?.focus({ preventScroll: true });
  return true;
}

function initForm(c = null, serviceId = null) {
  const replacingBuilder = state.view === 'builder' && !!state.form;
  const opts = new Map();
  if (c) c.items.forEach(item => opts.set(item.id, { ...item }));
  if (serviceId && SERVICE_BY[serviceId]) {
    const s = SERVICE_BY[serviceId];
    opts.set(serviceId, { id: serviceId, minutes: s.base, perUnit: s.perUnit, qty: 1 });
  }
  const activeTechId = serviceId && SERVICE_BY[serviceId]
    ? SERVICE_BY[serviceId].techId
    : c?.items?.[0]?.id && SERVICE_BY[c.items[0].id]
      ? SERVICE_BY[c.items[0].id].techId
      : TECHS[0]?.stt || '';
  state.form = {
    editing: c?.id || null,
    insertId: c?.id || crypto.randomUUID(),
    name: c?.name || '',
    age: c?.age || '',
    sex: c?.sex || '',
    technician: c?.technician || '',
    room: ROOM_BY[c?.room] ? c.room : '',
    appointmentDate: c?.appointmentDate || (c?.createdAt ? vietnamDate(Date.parse(c.createdAt)) : dateDefault()),
    start: c?.start || dateMinutesDefault(),
    errors: {},
    group: '',
    techSearch: '',
    activeTechId,
    step: 'techs',
    techScrollY: 0,
    opts
  };
  ensureBuilderActiveTech();
  state.view = 'builder';
  TBVNRouter[replacingBuilder ? 'replace' : 'push']({ view: 'builder', step: 'techs' });
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
  setTimeout(() => $('#formName')?.focus(), 10);
}
function closeForm(goView = 'dashboard') {
  state.form = null;
  state.view = goView;
  TBVNRouter.replace({ view: goView });
  render();
}

function restoreRoute(route) {
  if (route.view === 'builder') {
    if (!state.form) {
      TBVNRouter.skipInvalidBuilder();
      return;
    }
    state.form.step = route.step;
    if (route.techId && TECH_BY[route.techId]) state.form.activeTechId = route.techId;
  }
  state.view = route.view;
  render();
  window.scrollTo({ top: route.view === 'builder' && route.step === 'techs' ? state.form.techScrollY : 0, behavior: 'instant' });
}
function selectedArray() {
  return state.form ? Array.from(state.form.opts.values()) : [];
}
function formMinutes() {
  if (!state.form) return 0;
  return selectedArray().reduce((sum, item) => sum + item.minutes * (item.perUnit ? item.qty : 1), 0);
}

function builderTechs() {
  if (!state.form) return [];
  const q = normalized(state.form.techSearch.trim());
  return TECHS.filter(t => (!state.form.group || t.group_vi === state.form.group) && (!q || normalized(t.en + ' ' + t.group_vi + ' ' + t.group_jp + ' ' + t.inds.map(i => i.vi + ' ' + i.jp).join(' ')).includes(q)));
}
function ensureBuilderActiveTech() {
  if (!state.form) return;
  const visible = builderTechs();
  if (!visible.length) {
    state.form.activeTechId = '';
    return;
  }
  if (!visible.some(t => t.stt === state.form.activeTechId)) state.form.activeTechId = visible[0].stt;
}
function activeBuilderTech() {
  if (!state.form) return null;
  ensureBuilderActiveTech();
  return TECH_BY[state.form.activeTechId] || null;
}
function catalogTechs() {
  const q = normalized(state.catalogSearch.trim());
  return TECHS.filter(t => (!state.catalogGroup || t.group_vi === state.catalogGroup) && (!q || normalized(t.en + ' ' + t.group_vi + ' ' + t.group_jp + ' ' + t.inds.map(i => i.vi + ' ' + i.jp).join(' ')).includes(q)));
}
function ensureCatalogActiveTech() {
  const visible = catalogTechs();
  if (!visible.length) {
    state.catalogActiveTechId = '';
    return;
  }
  if (!visible.some(t => t.stt === state.catalogActiveTechId)) state.catalogActiveTechId = visible[0].stt;
}
function activeCatalogTech() {
  ensureCatalogActiveTech();
  return TECH_BY[state.catalogActiveTechId] || null;
}

function renderNav() {
  document.querySelectorAll('.tab').forEach(btn => {
    const active = btn.dataset.view === state.view;
    btn.classList.toggle('is-active', active);
    active ? btn.setAttribute('aria-current', 'page') : btn.removeAttribute('aria-current');
  });
}
function render() {
  const roomScrolls = new Map(Array.from(document.querySelectorAll('.room-case-list'))
    .map(list => [list.dataset.room, list.scrollTop]));
  const mode = document.querySelector('.mode-pill');
  if (mode) mode.innerHTML = `<i></i> ${state.connection === 'ready' && !state.syncError ? 'Đã kết nối dữ liệu' : 'Đồng bộ gián đoạn'}`;
  renderNav();
  const main = $('#mainContent');
  if (state.view === 'builder' && state.form) main.innerHTML = builderHTML();
  else if (state.view === 'catalog') main.innerHTML = catalogHTML();
  else main.innerHTML = dashboardHTML();
  document.querySelectorAll('.room-case-list').forEach(list => {
    list.scrollTop = roomScrolls.get(list.dataset.room) || 0;
  });
  const message = state.connection === 'loading' ? 'Đang tải dữ liệu từ Supabase…' : state.syncError;
  if (message) main.insertAdjacentHTML('afterbegin', `<div class="sync-alert" role="status">${esc(message)} ${state.connection !== 'loading' ? '<button class="text-btn" data-action="retry-sync">Tải lại</button>' : ''}</div>`);
  document.querySelectorAll('[data-action="open-new"]').forEach(button => button.disabled = state.connection !== 'ready');
}

function dashboardHTML() {
  const s = stats();
  return `
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">TBVN · ĐIỀU PHỐI CA ĐIỀU TRỊ</div>
        <h1>Theo dõi thời gian điều trị</h1>
        <p>Tạo ca, tính tổng thời gian, ước tính giờ hoàn thành và chạy đồng hồ cho từng khách ngay trên một màn hình.</p>
      </div>
      <div class="hero-clock">
        <div class="live-pill"><i></i> THỜI GIAN THỰC</div>
        <div class="clock-large" data-now>${currentTime()}</div>
        <div class="date-display" data-date>${esc(readableDate())}</div>
      </div>
    </section>

    <section class="stats-grid">
      <article class="stat-card"><span class="stat-label">Tổng ca</span><b class="stat-value" data-stat="total">${s.total}</b><small>Đang theo dõi trên các thiết bị</small></article>
      <article class="stat-card"><span class="stat-label">Đang chạy</span><b class="stat-value" data-stat="running">${s.running}</b><small>Đồng hồ đang hoạt động</small></article>
      <article class="stat-card"><span class="stat-label">Tổng phút dự kiến</span><b class="stat-value"><span data-stat="minutes">${s.minutes}</span><em>phút</em></b><small>Cộng của tất cả các ca</small></article>
      <article class="stat-card danger"><span class="stat-label">Quá giờ điều trị</span><b class="stat-value" data-stat="overdue">${s.overdue}</b><small>Cần kiểm tra lại tiến độ</small></article>
    </section>

    <section class="panel panel-space">
      <div class="section-head"><div><h2>Điều phối phòng điều trị</h2><p>Theo dõi các ca chưa hoàn tất trong từng phòng.</p></div></div>
      <div id="roomBoard">${roomBoardHTML()}</div>
    </section>

    <section class="panel panel-space">
      <div class="section-head">
        <div>
          <h2>Timeline trong ngày</h2>
          <p>Xem nhanh khung giờ của từng khách và phát hiện ca trùng nhau.</p>
        </div>
        <div class="timeline-legend" aria-label="Chú giải timeline"><span><i class="legend-scheduled"></i>Viền: lịch hẹn</span><span><i class="legend-actual"></i>Màu đặc: điều trị thực tế</span><span><i class="legend-now"></i>Vạch đỏ: hiện tại</span></div>
      </div>
      <div class="timeline-date-controls" aria-label="Chọn ngày Timeline">
        <button type="button" class="button" data-action="timeline-prev">← Ngày trước<small lang="ja">前日</small></button>
        <label for="timelineDate">Chọn ngày<small lang="ja">日付を選択</small><input id="timelineDate" type="date" value="${selectedTimelineDate()}"></label>
        <button type="button" class="button" data-action="timeline-today">Hôm nay<small lang="ja">今日</small></button>
        <button type="button" class="button" data-action="timeline-next">Ngày sau →<small lang="ja">翌日</small></button>
        <strong id="timelineDateLabel">${displayDate(selectedTimelineDate())}</strong>
      </div>
      <div id="timelineContent">${timelineHTML()}</div>
    </section>

    <section class="panel panel-space">
      <div class="section-head section-stack" id="casesTitle">
        <div>
          <h2>Danh sách ca điều trị</h2>
          <p>Theo dõi đồng hồ và điều chỉnh thời lượng trên các thiết bị cùng mở website.</p>
        </div>
        <div class="toolbar-row">
          <div class="search-wrap search-grow"><span class="search-icon">⌕</span><input class="search" id="caseSearch" type="search" placeholder="Tìm tên khách hoặc dịch vụ..." value="${esc(state.caseSearch)}"></div>
          <button class="button button-primary" data-action="open-new">＋ Tạo ca mới</button>
        </div>
      </div>
      <div class="filterbar">
        ${[['all','Tất cả'],['running','Đang chạy'],['waiting','Chưa bắt đầu'],['late','Trễ bắt đầu'],['paused','Tạm dừng'],['overdue','Quá giờ điều trị'],['done','Hoàn tất']].map(([k,t]) => `<button class="filter ${state.filter===k?'active':''}" data-action="filter" data-filter="${k}">${t}</button>`).join('')}
      </div>
      <div class="filterbar room-filterbar" aria-label="Lọc theo phòng điều trị">
        ${[['all','Tất cả phòng'],...ROOMS.map(room => [room.id,room.label])].map(([id,label]) => `<button class="filter ${state.roomFilter===id?'active':''}" data-action="room-filter" data-room="${id}">${label}</button>`).join('')}
      </div>
      <div id="casesContent">${casesHTML()}</div>
    </section>
  `;
}

function roomBoardHTML() {
  const now = TBVNSync.now();
  const activeByRoom = Object.fromEntries(ROOMS.map(room => [room.id,
    state.cases.filter(c => c.room === room.id && !c.completed).sort((a, b) => {
      const key = c => {
        const status = caseStatus(c, now);
        if (c.running && status === 'overdue') return [0, caseLeft(c, now)];
        if (c.running) return [1, caseLeft(c, now)];
        if (c.started) return [2, caseLeft(c, now)];
        const delay = appointmentDelayMinutes(c, now);
        return delay ? [3, -delay] : [4, scheduledStartEpoch(c)];
      };
      const left = key(a), right = key(b);
      return left[0] - right[0] || left[1] - right[1] || String(a.id).localeCompare(String(b.id));
    })]));
  return `<div class="room-mobile-tabs" role="group" aria-label="Chọn phòng điều trị">${ROOMS.map(room =>
    `<button type="button" class="room-mobile-tab ${state.activeRoom === room.id ? 'active' : ''}" data-action="select-room-tab" data-room="${room.id}" aria-pressed="${state.activeRoom === room.id}">${room.label}<small>${activeByRoom[room.id].length} ca</small><small lang="ja">${activeByRoom[room.id].length}件</small></button>`).join('')}</div>
    <div class="room-board">${ROOMS.map(room => {
      const active = activeByRoom[room.id];
      const running = active.filter(c => c.running).length;
      return `<section class="room-panel ${state.activeRoom === room.id ? 'is-mobile-active' : ''}" data-room-panel="${room.id}">
        <div class="room-panel-head"><span class="room-icon" aria-hidden="true">▣</span><div><h3>${room.label}</h3><small>${active.length} ca · ${running} đang chạy · ${active.length - running} đang chờ</small></div></div>
        <div class="room-case-list" data-room="${room.id}">${active.length ? active.map(c => {
          const status = caseStatus(c, now);
          const late = appointmentDelayMinutes(c, now);
          return `<button type="button" class="room-case" data-action="jump-case" data-id="${esc(c.id)}" aria-label="Xem ca ${esc(c.name)} trong danh sách ca điều trị">
            <span class="room-case-top"><strong>${esc(c.name)}</strong><span class="room-case-arrow" aria-hidden="true">↘</span></span>
            <span class="room-case-doctor">Dr: ${esc(c.technician || 'Chưa cập nhật')}<small lang="ja">医師</small></span>
            <span class="room-case-middle"><b data-room-clock="${esc(c.id)}">${formatTimer(caseLeft(c, now))}</b><span class="status ${status}">${statusText(status)}</span></span>
            ${late ? `<span class="room-case-late" data-late="${esc(c.id)}">Trễ bắt đầu ${late} phút<small lang="ja">開始遅れ ${late}分</small></span>` : ''}
            <span class="room-case-end">${c.started ? 'Dự kiến xong' : 'Theo lịch'}: ${esc(c.started ? actualEnd(c, now) : scheduledEnd(c))}</span>
          </button>`;
        }).join('') : '<p class="room-empty">Chưa có ca hoạt động</p>'}</div>
      </section>`;
    }).join('')}</div>`;
}

function timelineHTML() {
  const today = selectedTimelineDate();
  if (!state.cases.length) {
    return `<div class="empty-box" data-timeline-day="${today}">Không có ca điều trị ngày ${displayDate(today)}.</div>`;
  }
  const now = TBVNSync.now();
  const dayStart = Date.parse(`${today}T00:00:00+07:00`);
  const minuteOfDay = epoch => (epoch - dayStart) / 60000;
  const actualRange = c => {
    if (!c.started || !Number.isFinite(c.actualStartedAt)) return null;
    const start = minuteOfDay(c.actualStartedAt);
    const end = c.completed && c.finishedAt ? minuteOfDay(c.finishedAt)
      : c.running && c.deadline ? minuteOfDay(c.deadline) : null;
    return { start, end };
  };
  const appointmentDay = c => c.appointmentDate || vietnamDate(Date.parse(c.createdAt));
  const todayCases = state.cases.filter(c => {
    const actual = actualRange(c);
    return appointmentDay(c) === today || (actual && actual.start < 1440 &&
      (actual.end == null ? actual.start >= 0 : actual.end >= 0));
  });
  if (!todayCases.length) return `<div class="empty-box" data-timeline-day="${today}">Không có ca điều trị ngày ${displayDate(today)}.</div>`;
  const lows = [480, ...todayCases.filter(c => appointmentDay(c) === today).map(c => startMinutes(c.start))];
  const highs = [1200, ...todayCases.filter(c => appointmentDay(c) === today).map(c => startMinutes(c.start) + c.plannedSec / 60)];
  todayCases.forEach(c => {
    const actual = actualRange(c);
    if (actual) {
      if (actual.start >= 0) lows.push(actual.start);
      if (actual.end != null) highs.push(actual.end);
    }
  });
  const lo = Math.max(0, Math.min(8, Math.floor(Math.min(...lows) / 60)));
  const hi = Math.min(48, Math.max(20, Math.ceil(Math.max(...highs) / 60)));
  const span = Math.max(1, hi - lo);
  const ordered = [...todayCases].sort((a,b) => startMinutes(a.start) - startMinutes(b.start));
  const width = span * 84;
  const clockMin = minuteOfDay(now);
  const nowPct = (clockMin - lo * 60) / (span * 60) * 100;
  const marks = [];
  for (let h = lo; h <= hi; h += 2) marks.push(`<span class="axis-mark ${h === lo ? 'first' : h === hi ? 'last' : ''}" style="left:${(h-lo)/span*100}%">${pad(h%24)}:00${h >= 24 ? ` +${Math.floor(h/24)} ngày` : ''}</span>`);

  return `
    <div class="timeline-scroll" data-timeline-day="${today}">
      <div class="timeline-board" style="min-width:${280 + width}px;grid-template-columns:280px minmax(${width}px,1fr)">
        <div class="timeline-side">
          <div class="timeline-top">KHÁCH HÀNG</div>
          ${ordered.map(c => `
            <div class="timeline-name">
              <b>${esc(c.name)}</b>
              <small class="timeline-scheduled-time">Hẹn ${esc(c.start)}–${esc(scheduledEnd(c))}</small>
              ${c.actualStartedAt ? `<small class="timeline-actual-time">Thực tế ${esc(clockFromEpoch(c.actualStartedAt, now))}–${c.running ? `Dự kiến ${esc(actualEnd(c, now))}` : esc(actualEnd(c, now))}</small>` : `<div class="timeline-waiting-state"><span class="timeline-waiting-badge">Chưa bắt đầu<small lang="ja">未開始</small></span>${lateBadgeHTML(c, now)}</div>`}
            </div>
          `).join('')}
        </div>
        <div class="timeline-main">
          <div class="timeline-axis" style="--axis-step:${200/span}%">${marks.join('')}</div>
          <div class="timeline-bars">
            ${ordered.map(c => {
              const a = startMinutes(c.start);
              const left = (a - lo * 60) / (span * 60) * 100;
              const widthPct = Math.max(0, Math.min(100 - left, (c.plannedSec / 60) / (span * 60) * 100));
              const st = caseStatus(c);
              const actual = actualRange(c);
              const actualLeft = actual ? clamp((actual.start - lo * 60) / (span * 60) * 100, 0, 100) : 0;
              const actualRight = actual?.end == null ? actualLeft : clamp((actual.end - lo * 60) / (span * 60) * 100, 0, 100);
              return `<div class="timeline-row">
                ${appointmentDay(c) === today ? `<div class="timeline-bar scheduled" style="left:${left}%;width:${widthPct}%" aria-hidden="true"></div>` : ''}
                ${actual ? (actual.end != null && actualRight > actualLeft ? `<div class="timeline-bar actual ${st}" style="left:${actualLeft}%;width:${actualRight - actualLeft}%" aria-hidden="true"></div>` : actual.start >= 0 ? `<div class="timeline-actual-marker ${st}" style="left:${actualLeft}%" aria-hidden="true"></div>` : '') : ''}
              </div>`;
            }).join('')}
            <div class="timeline-now" data-axis-start="${lo}" data-axis-span="${span}" style="left:${nowPct}%;${today !== vietnamDate(now) || nowPct < 0 || nowPct > 100 ? 'display:none' : ''}"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function casesHTML() {
  const list = visibleCases();
  if (!list.length) {
    state.casePage = 1;
    return `<div class="empty-box">Không có ca nào phù hợp bộ lọc hiện tại.</div>`;
  }
  const pages = Math.ceil(list.length / CASES_PER_PAGE);
  state.casePage = clamp(state.casePage, 1, pages);
  const shown = list.slice((state.casePage - 1) * CASES_PER_PAGE, state.casePage * CASES_PER_PAGE);
  return `<div class="cases-grid">${shown.map(caseCardHTML).join('')}</div>${list.length > CASES_PER_PAGE ?
    `<nav class="case-pagination" aria-label="Phân trang danh sách ca điều trị">
      <button type="button" class="button" data-action="case-page" data-page="${state.casePage - 1}" ${state.casePage === 1 ? 'disabled' : ''}>← Trước</button>
      <span>Trang ${state.casePage} / ${pages}<small lang="ja">${pages}ページ中 ${state.casePage}ページ</small></span>
      <button type="button" class="button" data-action="case-page" data-page="${state.casePage + 1}" ${state.casePage === pages ? 'disabled' : ''}>Sau →</button>
    </nav>` : ''}`;
}
function caseCardHTML(c) {
  const st = caseStatus(c);
  const total = Math.round(c.plannedSec / 60);
  const scheduleOverlap = scheduledOverlapCount(c);
  const concurrent = concurrentRunningCount(c);
  const date = displayDate(c.appointmentDate || vietnamDate(Date.parse(c.createdAt)));
  return `
    <article class="case-card ${highlightedCaseId === c.id ? 'case-highlight-target' : ''}" id="case-${esc(c.id)}" data-case-id="${esc(c.id)}" tabindex="-1">
      <div class="case-head">
        <div class="case-id">${initials(c.name)}</div>
        <div class="case-meta">
          <h3>${esc(c.name)}</h3>
          <p>${[c.sex, c.age ? `${c.age} tuổi` : '', `Hẹn ${date} ${c.start}`].filter(Boolean).join(' · ')}</p>
          <div class="case-assignment"><span class="room-badge" data-room="${esc(c.room || '')}">${esc(roomLabel(c.room))}</span><span class="doctor-display">Dr: ${esc(c.technician || 'Chưa cập nhật')}<small lang="ja">医師</small></span></div>
          ${lateBadgeHTML(c)}
          <div class="case-time-facts"><span class="time-fact scheduled">Theo lịch: ${date} ${esc(c.start)} → ${esc(scheduledEnd(c))}<small lang="ja">予約時間</small></span><span class="time-fact started">Bắt đầu thực tế: ${c.actualStartedAt ? esc(clockFromEpoch(c.actualStartedAt)) : 'Chưa bắt đầu'}<small lang="ja">実際の開始</small></span><span class="time-fact ${c.completed ? 'finished' : 'expected'}">${c.completed ? 'Hoàn tất thực tế' : 'Kết thúc điều trị dự kiến'}: ${esc(actualEnd(c))}<small lang="ja">${c.completed ? '実際の終了' : '終了予定'}</small></span></div>
        </div>
        <span class="status ${st}" data-status="${c.id}">${statusText(st)}</span>
      </div>

      <div class="case-info-row">
        <div class="info-chip"><small>Tổng thời lượng</small><b>${total} phút</b></div>
        <div class="info-chip"><small>Số dịch vụ</small><b>${c.items.length}</b></div>
        <div class="info-chip ${scheduleOverlap ? 'warn' : ''}"><small>Trùng lịch hẹn</small><b>${scheduleOverlap}</b></div>
        <div class="info-chip ${concurrent ? 'warn' : ''}"><small>Ca đang chạy cùng lúc</small><b>${concurrent}</b></div>
      </div>

      <div class="timer-box">
        <small data-timer-label="${c.id}">${st === 'overdue' ? 'QUÁ GIỜ ĐIỀU TRỊ' : st === 'done' ? 'ĐÃ HOÀN THÀNH' : st === 'waiting' ? 'THỜI LƯỢNG ĐIỀU TRỊ (CHƯA CHẠY)' : 'THỜI GIAN CÒN LẠI'}</small>
        <div class="timer-number ${st === 'overdue' ? 'overdue' : ''}" data-clock="${c.id}">${formatTimer(caseLeft(c))}</div>
        <div class="progress"><span data-progress="${c.id}" style="width:${clamp((1 - Math.max(caseLeft(c), 0) / countdownBaseline(c)) * 100, 0, 100)}%"></span></div>
      </div>

      ${c.completed ? '' : `<div class="case-controls">
        ${c.running ? `<button class="button" data-action="pause" data-id="${c.id}">⏸ Tạm dừng</button>` : `<button class="button button-primary" data-action="start" data-id="${c.id}">▶ Bắt đầu</button>`}
        <button class="button" data-action="adjust" data-id="${c.id}" data-val="-1">−1 phút</button>
        <button class="button" data-action="adjust" data-id="${c.id}" data-val="1">+1 phút</button>
        <button class="button" data-action="reset" data-id="${c.id}">↺ Đặt lại</button>
      </div>`}

      <div class="case-sub-controls">
        <button class="text-btn" data-action="expand" data-id="${c.id}">Xem chi tiết</button>
        <div class="inline-actions">
          <button class="text-btn" data-action="edit" data-id="${c.id}">Sửa</button>
          ${c.completed ? '' : `<button class="text-btn" data-action="finish" data-id="${c.id}">Hoàn tất</button>`}
          <button class="text-btn danger" data-action="delete" data-id="${c.id}">Xóa</button>
        </div>
      </div>

    </article>
  `;
}
function statusText(st) {
  return { waiting:'Chưa bắt đầu', running:'Đang chạy', paused:'Tạm dừng', overdue:'Quá giờ điều trị', done:'Hoàn tất' }[st] || 'Chưa bắt đầu';
}

function builderHTML() {
  const detailStep = state.form.step === 'indications';
  const tech = detailStep ? activeBuilderTech() : null;
  const errorClass = key => state.form.errors[key] ? ' field-error' : '';
  const errorText = key => `<small class="field-message" role="alert">${esc(state.form.errors[key] || '')}</small>`;
  return `
    <section class="builder-page">
      <div class="builder-top">
        <div>
          <button class="back-link" data-action="${detailStep ? 'back-to-techs' : 'cancel-builder'}">← ${detailStep ? 'Quay lại chọn kỹ thuật' : 'Quay lại bảng điều phối'}</button>
          <h1>${detailStep ? 'Chọn chỉ định điều trị' : state.form.editing ? 'Chỉnh sửa ca điều trị' : 'Tạo ca điều trị mới'}</h1>
          <p>${detailStep ? `Kỹ thuật ${esc(tech?.en || '')}. Chọn các chỉ định cần thêm vào ca điều trị.` : 'Chọn kỹ thuật trước, sau đó chọn chỉ định điều trị tương ứng.'}</p>
        </div>
        <div class="builder-actions-top">
          <button class="button" data-action="cancel-builder">Hủy</button>
          <button class="button button-primary" data-action="save-case" ${canSaveCase() ? '' : 'disabled'}>${state.form.editing ? 'Lưu thay đổi' : '＋ Tạo ca'}</button>
        </div>
      </div>

      ${detailStep ? '' : `<section class="panel builder-info">
        <div class="field-grid">
          <label class="field field-wide${errorClass('name')}" data-field="name"><span>Tên khách hàng</span><input id="formName" maxlength="80" value="${esc(state.form.name)}" aria-invalid="${!!state.form.errors.name}" placeholder="Ví dụ: Nguyễn Thị A">${errorText('name')}</label>
          <label class="field${errorClass('age')}" data-field="age"><span>Tuổi (tùy chọn)</span><input id="formAge" type="number" min="0" max="120" value="${esc(state.form.age)}" aria-invalid="${!!state.form.errors.age}" placeholder="—">${errorText('age')}</label>
          <label class="field${errorClass('sex')}" data-field="sex"><span>Giới tính</span><select id="formSex" aria-invalid="${!!state.form.errors.sex}"><option value="">Không chọn / 選択しない</option>${[['Nam','男性'],['Nữ','女性'],['Khác','その他']].map(([v,jp]) => `<option value="${v}" ${state.form.sex===v?'selected':''}>${v} / ${jp}</option>`).join('')}</select>${errorText('sex')}</label>
          <label class="field${errorClass('appointmentDate')}" data-field="appointmentDate"><span>Ngày hẹn điều trị</span><input id="formAppointmentDate" type="date" value="${esc(state.form.appointmentDate)}" aria-invalid="${!!state.form.errors.appointmentDate}">${errorText('appointmentDate')}</label>
          <label class="field${errorClass('start')}" data-field="start"><span>Giờ hẹn điều trị</span><input id="formStart" type="time" value="${esc(state.form.start)}" aria-invalid="${!!state.form.errors.start}">${errorText('start')}</label>
          <label class="field field-technician${errorClass('technician')}" data-field="technician"><span>Dr (tùy chọn)</span><input id="formTechnician" maxlength="80" value="${esc(state.form.technician)}" aria-invalid="${!!state.form.errors.technician}" placeholder="Ví dụ: Bác sĩ A">${errorText('technician')}</label>
          <div class="field field-room${errorClass('room')}" data-field="room"><span>Phòng điều trị</span><div class="room-options" role="group" aria-label="Phòng điều trị">${ROOMS.map(room => `<button type="button" class="room-option ${state.form.room === room.id ? 'selected' : ''}" data-action="set-room" data-room="${room.id}" aria-pressed="${state.form.room === room.id}"><span class="room-icon" aria-hidden="true">▣</span>${room.label}</button>`).join('')}</div>${errorText('room')}</div>
        </div>
      </section>`}

      <div class="builder-layout">
        <div class="builder-main">
          ${detailStep ? `<section class="panel panel-space" id="techniqueDetail">
            ${builderDetailHTML(tech)}
          </section>` : `<section class="panel panel-space">
            <div class="section-head section-stack">
              <div>
                <h2>01 · Chọn kỹ thuật</h2>
                <p>Tên kỹ thuật được hiển thị lớn. Bấm vào một kỹ thuật để mở nhóm chỉ định điều trị của nó.</p>
              </div>
              <div class="search-wrap search-grow"><span class="search-icon">⌕</span><input class="search" id="builderSearch" type="search" placeholder="Tìm tên kỹ thuật hoặc chỉ định..." value="${esc(state.form.techSearch)}"></div>
            </div>
            <div class="chip-wrap" id="builderGroupChips">${builderGroupChipsHTML()}</div>
            <div id="techniquesGrid">${builderTechniqueCardsHTML()}</div>
          </section>`}
        </div>

        <aside class="panel panel-space builder-side" id="builderSummary">
          ${builderSummaryHTML()}
        </aside>
      </div>
    </section>
  `;
}
function builderGroupChipsHTML() {
  return `<button class="chip ${!state.form.group ? 'active' : ''}" data-action="builder-group" data-group="">Tất cả</button>` +
    ALL_GROUPS.map(group => `<button class="chip ${state.form.group===group?'active':''}" data-action="builder-group" data-group="${esc(group)}">${esc(group)}</button>`).join('');
}
function techCardGroupHTML(t) {
  return `<div class="tech-card-group">
    <small>Nhóm dịch vụ: ${esc(t.group_vi)}</small>
    <small lang="ja">${esc(t.group_jp)}</small>
  </div>`;
}
function builderTechniqueCardsHTML() {
  const visible = builderTechs();
  if (!visible.length) return `<div class="empty-box">Không tìm thấy kỹ thuật phù hợp.</div>`;
  return `<div class="tech-grid">${visible.map(t => {
    const totalMin = t.inds.map(ind => ind.base).sort((a,b)=>a-b);
    const summary = totalMin.length ? (totalMin[0]===totalMin.at(-1) ? `${totalMin[0]} phút` : `${totalMin[0]}–${totalMin.at(-1)} phút`) : '—';
    return `
      <button class="tech-card" data-action="choose-tech" data-tech="${esc(t.stt)}">
        <div class="tech-card-code">${esc(t.stt)}</div>
        <div class="tech-card-content">
          <h3>${esc(t.en)}</h3>
          <div class="tech-card-meta">
            <span>${t.inds.length} chỉ định</span>
            <span>${esc(summary)}</span>
          </div>
          ${techCardGroupHTML(t)}
          <div class="tech-card-link">Xem chỉ định điều trị →</div>
        </div>
      </button>
    `;
  }).join('')}</div>`;
}
function builderDetailHTML(tech) {
  if (!tech) return `<div class="empty-box">Chọn một kỹ thuật để xem nhóm chỉ định điều trị.</div>`;
  const totalMin = tech.inds.map(ind => ind.base).sort((a,b)=>a-b);
  const summary = totalMin.length ? (totalMin[0]===totalMin.at(-1) ? `${totalMin[0]} phút` : `${totalMin[0]}–${totalMin.at(-1)} phút`) : '—';
  return `
    <div class="detail-head">
      <div class="detail-code">${esc(tech.stt)}</div>
      <div class="detail-copy">
        <h2>${esc(tech.en)}</h2>
        <p>Chỉ định điều trị thuộc kỹ thuật này</p>
      </div>
      <div class="detail-stats">
        <div><small>Chỉ định</small><b>${tech.inds.length}</b></div>
        <div><small>Thời gian</small><b>${esc(summary)}</b></div>
      </div>
    </div>
    <div class="detail-indications">
      ${tech.inds.map(ind => builderIndicationRowHTML(ind)).join('')}
    </div>
  `;
}
function builderIndicationRowHTML(ind) {
  const chosen = state.form.opts.has(ind.id);
  return `
    <button class="ind-row ${chosen?'selected':''}" data-action="toggle-service" data-service="${esc(ind.id)}" aria-pressed="${chosen}">
      <span class="ind-check">${chosen ? '✓' : ''}</span>
      <span class="ind-copy"><b>${esc(ind.vi)}</b>${ind.jp ? `<small lang="ja">${esc(ind.jp)}</small>` : ''}</span>
      <span class="ind-time">${esc(durationLabel(ind.raw))}</span>
    </button>
  `;
}
function builderSummaryHTML() {
  const total = formMinutes();
  const validStart = /^([01]\d|2[0-3]):[0-5]\d$/.test(state.form.start);
  const scheduled = validStart && !formErrors().appointmentDate
    ? Date.parse(`${state.form.appointmentDate}T${state.form.start}:00+07:00`) : NaN;
  const end = Number.isFinite(scheduled) ? clockFromEpoch(scheduled + total * 60000) : 'Chưa cập nhật';
  const list = selectedArray();
  return `
    <section class="case-summary-info">
      <h2>Thông tin ca điều trị</h2>
      <strong class="summary-customer">${esc(state.form.name.trim() || 'Chưa cập nhật')}</strong>
      <div class="summary-facts">
        <div><small>Tuổi</small><span>${esc(state.form.age === '' ? 'Chưa cập nhật' : state.form.age)}</span></div>
        <div><small>Giới tính</small><span>${esc(state.form.sex || 'Chưa cập nhật')}</span></div>
        <div><small>Bác sĩ</small><span>${esc(state.form.technician.trim() || 'Chưa cập nhật')}</span></div>
        <div><small>Phòng điều trị</small><span class="room-badge">${esc(roomLabel(state.form.room))}</span></div>
        <div><small>Ngày hẹn điều trị</small><span>${esc(state.form.appointmentDate || 'Chưa cập nhật')}</span></div>
        <div><small>Giờ hẹn điều trị</small><span>${esc(state.form.start || 'Chưa cập nhật')}</span></div>
      </div>
    </section>
    <div class="summary-head">
      <h2>02 · Đã chọn</h2>
      <span class="count-badge">${list.length}</span>
    </div>
    <div class="summary-list" id="selectedList">
      ${list.length ? list.map(selectedItemHTML).join('') : `<div class="empty-box compact">Chưa chọn chỉ định nào. Hãy bấm vào các chỉ định ở bên trái để thêm vào ca điều trị.</div>`}
    </div>
    <div class="summary-total">
      <div>
        <small>TỔNG THỜI GIAN DỰ KIẾN</small>
        <b id="formTotal">${total} phút</b>
      </div>
      <div class="summary-end">
        <small>KẾT THÚC THEO LỊCH</small>
        <b id="formEnd">${Number.isFinite(scheduled) ? `${esc(state.form.start)} → ${esc(end)}` : esc(end)}</b>
      </div>
    </div>
    <div class="summary-actions">
      <button class="button" data-action="cancel-builder">Hủy</button>
      <button class="button button-primary" data-action="save-case" ${canSaveCase() ? '' : 'disabled'}>${state.form.editing ? 'Lưu thay đổi' : '＋ Tạo ca'}</button>
    </div>
  `;
}
function selectedItemHTML(item) {
  const svc = SERVICE_BY[item.id];
  return `
    <div class="selected-item">
      <div class="selected-head">
        <div>
          <b>${esc(svc.vi)}</b>
          <small>${esc(svc.tech)} · Gốc: ${esc(durationLabel(svc.raw))}</small>
        </div>
        <button class="remove-btn" data-action="remove-service" data-service="${esc(item.id)}">×</button>
      </div>
      <div class="selected-controls">
        <label>Phút <input type="number" min="1" max="600" step="1" data-edit-min="${esc(item.id)}" value="${item.minutes}"></label>
        ${item.perUnit ? `<label>Số nốt <input type="number" min="1" max="100" step="1" data-edit-qty="${esc(item.id)}" value="${item.qty}"></label>` : `<span class="selected-note">${minsLabel(item.minutes)}</span>`}
      </div>
    </div>
  `;
}

function catalogHTML() {
  const active = activeCatalogTech();
  return `
    <section class="catalog-page">
      <div class="catalog-top">
        <div>
          <div class="eyebrow">DANH MỤC · TRANG TÍNH 4</div>
          <h1>Bảng thời lượng kỹ thuật</h1>
          <p>Lọc theo nhóm dịch vụ, xem kỹ thuật lớn rõ ràng và bấm vào để mở danh sách chỉ định điều trị.</p>
        </div>
        <button class="button button-primary" data-action="open-new">＋ Tạo ca mới</button>
      </div>
      <section class="panel panel-space">
        <div class="section-head section-stack">
          <div><h2>Danh sách kỹ thuật</h2><p>Nhóm dịch vụ chỉ dùng để lọc. Tên kỹ thuật được ưu tiên hiển thị lớn hơn.</p></div>
          <div class="search-wrap search-grow"><span class="search-icon">⌕</span><input class="search" id="catalogSearch" type="search" placeholder="Tìm Botox, HIFU, Mesotherapy..." value="${esc(state.catalogSearch)}"></div>
        </div>
        <div class="chip-wrap" id="catalogChips">${catalogGroupChipsHTML()}</div>
        <div id="catalogBody">
          <div class="catalog-layout">
            <div class="catalog-techs">${catalogTechniqueCardsHTML()}</div>
            <div class="catalog-detail panel panel-soft">${catalogDetailHTML(active)}</div>
          </div>
        </div>
      </section>
    </section>
  `;
}
function catalogGroupChipsHTML() {
  return `<button class="chip ${!state.catalogGroup ? 'active' : ''}" data-action="catalog-group" data-group="">Tất cả</button>` +
    ALL_GROUPS.map(group => `<button class="chip ${state.catalogGroup===group?'active':''}" data-action="catalog-group" data-group="${esc(group)}">${esc(group)}</button>`).join('');
}
function catalogTechniqueCardsHTML() {
  const visible = catalogTechs();
  if (!visible.length) return `<div class="empty-box">Không tìm thấy kỹ thuật phù hợp.</div>`;
  return `<div class="tech-grid">${visible.map(t => {
    const totalMin = t.inds.map(ind => ind.base).sort((a,b)=>a-b);
    const summary = totalMin.length ? (totalMin[0]===totalMin.at(-1) ? `${totalMin[0]} phút` : `${totalMin[0]}–${totalMin.at(-1)} phút`) : '—';
    return `
      <button class="tech-card ${state.catalogActiveTechId===t.stt?'active':''}" data-action="catalog-tech" data-tech="${esc(t.stt)}">
        <div class="tech-card-code">${esc(t.stt)}</div>
        <div class="tech-card-content">
          <h3>${esc(t.en)}</h3>
          <div class="tech-card-meta"><span>${t.inds.length} chỉ định</span><span>${esc(summary)}</span></div>
          ${techCardGroupHTML(t)}
          <div class="tech-card-link">Mở chỉ định điều trị →</div>
        </div>
      </button>
    `;
  }).join('')}</div>`;
}
function catalogDetailHTML(tech) {
  if (!tech) return `<div class="empty-box">Chọn một kỹ thuật để xem các chỉ định điều trị.</div>`;
  return `
    <div class="detail-head compact">
      <div class="detail-code">${esc(tech.stt)}</div>
      <div class="detail-copy"><h2>${esc(tech.en)}</h2><p>${tech.inds.length} chỉ định điều trị</p></div>
    </div>
    <div class="detail-indications">
      ${tech.inds.map(ind => `
        <div class="ind-row static">
          <span class="ind-check ghost"></span>
          <span class="ind-copy"><b>${esc(ind.vi)}</b>${ind.jp ? `<small lang="ja">${esc(ind.jp)}</small>` : ''}</span>
          <span class="ind-time">${esc(durationLabel(ind.raw))}</span>
        </div>
      `).join('')}
    </div>
    <div class="catalog-cta"><button class="button button-primary" data-action="quick-tech" data-tech="${esc(tech.stt)}">Chọn kỹ thuật này cho ca mới</button></div>
  `;
}

function mapCase(row) {
  const previous = state.cases.find(c => c.id === row.id);
  const items = (Array.isArray(row.items) ? row.items : []).filter(item => SERVICE_BY[item?.id])
    .map(item => ({
      id: item.id,
      minutes: clamp(Math.round(Number(item.minutes) || 1), 1, 600),
      perUnit: SERVICE_BY[item.id].perUnit,
      qty: clamp(Math.round(Number(item.qty) || 1), 1, 100)
    }));
  return {
    id: row.id, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at,
    name: row.name, age: row.age, sex: row.sex, technician: row.technician || '', room: ROOM_BY[row.room] ? row.room : null, appointmentDate: row.appointment_date || null, start: row.start_time.slice(0, 5),
    items, plannedSec: row.planned_sec, remaining: row.remaining_sec,
    deadline: row.deadline_at ? Date.parse(row.deadline_at) : 0,
    actualStartedAt: row.actual_started_at ? Date.parse(row.actual_started_at) : null,
    finishedAt: row.finished_at ? Date.parse(row.finished_at) : null,
    running: row.running, started: row.started, completed: row.completed,
    notified: previous?.notified || false
  };
}
function upsertCase(row) {
  const c = mapCase(row);
  state.cases = [...state.cases.filter(item => item.id !== c.id), c]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
let loadSequence = 0;
async function loadCases() {
  if (state.connection !== 'ready' || state.syncBusy) return;
  const sequence = ++loadSequence;
  try {
    await TBVNSync.clock();
    const rows = await TBVNSync.list();
    if (sequence !== loadSequence || state.connection !== 'ready') return;
    state.cases = rows.map(mapCase);
    state.expanded = new Set([...state.expanded].filter(id => state.cases.some(c => c.id === id)));
    const hadError = !!state.syncError;
    state.syncError = '';
    if (state.view === 'dashboard' || hadError) render();
  } catch (error) {
    console.error('Không thể đồng bộ ca điều trị:', error);
    state.syncError = 'Kết nối dữ liệu bị gián đoạn. Thông tin đang hiển thị có thể chưa mới nhất.';
    render();
  }
}
function mutationError(error) {
  console.error('Không thể lưu ca điều trị:', error);
  const message = error?.message || '';
  const code = error?.code || '';
  if (/TBVN_CONFLICT_OR_EXPIRED/.test(message)) {
    if (state.form?.editing) closeForm('dashboard');
    toast('Ca đã được máy khác cập nhật hoặc đã hết hạn. Vui lòng kiểm tra lại.', 8000);
  } else if ((code === 'PGRST204' || code === '42703') && /room/i.test(message)) {
    toast('Supabase thiếu cột room trong tbvn_cases. Chạy file supabase_start_time_upgrade.sql rồi thử lại.', 10000);
  } else if ((code === 'PGRST204' || code === '42703') && /appointment_date/i.test(message)) {
    toast('Supabase thiếu cột appointment_date. Chạy file supabase_start_time_upgrade.sql trước khi dùng bản này.', 10000);
  } else if (code === 'PGRST204' || code === '42703') {
    toast(`Supabase thiếu cột dữ liệu: ${message}`, 10000);
  } else if (code === '42501' || /row.level security|permission denied/i.test(message)) {
    toast('Supabase từ chối quyền tạo ca. Kiểm tra quyền INSERT và RLS của bảng tbvn_cases.', 10000);
  } else if (/TBVN_INVALID_CASE|Invalid (room|name|sex|start|age|items)/i.test(message)) {
    toast(`Dữ liệu ca không hợp lệ: ${message}`, 10000);
  } else {
    toast(`Lưu chưa thành công${code ? ` (${code})` : ''}: ${message || 'Kiểm tra kết nối rồi thử lại.'}`, 10000);
  }
  setTimeout(loadCases, 0);
}
async function withMutation(work, onSuccess) {
  if (state.syncBusy) return;
  state.syncBusy = true;
  document.querySelectorAll('[data-action="save-case"]').forEach(button => button.disabled = true);
  toast('Đang lưu dữ liệu…');
  try {
    const result = await work();
    loadSequence++;
    onSuccess(result);
  } catch (error) {
    mutationError(error);
  } finally {
    state.syncBusy = false;
    updateFormErrors();
  }
}
function saveCase() {
  const f = state.form;
  if (!f || state.syncBusy) return;
  if (showFormErrors()) return;
  if (!f.opts.size) {
    toast('Hãy chọn ít nhất một chỉ định điều trị.');
    return;
  }
  const planned = formMinutes();
  if (planned < 1 || planned > 2880) {
    toast('Thời lượng cần nằm trong khoảng 1–2880 phút.');
    return;
  }
  if (!validSelections()) {
    toast('Vui lòng kiểm tra thời lượng và số lượng của các chỉ định.');
    return;
  }
  const name = f.name.trim();
  const technician = f.technician.trim();
  const items = selectedArray().map(it => ({ ...it }));
  if (f.editing) {
    const c = state.cases.find(x => x.id === f.editing);
    if (!c) {
      closeForm();
      return;
    }
    const onlyRoomChanged = c.room !== f.room && name === c.name && f.age === c.age && f.sex === c.sex &&
      technician === c.technician && f.appointmentDate === (c.appointmentDate || vietnamDate(Date.parse(c.createdAt))) && f.start === c.start && planned * 60 === c.plannedSec &&
      JSON.stringify(items) === JSON.stringify(c.items);
    const appointmentDateForSave = !c.appointmentDate && f.appointmentDate === vietnamDate(Date.parse(c.createdAt))
      ? null : f.appointmentDate;
    withMutation(() => TBVNSync.change(c, onlyRoomChanged ? 'set_room' : 'edit', onlyRoomChanged ? { room: f.room } : {
      name, age: f.age, sex: f.sex, technician, room: f.room, appointment_date: appointmentDateForSave, start_time: f.start,
      items, planned_sec: planned * 60
    }), row => {
      upsertCase(row);
      closeForm('dashboard');
      toast('Đã cập nhật ca điều trị.');
    });
  } else {
    withMutation(() => TBVNSync.insert({
      id: f.insertId,
      name,
      age: f.age,
      sex: f.sex,
      technician,
      room: f.room,
      appointment_date: f.appointmentDate,
      start_time: f.start,
      items,
      planned_sec: planned * 60,
      remaining_sec: planned * 60
    }), row => {
      upsertCase(row);
      closeForm('dashboard');
      toast('Đã tạo ca mới. Nhấn “Bắt đầu” để chạy đồng hồ.');
    });
  }
}

function startCase(c) {
  if (!c || c.completed) return;
  enableSound();
  changeCase(c, 'start');
}
function pauseCase(c) {
  if (!c || !c.running) return;
  changeCase(c, 'pause');
}
function resetCase(c) {
  if (!c) return;
  changeCase(c, 'reset');
}
function adjustCase(c, minutes) {
  if (!c || c.completed) return;
  const total = c.plannedSec / 60 + minutes;
  if (total < 1 || total > 2880) {
    toast('Thời lượng cần nằm trong khoảng 1–2880 phút.');
    return;
  }
  changeCase(c, 'adjust', { minutes });
}
function finishCase(c) {
  if (!c) return;
  changeCase(c, 'finish');
}
function changeCase(c, action, data = {}) {
  withMutation(() => TBVNSync.change(c, action, data), row => {
    upsertCase(row);
    if (action === 'start' || action === 'reset' || action === 'adjust') {
      const updated = state.cases.find(item => item.id === c.id);
      if (updated && caseLeft(updated) > 0) updated.notified = false;
    }
    render();
    toast('Đã lưu thay đổi.');
  });
}

function refreshLive() {
  if (state.connection !== 'ready') return;
  const active = state.cases.filter(c => Date.parse(c.expiresAt) > TBVNSync.now());
  if (active.length !== state.cases.length) {
    state.cases = active;
    render();
  }
  document.querySelectorAll('[data-now]').forEach(el => el.textContent = currentTime());
  document.querySelectorAll('[data-date]').forEach(el => el.textContent = readableDate());
  if (state.view !== 'dashboard') return;
  let changedStatus = false;
  let lateFilterChanged = false;
  let roomPriorityChanged = false;
  const now = TBVNSync.now();
  for (const c of state.cases) {
    const left = caseLeft(c, now);
    const st = caseStatus(c, now);
    const late = appointmentDelayMinutes(c, now);
    if (c.lastStatus && c.lastStatus !== st) changedStatus = true;
    c.lastStatus = st;
    if ((c.lastLateMinutes > 0) !== (late > 0)) roomPriorityChanged = true;
    if (state.filter === 'late' && (c.lastLateMinutes > 0) !== (late > 0)) lateFilterChanged = true;
    c.lastLateMinutes = late;
    document.querySelectorAll(`[data-late="${c.id}"]`).forEach(badge => {
      badge.hidden = late === 0;
      if (badge.firstChild?.nodeType === Node.TEXT_NODE) badge.firstChild.textContent = `Trễ bắt đầu ${late} phút`;
      const japanese = badge.querySelector('[lang="ja"]');
      if (japanese) japanese.textContent = `開始遅れ ${late}分`;
    });
    const clock = document.querySelector(`[data-clock="${c.id}"]`);
    if (clock) {
      clock.textContent = formatTimer(left);
      clock.classList.toggle('overdue', st === 'overdue');
    }
    const roomClock = document.querySelector(`[data-room-clock="${c.id}"]`);
    if (roomClock) roomClock.textContent = formatTimer(left);
    const timerLabel = document.querySelector(`[data-timer-label="${c.id}"]`);
    if (timerLabel) timerLabel.textContent = st === 'overdue' ? 'QUÁ GIỜ ĐIỀU TRỊ' : st === 'done' ? 'ĐÃ HOÀN THÀNH' : st === 'waiting' ? 'THỜI LƯỢNG ĐIỀU TRỊ (CHƯA CHẠY)' : 'THỜI GIAN CÒN LẠI';
    const progress = document.querySelector(`[data-progress="${c.id}"]`);
    if (progress) progress.style.width = clamp((1 - Math.max(left, 0) / countdownBaseline(c)) * 100, 0, 100) + '%';
    const badge = document.querySelector(`[data-status="${c.id}"]`);
    if (badge) {
      if (!badge.classList.contains(st)) changedStatus = true;
      badge.className = 'status ' + st;
      badge.textContent = statusText(st);
    }
    if (st === 'overdue' && !c.notified) {
      c.notified = true;
      beep();
      toast(`${c.name} đã đến thời gian dự kiến hoàn thành.`);
    }
  }
  const s = stats();
  Object.entries(s).forEach(([key, val]) => document.querySelectorAll(`[data-stat="${key}"]`).forEach(el => el.textContent = val));
  const nowMarker = document.querySelector('[data-axis-start][data-axis-span]');
  if (nowMarker) {
    const date = vietnamParts(now);
    const current = Number(date.hour) * 60 + Number(date.minute) + Number(date.second) / 60;
    const position = (current - Number(nowMarker.dataset.axisStart) * 60) / (Number(nowMarker.dataset.axisSpan) * 60) * 100;
    nowMarker.style.left = `${position}%`;
    nowMarker.style.display = selectedTimelineDate() !== vietnamDate(now) || position < 0 || position > 100 ? 'none' : '';
  }
  if ($('#timelineContent [data-timeline-day]')?.dataset.timelineDay !== selectedTimelineDate()) {
    renderTimelineSelection();
  }
  if (changedStatus || lateFilterChanged) {
    const cases = $('#casesContent');
    if (cases) cases.innerHTML = casesHTML();
    const tl = $('#timelineContent');
    if (tl) tl.innerHTML = timelineHTML();
  }
  if (changedStatus || roomPriorityChanged) {
    const rooms = $('#roomBoard');
    if (rooms) {
      const positions = new Map(Array.from(rooms.querySelectorAll('.room-case-list'))
        .map(list => [list.dataset.room, list.scrollTop]));
      rooms.innerHTML = roomBoardHTML();
      rooms.querySelectorAll('.room-case-list').forEach(list => {
        list.scrollTop = positions.get(list.dataset.room) || 0;
      });
    }
  }
}

function renderBuilderPanels() {
  if (!state.form) return;
  if (state.form.step === 'indications') {
    $('#techniqueDetail').innerHTML = builderDetailHTML(activeBuilderTech());
  } else {
    ensureBuilderActiveTech();
    $('#builderGroupChips').innerHTML = builderGroupChipsHTML();
    $('#techniquesGrid').innerHTML = builderTechniqueCardsHTML();
  }
  $('#builderSummary').innerHTML = builderSummaryHTML();
  updateFormErrors();
}
function renderCatalogPanels() {
  ensureCatalogActiveTech();
  $('#catalogChips').innerHTML = catalogGroupChipsHTML();
  const body = $('#catalogBody');
  if (body) body.innerHTML = `<div class="catalog-layout"><div class="catalog-techs">${catalogTechniqueCardsHTML()}</div><div class="catalog-detail panel panel-soft">${catalogDetailHTML(activeCatalogTech())}</div></div>`;
}

let deleteReturnFocus = null;
function openCaseDetailDialog(c, trigger) {
  const root = $('#modalRoot');
  root.innerHTML = `<dialog class="confirm-dialog case-detail-dialog" aria-labelledby="caseDetailTitle">
    <div class="confirm-dialog-content">
      <div class="case-detail-header"><h2 id="caseDetailTitle">${esc(c.name)}<small lang="ja">施術詳細</small></h2><button type="button" class="button" data-action="close-case-detail" aria-label="Đóng chi tiết">×</button></div>
      <div class="case-detail-summary"><span class="room-badge" data-room="${esc(c.room || '')}">${esc(roomLabel(c.room))}</span><span>${esc(statusText(caseStatus(c)))}</span></div>
      <div class="case-detail-list">${c.items.map(item => {
        const svc = SERVICE_BY[item.id];
        const qtyText = item.perUnit ? ` · ${item.qty} nốt` : '';
        return `<div class="case-detail-item"><b>${esc(svc.vi)}${svc.jp ? `<small lang="ja">${esc(svc.jp)}</small>` : ''}</b><span>${esc(svc.tech)} · ${item.minutes} phút${qtyText}</span></div>`;
      }).join('')}</div>
    </div>
  </dialog>`;
  const dialog = root.querySelector('dialog');
  dialog.addEventListener('close', () => {
    root.replaceChildren();
    if (trigger.isConnected) trigger.focus();
  }, { once: true });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.showModal();
  dialog.querySelector('[data-action="close-case-detail"]').focus();
}
function openDeleteDialog(c, trigger) {
  if (state.syncBusy || !c) return;
  deleteReturnFocus = trigger;
  const root = $('#modalRoot');
  root.innerHTML = `<dialog class="confirm-dialog" aria-labelledby="deleteDialogTitle" aria-describedby="deleteDialogMessage">
    <div class="confirm-dialog-content">
      <div class="confirm-dialog-icon" aria-hidden="true">×</div>
      <h2 id="deleteDialogTitle">Xóa ca điều trị?<small lang="ja">施術を削除しますか？</small></h2>
      <p id="deleteDialogMessage">Bạn có chắc muốn xóa ca của <strong>${esc(c.name)}</strong>?<small lang="ja">この施術を削除しますか？</small></p>
      <div class="confirm-dialog-actions">
        <button type="button" class="button bilingual-action" data-action="cancel-delete"><span class="button-vi">Hủy</span><span class="jp-line" lang="ja">キャンセル</span></button>
        <button type="button" class="button button-danger bilingual-action" data-action="confirm-delete" data-id="${esc(c.id)}"><span class="button-vi">Xóa ca</span><span class="jp-line" lang="ja">削除</span></button>
      </div>
    </div>
  </dialog>`;
  const dialog = root.querySelector('dialog');
  dialog.addEventListener('close', () => {
    root.replaceChildren();
    if (deleteReturnFocus?.isConnected) deleteReturnFocus.focus();
    deleteReturnFocus = null;
  }, { once: true });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.showModal();
  dialog.querySelector('[data-action="cancel-delete"]').focus();
}
function closeDeleteDialog() {
  $('#modalRoot dialog')?.close();
}
function jumpToCase(id) {
  const sequence = ++jumpSequence;
  clearTimeout(jumpDelayTimer);
  clearTimeout(highlightTimer);
  document.querySelectorAll('.case-highlight-target').forEach(card => card.classList.remove('case-highlight-target'));
  highlightedCaseId = null;
  const c = state.cases.find(item => item.id === id);
  if (!c || c.completed) {
    toast('Ca này không còn trong bảng điều phối. Vui lòng tải lại danh sách.');
    return;
  }
  if (state.roomFilter !== 'all' && state.roomFilter !== c.room) state.roomFilter = 'all';
  if (!passesStatusFilter(c)) state.filter = 'all';
  const query = normalized(state.caseSearch.trim());
  if (query && !caseSearchText(c).includes(query)) state.caseSearch = '';
  const index = visibleCases().findIndex(item => item.id === id);
  if (index < 0) {
    toast('Không tìm thấy ca này trong danh sách. Vui lòng tải lại.');
    return;
  }
  state.casePage = Math.floor(index / CASES_PER_PAGE) + 1;
  render();
  requestAnimationFrame(() => {
    if (sequence !== jumpSequence) return;
    const target = document.getElementById(`case-${id}`);
    if (!target || !state.cases.some(item => item.id === id)) {
      toast('Ca này vừa được cập nhật hoặc xóa. Vui lòng tải lại danh sách.');
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    jumpDelayTimer = setTimeout(() => {
      if (sequence !== jumpSequence) return;
      if (!state.cases.some(item => item.id === id && !item.completed)) {
        toast('Ca này vừa bị xóa hoặc hoàn tất. Vui lòng chọn ca khác.');
        return;
      }
      highlightedCaseId = id;
      const card = document.getElementById(`case-${id}`);
      if (!card) {
        highlightedCaseId = null;
        toast('Không thể mở thẻ ca này. Vui lòng chọn lại.');
        return;
      }
      card.classList.add('case-highlight-target');
      card.focus({ preventScroll: true });
      highlightTimer = setTimeout(() => {
        if (sequence !== jumpSequence) return;
        highlightedCaseId = null;
        document.getElementById(`case-${id}`)?.classList.remove('case-highlight-target');
      }, 1000);
    }, reduced ? 0 : 400);
  });
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const action = b.dataset.action;
  if (action === 'cancel-delete') {
    closeDeleteDialog();
    return;
  }
  if (action === 'retry-sync') {
    if (state.connection === 'ready') loadCases(); else boot();
    return;
  }
  if (state.connection !== 'ready') return;
  const id = b.dataset.id;
  const service = b.dataset.service;
  const techId = b.dataset.tech;
  const c = id ? state.cases.find(item => item.id === id) : null;

  switch (action) {
    case 'timeline-prev':
      shiftTimelineDate(-1);
      renderTimelineSelection();
      break;
    case 'timeline-today':
      state.timelineDate = null;
      renderTimelineSelection();
      break;
    case 'timeline-next':
      shiftTimelineDate(1);
      renderTimelineSelection();
      break;
    case 'nav':
      state.view = b.dataset.view;
      TBVNRouter.push({ view: state.view });
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    case 'open-new':
      initForm();
      break;
    case 'cancel-builder':
      closeForm('dashboard');
      break;
    case 'filter':
      state.filter = b.dataset.filter;
      state.casePage = 1;
      render();
      break;
    case 'room-filter':
      state.roomFilter = b.dataset.room;
      state.casePage = 1;
      render();
      break;
    case 'case-page':
      state.casePage = Number(b.dataset.page);
      $('#casesContent').innerHTML = casesHTML();
      $('#casesTitle')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      break;
    case 'select-room-tab':
      if (!ROOM_BY[b.dataset.room]) break;
      state.activeRoom = b.dataset.room;
      document.querySelectorAll('[data-room-panel]').forEach(panel => panel.classList.toggle('is-mobile-active', panel.dataset.roomPanel === state.activeRoom));
      document.querySelectorAll('[data-action="select-room-tab"]').forEach(tab => {
        const active = tab.dataset.room === state.activeRoom;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-pressed', String(active));
      });
      break;
    case 'jump-case':
      jumpToCase(id);
      break;
    case 'set-room':
      if (!state.form || !ROOM_BY[b.dataset.room]) break;
      state.form.room = b.dataset.room;
      document.querySelectorAll('[data-action="set-room"]').forEach(button => {
        const selected = button.dataset.room === state.form.room;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      updateFormErrors('room');
      $('#builderSummary').innerHTML = builderSummaryHTML();
      break;
    case 'builder-group':
      state.form.group = b.dataset.group;
      ensureBuilderActiveTech();
      renderBuilderPanels();
      break;
    case 'choose-tech':
      if (showFormErrors()) break;
      state.form.activeTechId = techId;
      state.form.techScrollY = window.scrollY;
      state.form.step = 'indications';
      TBVNRouter.push({ view: 'builder', step: 'indications', techId });
      render();
      window.scrollTo({ top: 0, behavior: 'instant' });
      break;
    case 'back-to-techs':
      TBVNRouter.backToTechs();
      break;
    case 'toggle-service': {
      const f = state.form;
      if (f.opts.has(service)) f.opts.delete(service);
      else {
        const s = SERVICE_BY[service];
        f.opts.set(service, { id: service, minutes: s.base, perUnit: s.perUnit, qty: 1 });
      }
      renderBuilderPanels();
      break;
    }
    case 'remove-service':
      state.form.opts.delete(service);
      renderBuilderPanels();
      break;
    case 'save-case':
      saveCase();
      break;
    case 'start':
      startCase(c);
      break;
    case 'pause':
      pauseCase(c);
      break;
    case 'reset':
      resetCase(c);
      break;
    case 'adjust':
      adjustCase(c, Number(b.dataset.val));
      break;
    case 'finish':
      finishCase(c);
      break;
    case 'delete':
      openDeleteDialog(c, b);
      break;
    case 'confirm-delete':
      if (c && !state.syncBusy) {
        closeDeleteDialog();
        withMutation(() => TBVNSync.remove(c), () => {
          state.cases = state.cases.filter(item => item.id !== c.id);
          state.expanded.delete(c.id);
          render();
          toast('Đã xóa ca.');
        });
      }
      break;
    case 'edit':
      if (c) initForm(c);
      break;
    case 'expand':
      if (c) openCaseDetailDialog(c, b);
      break;
    case 'close-case-detail':
      $('#modalRoot dialog')?.close();
      break;
    case 'catalog-group':
      state.catalogGroup = b.dataset.group;
      renderCatalogPanels();
      break;
    case 'catalog-tech':
      state.catalogActiveTechId = techId;
      renderCatalogPanels();
      break;
    case 'quick-tech':
      initForm(null, TECH_BY[techId]?.inds?.[0]?.id || null);
      if (state.form && !showFormErrors()) {
        state.form.activeTechId = techId;
        state.form.step = 'indications';
        TBVNRouter.push({ view: 'builder', step: 'indications', techId });
      }
      if (state.form?.step === 'indications') render();
      break;
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'caseSearch') {
    state.caseSearch = t.value;
    state.casePage = 1;
    const box = $('#casesContent');
    if (box) box.innerHTML = casesHTML();
  } else if (t.id === 'catalogSearch') {
    state.catalogSearch = t.value;
    renderCatalogPanels();
  } else if (t.id === 'builderSearch' && state.form) {
    state.form.techSearch = t.value;
    ensureBuilderActiveTech();
    renderBuilderPanels();
    $('#builderSearch')?.focus();
    const len = t.value.length;
    $('#builderSearch')?.setSelectionRange(len, len);
  } else if (state.form) {
    if (t.id === 'formName') { state.form.name = t.value; updateFormErrors('name'); $('#builderSummary').innerHTML = builderSummaryHTML(); }
    if (t.id === 'formAge') { state.form.age = t.value; updateFormErrors('age'); $('#builderSummary').innerHTML = builderSummaryHTML(); }
    if (t.id === 'formTechnician') { state.form.technician = t.value; updateFormErrors('technician'); $('#builderSummary').innerHTML = builderSummaryHTML(); }
    if (t.id === 'formStart') {
      state.form.start = t.value;
      updateFormErrors('start');
      $('#builderSummary').innerHTML = builderSummaryHTML();
    }
    if (t.id === 'formAppointmentDate') {
      state.form.appointmentDate = t.value;
      updateFormErrors('appointmentDate');
      $('#builderSummary').innerHTML = builderSummaryHTML();
    }
    if (t.dataset.editMin && state.form.opts.has(t.dataset.editMin)) {
      state.form.opts.get(t.dataset.editMin).minutes = clamp(Math.round(Number(t.value) || 1), 1, 600);
      $('#builderSummary').innerHTML = builderSummaryHTML();
      updateFormErrors();
    }
    if (t.dataset.editQty && state.form.opts.has(t.dataset.editQty)) {
      state.form.opts.get(t.dataset.editQty).qty = clamp(Math.round(Number(t.value) || 1), 1, 100);
      $('#builderSummary').innerHTML = builderSummaryHTML();
      updateFormErrors();
    }
  }
});

document.addEventListener('change', e => {
  if (e.target.id === 'timelineDate') {
    if (validIsoDate(e.target.value)) {
      state.timelineDate = e.target.value;
      renderTimelineSelection();
    }
    return;
  }
  if (!state.form) return;
  const t = e.target;
  if (t.id === 'formSex') { state.form.sex = t.value; updateFormErrors('sex'); $('#builderSummary').innerHTML = builderSummaryHTML(); }
  if (t.id === 'formStart') {
    state.form.start = t.value;
    updateFormErrors('start');
    $('#builderSummary').innerHTML = builderSummaryHTML();
  }
  if (t.id === 'formAppointmentDate') {
    state.form.appointmentDate = t.value;
    updateFormErrors('appointmentDate');
    $('#builderSummary').innerHTML = builderSummaryHTML();
  }
  if (t.dataset.editMin) {
    t.value = state.form.opts.get(t.dataset.editMin).minutes;
  }
  if (t.dataset.editQty) {
    t.value = state.form.opts.get(t.dataset.editQty).qty;
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.view === 'builder' && state.form) closeForm('dashboard');
});

$('#homeLink').addEventListener('click', e => {
  e.preventDefault();
  if (state.connection !== 'ready') return;
  state.view = 'dashboard';
  TBVNRouter.push({ view: 'dashboard' });
  render();
});

const initialRoute = TBVNRouter.start(restoreRoute);
if (initialRoute.view === 'catalog') state.view = 'catalog';
else if (initialRoute.view === 'builder') TBVNRouter.replace({ view: 'dashboard' });

async function boot() {
  if (!TBVNSync.configured) {
    state.connection = 'setup';
    state.syncError = 'Chưa cấu hình Supabase. Điền Project URL và Publishable key vào config.js.';
    render();
    return;
  }
  state.connection = 'loading';
  state.syncError = '';
  render();
  try {
    await TBVNSync.clock();
    const rows = await TBVNSync.list();
    state.cases = rows.map(mapCase);
    state.connection = 'ready';
    render();
    TBVNSync.subscribe(() => loadCases(), status => {
      if (status === 'SUBSCRIBED') {
        loadCases();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        state.syncError = 'Đồng bộ thời gian thực gián đoạn. Dữ liệu sẽ tự tải lại định kỳ.';
        if (state.view === 'dashboard') render();
      }
    });
  } catch (error) {
    console.error('Không thể khởi động Supabase:', error);
    state.connection = 'error';
    state.syncError = 'Không thể kết nối dữ liệu. Kiểm tra Internet, cấu hình Supabase và SQL migration.';
    render();
  }
}

boot();
TBVNBilingual.start();
setInterval(refreshLive, 1000);
setInterval(() => { if (state.connection === 'ready') loadCases(); else if (state.connection === 'error') boot(); }, 20000);
window.addEventListener('online', () => { if (state.connection === 'ready') loadCases(); else if (state.connection === 'error') boot(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (state.connection === 'ready') loadCases();
    else if (state.connection === 'error') boot();
  }
});
