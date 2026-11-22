const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1403';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---- Simple JSON file DB ----
const DATA_FILE = path.join(__dirname, 'data.json');

function defaultData() {
  return {
    site: {
      examName: 'آزمون ۱۳ آذر ماز',
      examDate: '2025-12-04',
      brand: 'دیجی ماز',
      logoEmoji: '📚',
      heroDesc: 'برنامه‌ریزی دقیق، تایمر مطالعه، یادداشت‌برداری و پیگیری پیشرفت — همه چیز برای آمادگی بهتر.',
      colors: { cl1: '#4f8ef7', cl2: '#7c5cbf', cl3: '#3dbfa0', cl4: '#f7c948' },
      updatedAt: Date.now()
    },
    contact: {
      email: 'support@digimaz.ir',
      telegram: '@digimaz',
      hours: 'شنبه تا پنجشنبه — ۹ صبح تا ۶ عصر',
      formspree: '',
      updatedAt: Date.now()
    },
    settings: { countdown: true, livestats: true, allowRegister: true, updatedAt: Date.now() },
    subjects: {
      'subj-math':    { color: '#4f8ef7', count: 8 },
      'subj-farsi':   { color: '#f4874b', count: 7 },
      'subj-science': { color: '#3dbfa0', count: 10 },
      'subj-arabic':  { color: '#f7c948', count: 4 },
      'subj-payam':   { color: '#e05c7a', count: 5 },
      'subj-social':  { color: '#9f7aea', count: 4 },
      'subj-intel':   { color: '#68d391', count: 8 }
    },
    sessions: [],
    messages: [],
    progress: { sessionMeta: [], notes: {}, progressArr: [], updatedAt: null }, // legacy global
    students: [],            // {id, name, username, passHash, createdAt, lastLogin, active}
    studentProgress: {}       // studentId -> {sessionMeta, notes, progressArr, updatedAt}
  };
}

let db = defaultData();
try {
  if (fs.existsSync(DATA_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db = { ...defaultData(), ...loaded };
    if (!db.studentProgress) db.studentProgress = {};
    if (!db.students) db.students = [];
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  }
} catch (e) { console.error('DB load error', e); }

function save() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch (e) { console.error(e); }
}
const uid = () => crypto.randomBytes(8).toString('hex');
const hashPass = (p) => crypto.createHash('sha256').update('dm$' + String(p)).digest('hex');
const normUser = (u) => String(u || '').trim().toLowerCase().replace(/\s+/g, '');

function progressSummary(p) {
  const meta = (p && p.sessionMeta) || [];
  const total = meta.length || 46;
  const done = meta.filter(s => s.done).length;
  return { total, done, remaining: total - done, pct: total ? Math.round(done / total * 100) : 0 };
}

// ---- Tokens ----
const adminTokens = new Set();
const studentTokens = new Map(); // token -> studentId

function requireAdmin(req, res, next) {
  const t = req.headers['x-admin-token'];
  if (t && adminTokens.has(t)) return next();
  return res.status(401).json({ error: 'unauthorized' });
}
function requireStudent(req, res, next) {
  const t = req.headers['x-student-token'] || req.query.token;
  if (t && studentTokens.has(t)) {
    const st = db.students.find(s => s.id === studentTokens.get(t));
    if (st && st.active !== false) { req.student = st; return next(); }
  }
  return res.status(401).json({ error: 'login required' });
}

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    const t = crypto.randomBytes(24).toString('hex');
    adminTokens.add(t);
    return res.json({ ok: true, token: t });
  }
  return res.status(401).json({ ok: false, error: 'wrong password' });
});

// ---- Public ----
app.get('/api/config', (req, res) => {
  res.json({ site: db.site, contact: db.contact, settings: db.settings, subjects: db.subjects });
});
app.get('/api/sessions', (req, res) => res.json(db.sessions));

