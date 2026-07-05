// ==================== SYNC MODULE ====================
// 废钢管理系统 — 跨设备数据同步
// 通过 GitHub 仓库 data.json 实现手机和电脑数据同步
// Token 随 data.json 同步，一处配置，所有设备通用

const Sync = {
  _tokenKey: 'steel_sync_token',
  _shaKey: 'steel_sync_sha',
  _lastPullKey: 'steel_sync_last_pull',
  _pendingKey: 'steel_sync_pending',
  _repo: 'wltown/steel-trade-app',
  _branch: 'master',
  _dataFile: 'data.json',

  // ── 数据读取URL (GitHub Pages, 免认证) ──
  _dataUrl() {
    return `https://${this._repo.replace('/', '.github.io/')}/${this._dataFile}?t=${Date.now()}`;
  },
  // ── API写入URL ──
  _apiUrl() {
    return `https://api.github.com/repos/${this._repo}/contents/${this._dataFile}`;
  },

  // ── Token 管理 ──
  getToken() {
    return localStorage.getItem(this._tokenKey) || '';
  },
  setToken(t) {
    t = t.trim();
    if (t) {
      localStorage.setItem(this._tokenKey, t);
      // 立即推一次，把 token 写入 data.json 供其他设备使用
      this._pushToken();
    }
  },
  hasToken() {
    return !!this.getToken();
  },

  // 把 token 写入 data.json 的 _meta 中
  async _pushToken() {
    const tk = this.getToken();
    if (!tk) return;
    try {
      // 获取当前远程 data.json 的 SHA
      let sha = '';
      let remoteData = null;
      try {
        const resp = await fetch(this._apiUrl(), {
          headers: { 'Authorization': `token ${tk}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (resp.ok) {
          const d = await resp.json();
          sha = d.sha || '';
          if (d.content) {
            remoteData = JSON.parse(atob(d.content.replace(/\s/g, '')));
          }
        }
      } catch {}

      // 合并 token 到远程数据中
      if (!remoteData) {
        remoteData = { _meta: {} };
      }
      remoteData._meta._token = tk;
      remoteData._meta.lastModified = new Date().toISOString();

      const jsonStr = JSON.stringify(remoteData);
      const base64 = btoa(unescape(encodeURIComponent(jsonStr)));

      const body = JSON.stringify({
        message: '同步Token',
        content: base64,
        branch: this._branch,
        sha: sha || undefined
      });
      // Remove undefined fields
      const cleanBody = sha ?
        JSON.stringify({ message: '同步Token', content: base64, branch: this._branch, sha }) :
        JSON.stringify({ message: '同步Token', content: base64, branch: this._branch });

      await fetch(this._apiUrl(), {
        method: 'PUT',
        headers: { 'Authorization': `token ${tk}`, 'Content-Type': 'application/json' },
        body: cleanBody
      });
      console.log('[Sync] Token已同步到云端');
    } catch (e) {
      console.warn('[Sync] Token同步失败:', e.message);
    }
  },

  // ── 元数据 ──
  _getMeta() {
    try { return JSON.parse(localStorage.getItem('steel_sync_meta') || '{}'); } catch { return {}; }
  },
  _setMeta(obj) {
    localStorage.setItem('steel_sync_meta', JSON.stringify(obj));
  },

  // ── 状态查询 ──
  getStatus() {
    const meta = this._getMeta();
    const hasPending = localStorage.getItem(this._pendingKey) === 'true';
    return {
      hasToken: this.hasToken(),
      lastPull: meta.lastPull || null,
      lastPush: meta.lastPush || null,
      inSync: !hasPending,
    };
  },

  // ── 从GitHub拉取数据 (无需认证，始终自动执行) ──
  async pull() {
    try {
      const resp = await fetch(this._dataUrl(), { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!data || !data._meta) throw new Error('数据格式无效');

      // 从远程数据中提取 Token（如果本地没有）
      if (data._meta._token && !this.hasToken()) {
        this.setToken(data._meta._token);
        console.log('[Sync] 从云端获取到Token');
      }

      // 检查是否比本地新
      const meta = this._getMeta();
      const remoteTime = data._meta.lastModified || '';
      const localTime = meta.lastPull || '';
      if (remoteTime && localTime && remoteTime <= localTime && !this._forcePull) {
        console.log('[Sync] 远程数据未更新');
        return { updated: false, reason: '远程数据未更新' };
      }

      // 写入localStorage
      const tables = ['orders', 'vehicles', 'plants', 'capital', 'payers', 'reminders', 'settings'];
      let count = 0;
      for (const t of tables) {
        if (Array.isArray(data[t])) {
          localStorage.setItem(`steel_v5_${t}`, JSON.stringify(data[t]));
          count += data[t].length;
        }
      }

      this._setMeta({ ...meta, lastPull: remoteTime || new Date().toISOString() });
      this._forcePull = false;
      localStorage.removeItem(this._pendingKey);
      console.log(`[Sync] 拉取完成: ${count} 条`);
      return { updated: true, count };
    } catch (e) {
      console.warn('[Sync] 拉取失败:', e.message);
      return { updated: false, error: e.message };
    }
  },

  // ── 推送到GitHub ──
  async push() {
    if (!this.hasToken()) {
      localStorage.setItem(this._pendingKey, 'true');
      return { ok: false, error: '未设置Token' };
    }

    try {
      const tables = ['orders', 'vehicles', 'plants', 'capital', 'payers', 'reminders', 'settings'];
      const data = {};
      for (const t of tables) {
        try { data[t] = JSON.parse(localStorage.getItem(`steel_v5_${t}`) || '[]'); } catch { data[t] = []; }
      }
      data._meta = {
        version: 1,
        lastModified: new Date().toISOString(),
        description: '废钢管理系统数据文件',
        _token: this.getToken()  // 保留 Token 到云端
      };

      const jsonStr = JSON.stringify(data);
      const base64 = btoa(unescape(encodeURIComponent(jsonStr)));

      // 获取远程SHA
      let sha = '';
      try {
        const headResp = await fetch(this._apiUrl(), {
          headers: { 'Authorization': `token ${this.getToken()}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (headResp.ok) {
          const headData = await headResp.json();
          sha = headData.sha || '';
        }
      } catch {}

      const putBody = sha ?
        JSON.stringify({ message: `数据同步 ${new Date().toLocaleString('zh-CN')}`, content: base64, branch: this._branch, sha }) :
        JSON.stringify({ message: `数据同步 ${new Date().toLocaleString('zh-CN')}`, content: base64, branch: this._branch });

      const resp = await fetch(this._apiUrl(), {
        method: 'PUT',
        headers: { 'Authorization': `token ${this.getToken()}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' },
        body: putBody
      });

      if (!resp.ok) {
        const errData = await resp.json();
        if (resp.status === 401) { this.setToken(''); throw new Error('Token无效，请重新设置'); }
        if (resp.status === 409) {
          console.log('[Sync] 冲突，先拉后推...');
          this._forcePull = true;
          await this.pull();
          return this.push();
        }
        throw new Error(errData.message || `HTTP ${resp.status}`);
      }

      const meta = this._getMeta();
      this._setMeta({ ...meta, lastPush: new Date().toISOString() });
      localStorage.removeItem(this._pendingKey);
      console.log('[Sync] 推送完成');
      return { ok: true };
    } catch (e) {
      console.warn('[Sync] 推送失败:', e.message);
      localStorage.setItem(this._pendingKey, 'true');
      return { ok: false, error: e.message };
    }
  },

  // ── 初始化：始终自动拉取（读不需要token） ──
  async init() {
    console.log('[Sync] 初始化...');
    // 始终拉取远程数据（读取不需要 Token）
    const pullResult = await this.pull();
    if (pullResult.updated) {
      console.log('[Sync] 已同步远程数据');
    }
    // 如果有 token 且有未推送数据，推送之
    if (this.hasToken() && localStorage.getItem(this._pendingKey) === 'true') {
      console.log('[Sync] 推送待同步数据...');
      await this.push();
    }
    return this.getStatus();
  },

  // ── 标记有未同步数据 ──
  markPending() {
    if (this.hasToken()) {
      localStorage.setItem(this._pendingKey, 'true');
      clearTimeout(this._pushTimer);
      this._pushTimer = setTimeout(() => this.push(), 2000);
    }
  },

  _forcePull: false,
  _pushTimer: null
};
