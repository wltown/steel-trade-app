// ==================== SYNC MODULE ====================
// 废钢管理系统 — 跨设备数据同步
// 通过 GitHub 仓库 data.json 实现手机和电脑数据同步

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
    localStorage.setItem(this._tokenKey, t.trim());
  },
  hasToken() {
    return !!this.getToken();
  },

  // ── 元数据 ──
  _getMeta() {
    try { return JSON.parse(localStorage.getItem('steel_sync_meta') || '{}'); } catch { return {}; }
  },
  _setMeta(obj) {
    localStorage.setItem('steel_sync_meta', JSON.stringify(obj));
  },
  _getRemoteSHA() {
    return localStorage.getItem(this._shaKey) || '';
  },
  _setRemoteSHA(sha) {
    localStorage.setItem(this._shaKey, sha);
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
      remoteSHA: this._getRemoteSHA()
    };
  },

  // ── 从GitHub拉取数据 (无需认证) ──
  async pull() {
    try {
      const resp = await fetch(this._dataUrl(), { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!data || !data._meta) throw new Error('数据格式无效');

      // 检查是否比本地新
      const meta = this._getMeta();
      const remoteTime = data._meta.lastModified || '';
      const localTime = meta.lastPull || '';
      if (remoteTime && localTime && remoteTime <= localTime && !this._forcePull) {
        console.log('[Sync] 远程数据未更新，跳过');
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
      // 同步设置（settings表是key-value数组，也要同步）
      if (Array.isArray(data.settings)) {
        localStorage.setItem('steel_v5_settings', JSON.stringify(data.settings));
      }

      this._setMeta({ ...meta, lastPull: remoteTime || new Date().toISOString() });
      this._forcePull = false;
      localStorage.removeItem(this._pendingKey);
      console.log(`[Sync] 拉取完成: ${count} 条记录`);
      return { updated: true, count };
    } catch (e) {
      console.warn('[Sync] 拉取失败:', e.message);
      return { updated: false, error: e.message };
    }
  },

  // ── 推送到GitHub (需要Token) ──
  async push() {
    if (!this.hasToken()) {
      localStorage.setItem(this._pendingKey, 'true');
      return { ok: false, error: '未设置Token，请在设置中输入GitHub Token' };
    }

    try {
      // 收集所有数据
      const tables = ['orders', 'vehicles', 'plants', 'capital', 'payers', 'reminders', 'settings'];
      const data = {};
      for (const t of tables) {
        try {
          data[t] = JSON.parse(localStorage.getItem(`steel_v5_${t}`) || '[]');
        } catch {
          data[t] = [];
        }
      }
      data._meta = {
        version: 1,
        lastModified: new Date().toISOString(),
        description: '废钢管理系统数据文件 - 由 sync.js 自动维护'
      };

      const jsonStr = JSON.stringify(data);
      // base64编码（兼容中文）
      const base64 = btoa(unescape(encodeURIComponent(jsonStr)));

      // 先获取远程SHA（乐观锁）
      let sha = '';
      try {
        const headResp = await fetch(this._apiUrl(), {
          headers: {
            'Authorization': `token ${this.getToken()}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });
        if (headResp.ok) {
          const headData = await headResp.json();
          sha = headData.sha || '';
        }
      } catch {}

      // 发送PUT请求
      const body = JSON.stringify({
        message: `数据同步 ${new Date().toLocaleString('zh-CN')}`,
        content: base64,
        branch: this._branch,
        ...(sha ? { sha } : {})
      });

      const resp = await fetch(this._apiUrl(), {
        method: 'PUT',
        headers: {
          'Authorization': `token ${this.getToken()}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body
      });

      if (!resp.ok) {
        const errData = await resp.json();
        if (resp.status === 401) {
          this.setToken(''); // 清除无效token
          throw new Error('Token无效，请重新设置');
        }
        if (resp.status === 409) {
          // 冲突：远程有更新，先拉再推
          console.log('[Sync] 检测到冲突，先拉取远程数据...');
          this._forcePull = true;
          await this.pull();
          return this.push(); // 重试
        }
        throw new Error(errData.message || `HTTP ${resp.status}`);
      }

      const result = await resp.json();
      if (result.content && result.content.sha) {
        this._setRemoteSHA(result.content.sha);
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

  // ── 初始化 ──
  async init() {
    console.log('[Sync] 初始化...');
    const status = this.getStatus();

    if (status.hasToken) {
      // 有token：先拉取远程数据，合并到本地
      const pullResult = await this.pull();
      if (pullResult.updated) {
        console.log('[Sync] 已同步远程数据');
      }
      // 如果有未推送的改动，推送之
      if (localStorage.getItem(this._pendingKey) === 'true') {
        console.log('[Sync] 推送待同步数据...');
        await this.push();
      }
    } else {
      console.log('[Sync] 未设置Token，跳过同步（请先在设置中输入GitHub Token）');
    }

    return status;
  },

  // ── 标记有未同步数据 ──
  markPending() {
    if (this.hasToken()) {
      localStorage.setItem(this._pendingKey, 'true');
      // 延迟推送（防抖，等用户连续操作完）
      clearTimeout(this._pushTimer);
      this._pushTimer = setTimeout(() => this.push(), 2000);
    }
  },

  _forcePull: false,
  _pushTimer: null
};