// Global stats (legacy) + per-class aggregate
app.get('/api/stats', (req, res) => {
  const ids = Object.keys(db.studentProgress || {});
  let total = 46, doneSum = 0, pctAvg = 0;
  if (ids.length) {
    const sums = ids.map(id => progressSummary(db.studentProgress[id]));
    total = sums[0].total;
    doneSum = Math.round(sums.reduce((a, s) => a + s.done, 0) / sums.length);
    pctAvg = Math.round(sums.reduce((a, s) => a + s.pct, 0) / sums.length);
  } else {
    const g = progressSummary(db.progress);
    total = g.total; doneSum = g.done; pctAvg = g.pct;
  }
  res.json({
    total, done: doneSum, remaining: total - doneSum, pct: pctAvg,
    messages: db.messages.length, sessions: db.sessions.length,
    students: db.students.filter(s => s.active !== false).length,
    updatedAt: db.progress.updatedAt
  });
});

// Legacy progress (kept for backward compat)
app.get('/api/progress', (req, res) => res.json(db.progress));
app.put('/api/progress', (req, res) => {
  const { sessionMeta, notes, progressArr } = req.body || {};
  if (Array.isArray(sessionMeta)) db.progress.sessionMeta = sessionMeta;
  if (notes && typeof notes === 'object') db.progress.notes = notes;
  if (Array.isArray(progressArr)) db.progress.progressArr = progressArr;
  db.progress.updatedAt = new Date().toLocaleString('fa-IR');
  save();
  res.json({ ok: true, updatedAt: db.progress.updatedAt });
});

// ---- Student auth ----
app.post('/api/student/register', (req, res) => {
  if (db.settings.allowRegister === false) return res.status(403).json({ error: 'ثبت‌نام بسته است' });
  const { name, username, password } = req.body || {};
  const u = normUser(username);
  if (!u || u.length < 3) return res.status(400).json({ error: 'نام کاربری حداقل ۳ حرف' });
  if (!password || String(password).length < 4) return res.status(400).json({ error: 'رمز حداقل ۴ حرف' });
  if (db.students.some(s => normUser(s.username) === u)) return res.status(409).json({ error: 'این نام کاربری گرفته شده' });
  const st = {
    id: uid(), name: String(name || u).slice(0, 60), username: u,
    passHash: hashPass(password), createdAt: Date.now(), lastLogin: Date.now(), active: true
  };
  db.students.push(st);
  // start with empty default plan
  const defaultPlanId = uid();
  db.studentProgress[st.id] = { 
    sessionMeta: [], notes: {}, progressArr: [], updatedAt: null,
    plans: [{
      id: defaultPlanId,
      name: 'برنامه پیش‌فرض',
      duration: 14,
      startDate: new Date().toISOString().slice(0,10),
      sessions: [],
      todos: [],
      createdAt: Date.now()
    }],
    activePlanId: defaultPlanId
  };
  const token = crypto.randomBytes(24).toString('hex');
  studentTokens.set(token, st.id);
  save();
  res.json({ ok: true, token, student: { id: st.id, name: st.name, username: st.username } });
});

app.post('/api/student/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = normUser(username);
  const st = db.students.find(s => normUser(s.username) === u);
  if (!st || st.passHash !== hashPass(password)) return res.status(401).json({ error: 'نام کاربری یا رمز اشتباه است' });
  if (st.active === false) return res.status(403).json({ error: 'حساب غیرفعال است' });
  st.lastLogin = Date.now();
  const token = crypto.randomBytes(24).toString('hex');
  studentTokens.set(token, st.id);
  save();
  res.json({ ok: true, token, student: { id: st.id, name: st.name, username: st.username } });
});

app.get('/api/student/me', requireStudent, (req, res) => {
  const st = req.student;
  res.json({ id: st.id, name: st.name, username: st.username, createdAt: st.createdAt, lastLogin: st.lastLogin });
});

app.put('/api/student/profile', requireStudent, (req, res) => {
  const { name } = req.body || {};
  if (name) req.student.name = String(name).slice(0, 60);
  save();
  res.json({ ok: true, student: { id: req.student.id, name: req.student.name, username: req.student.username } });
});

// ---- Plans ----
function getStudentData(id) {
  if (!db.studentProgress[id]) {
    db.studentProgress[id] = { sessionMeta: [], notes: {}, progressArr: [], plans: [], activePlanId: null, updatedAt: null };
  }
  const d = db.studentProgress[id];
  if (!Array.isArray(d.plans)) d.plans = [];
  if (!d.activePlanId && d.plans.length) d.activePlanId = d.plans[0].id;
  return d;
}

app.get('/api/student/plans', requireStudent, (req, res) => {
  const d = getStudentData(req.student.id);
  res.json({ plans: d.plans, activePlanId: d.activePlanId });
});

