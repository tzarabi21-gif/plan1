/* DigiMaz shared API client v2 — student accounts + offline fallback */
(function () {
  const API_BASE = (window.DIGIMAZ_API_BASE || '').replace(/\/$/, '');
  const api = (p) => API_BASE + p;

  async function getJSON(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(t || ('HTTP ' + r.status)); }
    return r.json();
  }

  const store = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  const TOKEN_KEY = 'dm_student_token';
  const USER_KEY = 'dm_student_user';

  window.DigiMazAPI = {
    base: API_BASE || '(same-origin)',
    online: true,
    get studentToken() { return localStorage.getItem(TOKEN_KEY) || ''; },
    get student() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; } },
    get loggedIn() { return !!this.studentToken; },
    sHeaders() { return this.studentToken ? { 'x-student-token': this.studentToken } : {}; },

    async getConfig() {
      try {
        const c = await getJSON(api('/api/config'));
        store.set('dm_config', c);
        return c;
      } catch (e) { this.online = false; return store.get('dm_config', null); }
    },

    // ---- student auth ----
    async register(name, username, password) {
      const j = await getJSON(api('/api/student/register'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, password })
      });
      localStorage.setItem(TOKEN_KEY, j.token);
      localStorage.setItem(USER_KEY, JSON.stringify(j.student));
      return j;
    },
    async login(username, password) {
      const j = await getJSON(api('/api/student/login'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      localStorage.setItem(TOKEN_KEY, j.token);
      localStorage.setItem(USER_KEY, JSON.stringify(j.student));
      return j;
    },
    logout() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      location.reload();
    },
    async me() {
      if (!this.loggedIn) return null;
      try { return await getJSON(api('/api/student/me'), { headers: this.sHeaders() }); }
      catch (e) { return this.student; }
    },

    // ---- progress: student endpoint when logged in, legacy otherwise ----
    async getProgress() {
      if (this.loggedIn) {
        try {
          const p = await getJSON(api('/api/student/progress'), { headers: this.sHeaders() });
          store.set('mazSessionMeta', p.sessionMeta || []);
          store.set('mazStudyNotes', p.notes || {});
          store.set('mazStudyProgress', p.progressArr || []);
          return p;
        } catch (e) {
          if (String(e.message || '').includes('login')) { this.logout(); return null; }
        }
      }
      try {
        const p = await getJSON(api('/api/progress'));
        return p;
      } catch (e) {
        this.online = false;
        return {
          sessionMeta: store.get('mazSessionMeta', []),
          notes: store.get('mazStudyNotes', {}),
          progressArr: store.get('mazStudyProgress', [])
        };
      }
    },

    async saveProgress(sessionMeta, notes, progressArr) {
      store.set('mazSessionMeta', sessionMeta || []);
      store.set('mazStudyNotes', notes || {});
      store.set('mazStudyProgress', progressArr || []);
      const body = JSON.stringify({ sessionMeta, notes, progressArr });
      try {
        if (this.loggedIn) {
          const r = await fetch(api('/api/student/progress'), {
            method: 'PUT', headers: { 'Content-Type': 'application/json', ...this.sHeaders() }, body
          });
          if (r.status === 401) { this.logout(); return false; }
          return r.ok;
        }
        const r = await fetch(api('/api/progress'), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body
        });
        return r.ok;
      } catch (e) { this.online = false; return false; }
    },

    async sendMessage(data) {
      try {
        const r = await fetch(api('/api/messages'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
        });
        if (r.ok) return { ok: true, online: true };
      } catch (e) {}
      const arr = store.get('mazContactMessages', []);
      arr.push({ ...data, date: new Date().toLocaleString('fa-IR') });
      store.set('mazContactMessages', arr);
      return { ok: true, online: false };
    },

    async getStats() {
      try { return await getJSON(api('/api/stats')); }
      catch (e) {
        const prog = store.get('mazStudyProgress', []);
        const total = prog.length || 46, done = prog.filter(Boolean).length;
        return { total, done, remaining: total - done, pct: total ? Math.round(done / total * 100) : 0, offline: true };
      }
    },
    async getMyStats() {
      if (!this.loggedIn) return this.getStats();
      try { return await getJSON(api('/api/student/stats'), { headers: this.sHeaders() }); }
      catch (e) { return this.getStats(); }
    },

    async getAdminSessions() {
      try { return await getJSON(api('/api/sessions')); }
      catch (e) { return []; }
    },

    applyConfigToDOM(cfg) {
      if (!cfg) return;
      try {
        if (cfg.site) {
          document.querySelectorAll('[data-dm="brand"]').forEach(el => el.textContent = cfg.site.brand || el.textContent);
          document.querySelectorAll('[data-dm="examName"]').forEach(el => el.textContent = cfg.site.examName || el.textContent);
          document.querySelectorAll('[data-dm="heroDesc"]').forEach(el => el.textContent = cfg.site.heroDesc || el.textContent);
          if (cfg.site.colors) {
            const r = document.documentElement.style;
            if (cfg.site.colors.cl1) r.setProperty('--accent', cfg.site.colors.cl1);
            if (cfg.site.colors.cl2) r.setProperty('--accent2', cfg.site.colors.cl2);
            if (cfg.site.colors.cl3) r.setProperty('--accent3', cfg.site.colors.cl3);
            if (cfg.site.colors.cl4) r.setProperty('--accent4', cfg.site.colors.cl4);
          }
        }
        if (cfg.contact) {
          document.querySelectorAll('[data-dm="email"]').forEach(el => {
            el.textContent = cfg.contact.email || el.textContent;
            if (el.tagName === 'A') el.href = 'mailto:' + cfg.contact.email;
          });
          document.querySelectorAll('[data-dm="telegram"]').forEach(el => el.textContent = cfg.contact.telegram || el.textContent);
          document.querySelectorAll('[data-dm="hours"]').forEach(el => el.textContent = cfg.contact.hours || el.textContent);
        }
        if (cfg.settings) {
          if (cfg.settings.countdown === false) {
            const c = document.getElementById('countdown-bar'); if (c) c.style.display = 'none';
          }
          if (cfg.settings.livestats === false) {
            document.querySelectorAll('.live-stats').forEach(el => el.style.display = 'none');
          }
        }
      } catch (e) {}
    },

    async initPublic() {
      const cfg = await this.getConfig();
      if (cfg) this.applyConfigToDOM(cfg);
      return cfg;
    },

    // Renders a small auth widget into #dm-auth (call on every public page)
    renderAuthWidget() {
      const box = document.getElementById('dm-auth');
      if (!box) return;
      const s = this.student;
      if (s) {
        box.innerHTML = `<span style="font-size:.78rem;color:#8a94b0;margin-left:6px">👋 ${s.name}</span>
          <a href="profile.html" style="font-size:.78rem;color:#4f8ef7;text-decoration:none;font-weight:700;margin-left:8px">👤 پروفایل</a>
          <a href="progress.html" style="font-size:.78rem;color:#3dbfa0;text-decoration:none;font-weight:700;margin-left:8px">📈 پیشرفت</a>
          <button onclick="DigiMazAPI.logout()" style="background:none;border:1px solid #2a3050;color:#8a94b0;border-radius:8px;padding:4px 10px;font-family:inherit;font-size:.75rem;cursor:pointer">خروج</button>`;
      } else {
        box.innerHTML = `<a href="login.html" style="background:linear-gradient(135deg,#4f8ef7,#7c5cbf);color:#fff;text-decoration:none;font-size:.78rem;font-weight:700;border-radius:8px;padding:6px 14px">🔑 ورود دانش‌آموز</a>`;
      }
    },

    // ---- Plans ----
    async getPlans() {
      if (!this.loggedIn) return { plans: [], activePlanId: null };
      try {
        return await getJSON(api('/api/student/plans'), { headers: this.sHeaders() });
      } catch (e) { return { plans: [], activePlanId: null }; }
    },
    async createPlan(data) {
      const j = await getJSON(api('/api/student/plans'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...this.sHeaders() },
        body: JSON.stringify(data)
      });
      return j;
    },
    async updatePlan(id, data) {
      return await getJSON(api('/api/student/plans/' + id), {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...this.sHeaders() },
        body: JSON.stringify(data)
      });
    },
    async deletePlan(id) {
      return await getJSON(api('/api/student/plans/' + id), {
        method: 'DELETE', headers: this.sHeaders()
      });
    },
    async setActivePlan(planId) {
      return await getJSON(api('/api/student/active-plan'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...this.sHeaders() },
        body: JSON.stringify({ planId })
      });
    },
    async updateProfile(name) {
      return await getJSON(api('/api/student/profile'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...this.sHeaders() },
        body: JSON.stringify({ name })
      });
    }
  };
})();
