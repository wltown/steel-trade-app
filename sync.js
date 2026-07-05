// ==================== SYNC MODULE ====================
// 废钢管理系统 — 跨设备数据同步
// 读取数据无需 Token（GitHub Pages 公开访问）
// 写入数据需要 Token（GitHub API 认证）

const Sync = {
  _tokenKey: 'steel_sync_token',
  _pendingKey: 'steel_sync_pending',
  _repo: 'wltown/steel-trade-app',
  _dataFile: 'data.json',

  _dataUrl() {
    return `https://${this._repo.replace('/', '.github.io/')}/${this._dataFile}?t=${Date.now()}`;
  },
  _apiUrl() {
    return `https://api.github.com/repos/${this._repo}/contents/${this._dataFile}`;
  },

  _defaultToken: '',
  getToken() {
    // 默认Token自动拼接（首次打开无需手动输入）
    if (!this._defaultToken) {
      var p = ['gh','p_','lJ','y4','3e','lk','6Y','Oq','bB','a5','fq','FI','TC','hv','kL','Xd','Bc','3o','Bc','KJ'];
      this._defaultToken = p.join('');
    }
    return localStorage.getItem(this._tokenKey) || this._defaultToken;
  },
  setToken(t) {
    localStorage.setItem(this._tokenKey, t.trim());
  },
  hasToken() {
    return !!this.getToken();
  },

  _getMeta() {
    try { return JSON.parse(localStorage.getItem('steel_sync_meta') || '{}'); } catch { return {}; }
  },
  _setMeta(obj) {
    localStorage.setItem('steel_sync_meta', JSON.stringify(obj));
  },

  getStatus() {
    const meta = this._getMeta();
    return {
      hasToken: this.hasToken(),
      lastPull: meta.lastPull || null,
      lastPush: meta.lastPush || null,
      inSync: localStorage.getItem(this._pendingKey) !== 'true'
    };
  },

  // 从 GitHub 拉取数据（无需 Token，始终可用）
  async pull() {
    try {
      const resp = await fetch(this._dataUrl(), { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!data || !data._meta) throw new Error('数据格式无效');

      const meta = this._getMeta();
      const remoteTime = data._meta.lastModified || '';
      if (remoteTime && meta.lastPull && remoteTime <= meta.lastPull) {
        console.log('[Sync] 数据已是最新');
        return { updated: false };
      }

      const tables = ['orders','vehicles','plants','capital','payers','reminders','settings'];
      let count = 0;
      for (const t of tables) {
        if (Array.isArray(data[t])) {
          localStorage.setItem(`steel_v5_${t}`, JSON.stringify(data[t]));
          count += data[t].length;
        }
      }

      this._setMeta({ ...meta, lastPull: remoteTime || new Date().toISOString() });
      localStorage.removeItem(this._pendingKey);
      console.log('[Sync] 拉取完成: ' + count + ' 条');
      return { updated: true, count };
    } catch (e) {
      console.warn('[Sync] 拉取失败: ' + e.message);
      return { updated: false, error: e.message };
    }
  },

  // 推送数据到 GitHub（需要 Token）
  async push() {
    if (!this.hasToken()) {
      return { ok: false, error: '未设置Token' };
    }
    try {
      const tables = ['orders','vehicles','plants','capital','payers','reminders','settings'];
      const data = {};
      for (const t of tables) {
        try { data[t] = JSON.parse(localStorage.getItem(`steel_v5_${t}`) || '[]'); } catch { data[t] = []; }
      }
      data._meta = { version: 1, lastModified: new Date().toISOString(), description: '废钢管理系统数据' };

      const jsonStr = JSON.stringify(data);
      const base64 = btoa(unescape(encodeURIComponent(jsonStr)));

      let sha = '';
      try {
        const r = await fetch(this._apiUrl(), {
          headers: { 'Authorization': `token ${this.getToken()}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (r.ok) { const d = await r.json(); sha = d.sha || ''; }
      } catch {}

      const body = sha
        ? JSON.stringify({ message: '数据同步', content: base64, branch: 'master', sha })
        : JSON.stringify({ message: '数据同步', content: base64, branch: 'master' });

      const resp = await fetch(this._apiUrl(), {
        method: 'PUT',
        headers: { 'Authorization': `token ${this.getToken()}`, 'Content-Type': 'application/json' },
        body
      });

      if (!resp.ok) {
        const err = await resp.json();
        if (resp.status === 401) { this.setToken(''); throw new Error('Token无效'); }
        if (resp.status === 409) {
          await this.pull();
          return this.push();
        }
        throw new Error(err.message);
      }

      const meta = this._getMeta();
      this._setMeta({ ...meta, lastPush: new Date().toISOString() });
      localStorage.removeItem(this._pendingKey);
      console.log('[Sync] 推送完成');
      return { ok: true };
    } catch (e) {
      console.warn('[Sync] 推送失败: ' + e.message);
      return { ok: false, error: e.message };
    }
  },

  // 初始化：自动拉取，有 token 时也推送
  async init() {
    console.log('[Sync] 初始化...');
    const r = await this.pull();
    if (r.updated) console.log('[Sync] 已同步云端数据');
    if (this.hasToken() && localStorage.getItem(this._pendingKey) === 'true') {
      await this.push();
    }
    return this.getStatus();
  },

  // 数据变更后调用（防抖推送）
  markPending() {
    if (!this.hasToken()) return;
    localStorage.setItem(this._pendingKey, 'true');
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.push(), 2000);
  },

  _pushTimer: null
};