app.post('/api/student/plans', requireStudent, (req, res) => {
  const d = getStudentData(req.student.id);
  const { name, duration, startDate } = req.body || {};
  const plan = {
    id: uid(),
    name: String(name || 'برنامه جدید').slice(0, 40),
    duration: Math.max(1, Math.min(90, parseInt(duration) || 7)),
    startDate: startDate || new Date().toISOString().slice(0,10),
    sessions: [],
    todos: [],
    createdAt: Date.now()
  };
  d.plans.push(plan);
  if (!d.activePlanId) d.activePlanId = plan.id;
  d.updatedAt = new Date().toLocaleString('fa-IR');
  save();
  res.json({ ok: true, plan, activePlanId: d.activePlanId });
});

app.put('/api/student/plans/:id', requireStudent, (req, res) => {
  const d = getStudentData(req.student.id);
  const plan = d.plans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: 'plan not found' });
  const { name, duration, startDate, sessions, todos } = req.body || {};
  if (name) plan.name = String(name).slice(0, 40);
  if (duration) plan.duration = Math.max(1, Math.min(90, parseInt(duration)));
  if (startDate) plan.startDate = startDate;
  if (Array.isArray(sessions)) plan.sessions = sessions;
  if (Array.isArray(todos)) plan.todos = todos;
  d.updatedAt = new Date().toLocaleString('fa-IR');
  save();
  res.json({ ok: true, plan });
});

app.delete('/api/student/plans/:id', requireStudent, (req, res) => {
  const d = getStudentData(req.student.id);
  d.plans = d.plans.filter(p => p.id !== req.params.id);
  if (d.activePlanId === req.params.id) d.activePlanId = d.plans[0]?.id || null;
  save();
  res.json({ ok: true, activePlanId: d.activePlanId });
});

app.put('/api/student/active-plan', requireStudent, (req, res) => {
  const d = getStudentData(req.student.id);
  const { planId } = req.body || {};
  if (d.plans.some(p => p.id === planId)) {
    d.activePlanId = planId;
    save();
  }
  res.json({ ok: true, activePlanId: d.activePlanId });
});

app.get('/api/student/progress', requireStudent, (req, res) => {
  const d = getStudentData(req.student.id);
  res.json(d);
});

app.put('/api/student/progress', requireStudent, (req, res) => {
  const { sessionMeta, notes, progressArr } = req.body || {};
  const cur = db.studentProgress[req.student.id] || { sessionMeta: [], notes: {}, progressArr: [] };
  if (Array.isArray(sessionMeta)) cur.sessionMeta = sessionMeta;
  if (notes && typeof notes === 'object') cur.notes = notes;
  if (Array.isArray(progressArr)) cur.progressArr = progressArr;
  cur.updatedAt = new Date().toLocaleString('fa-IR');
  db.studentProgress[req.student.id] = cur;
  save();
  res.json({ ok: true, updatedAt: cur.updatedAt });
});

app.get('/api/student/stats', requireStudent, (req, res) => {
  const p = db.studentProgress[req.student.id] || {};
  res.json({ ...progressSummary(p), name: req.student.name });
});

// ---- Messages ----
app.post('/api/messages', (req, res) => {
  const { name, contact, subject, message } = req.body || {};
  if (!name || !message) return res.status(400).json({ error: 'name and message required' });
  const m = {
    id: uid(), name: String(name).slice(0, 80), contact: String(contact || '').slice(0, 120),
    subject: String(subject || '').slice(0, 120), message: String(message).slice(0, 3000),
    dateStr: new Date().toLocaleString('fa-IR'), ts: Date.now()
  };
  db.messages.unshift(m);
  if (db.messages.length > 500) db.messages = db.messages.slice(0, 500);
  save();
  res.json({ ok: true, id: m.id });
});

// ---- Admin ----
app.get('/api/admin/messages', requireAdmin, (req, res) => res.json(db.messages));
app.delete('/api/admin/messages/:id', requireAdmin, (req, res) => {
  db.messages = db.messages.filter(m => m.id !== req.params.id);
  save(); res.json({ ok: true });
});
app.delete('/api/admin/messages', requireAdmin, (req, res) => {
  db.messages = []; save(); res.json({ ok: true });
});

app.post('/api/admin/sessions', requireAdmin, (req, res) => {
  const { subject, subjectClass, day, start, end, type } = req.body || {};
  if (!subject) return res.status(400).json({ error: 'subject required' });
  const s = { id: uid(), subject, subjectClass: subjectClass || 'subj-math', day: day || 1, start: start || '', end: end || '', type: type || 'motale', done: false, ts: Date.now() };
  db.sessions.push(s); save();
  res.json({ ok: true, session: s });
});
app.delete('/api/admin/sessions/:id', requireAdmin, (req, res) => {
  db.sessions = db.sessions.filter(s => s.id !== req.params.id);
  save(); res.json({ ok: true });
});
app.put('/api/admin/sessions/:id', requireAdmin, (req, res) => {
  const s = db.sessions.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  Object.assign(s, req.body || {});
  save(); res.json({ ok: true, session: s });
});

app.put('/api/admin/config/:section', requireAdmin, (req, res) => {
  const sec = req.params.section;
  if (!['site', 'contact', 'settings', 'subjects'].includes(sec)) return res.status(400).json({ error: 'bad section' });
  db[sec] = { ...(db[sec] || {}), ...(req.body || {}), updatedAt: Date.now() };
  save(); res.json({ ok: true, [sec]: db[sec] });
});

// Students management
app.get('/api/admin/students', requireAdmin, (req, res) => {
  const list = db.students.map(s => {
    const p = db.studentProgress[s.id] || {};
    return { id: s.id, name: s.name, username: s.username, createdAt: s.createdAt, lastLogin: s.lastLogin, active: s.active !== false, ...progressSummary(p) };
  }).sort((a, b) => b.done - a.done);
  res.json(list);
});
app.post('/api/admin/students', requireAdmin, (req, res) => {
  const { name, username, password } = req.body || {};
  const u = normUser(username);
  if (!u) return res.status(400).json({ error: 'username required' });
  if (db.students.some(s => normUser(s.username) === u)) return res.status(409).json({ error: 'تکراری است' });
  const st = { id: uid(), name: String(name || u).slice(0, 60), username: u, passHash: hashPass(password || '1234'), createdAt: Date.now(), lastLogin: null, active: true };
  db.students.push(st);
  const defaultPlanId = uid();
  db.studentProgress[st.id] = { 
    sessionMeta: [], notes: {}, progressArr: [], updatedAt: null,
    plans: [{
      id: defaultPlanId,
      name: 'برنامه پیش‌فرض',
      duration: 14,
      startDate: new Date().toISOString().slice(0,10),
      sessions: [],
      todos: [],
      createdAt: Date.now()
    }],
    activePlanId: defaultPlanId
  };
  save();
  res.json({ ok: true, student: { id: st.id, name: st.name, username: st.username } });
});
app.put('/api/admin/students/:id', requireAdmin, (req, res) => {
  const st = db.students.find(s => s.id === req.params.id);
  if (!st) return res.status(404).json({ error: 'not found' });
  const { name, password, active } = req.body || {};
  if (name) st.name = String(name).slice(0, 60);
  if (password) st.passHash = hashPass(password);
  if (typeof active === 'boolean') st.active = active;
  save(); res.json({ ok: true });
});
app.delete('/api/admin/students/:id', requireAdmin, (req, res) => {
  db.students = db.students.filter(s => s.id !== req.params.id);
  delete db.studentProgress[req.params.id];
  save(); res.json({ ok: true });
});
app.post('/api/admin/students/:id/reset-progress', requireAdmin, (req, res) => {
  db.studentProgress[req.params.id] = { sessionMeta: [], notes: {}, progressArr: [], updatedAt: null };
  save(); res.json({ ok: true });
});
app.get('/api/admin/students/:id/progress', requireAdmin, (req, res) => {
  res.json(db.studentProgress[req.params.id] || { sessionMeta: [], notes: {}, progressArr: [] });
});

app.get('/api/admin/export', requireAdmin, (req, res) => {
  const safe = { ...db, students: db.students.map(s => ({ ...s, passHash: '***' })) };
  res.json({ exportedAt: new Date().toISOString(), ...safe });
});

// ---- Serve frontend ----
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => console.log(`DigiMaz server v2 (multi-student) on :${PORT}`));
