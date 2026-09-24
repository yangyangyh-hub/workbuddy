/* 个人工作台 · js/storage.js
   全站唯一的 localStorage 读写入口。
   约定（见 AGENTS.md）：任何模块都不得直接调用 localStorage.getItem / setItem / removeItem。
   读取到缺失、损坏或结构不符的数据时，返回安全默认值，绝不让整页白屏。 */
(function () {
  'use strict';

  var KEYS = {
    todos: 'workbench.todos',
    notes: 'workbench.notes',
    links: 'workbench.links',
    snippets: 'workbench.snippets',
    ledger: 'workbench.ledger',
    habits: 'workbench.habits',
    meta: 'workbench.meta'
  };

  /* 每个 key 的安全默认值：数组类给 []，对象类给默认对象 */
  var DEFAULTS = {
    todos: [],
    notes: [],
    links: [],
    snippets: [],
    ledger: [],
    /* 打卡存的是对象（配置 + 分日/分周记录），不是数组 */
    habits: { config: {}, records: { day: {}, week: {} } },
    meta: { schemaVersion: 1 }
  };

  function warn(msg) {
    if (window.console && window.console.warn) {
      window.console.warn('[storage] ' + msg);
    }
  }

  /* 写入失败时广播一条消息（没有内存泄漏风险，app.js 会显示在页脚提示位） */
  function reportError(key, message) {
    try {
      window.dispatchEvent(new CustomEvent('workbench:storage-error', {
        detail: { key: key, message: message }
      }));
    } catch (err) {
      /* 忽略：老浏览器没有 CustomEvent 就只进控制台 */
    }
  }

  function cloneDefault(name) {
    var def = DEFAULTS[name];
    if (Array.isArray(def)) return [];
    if (def && typeof def === 'object') return JSON.parse(JSON.stringify(def));
    return null;
  }

  function isArrayKey(name) {
    return Array.isArray(DEFAULTS[name]);
  }

  function isObjectKey(name) {
    return !!DEFAULTS[name] && typeof DEFAULTS[name] === 'object' && !Array.isArray(DEFAULTS[name]);
  }

  /* get(name [, fallback]) —— 读取并校验结构；任何异常都返回安全默认值 */
  function get(name, fallback) {
    if (!Object.prototype.hasOwnProperty.call(KEYS, name)) {
      warn('未知的 key：' + name);
      return fallback === undefined ? null : fallback;
    }

    var safe = fallback === undefined ? cloneDefault(name) : fallback;
    var raw;

    try {
      raw = window.localStorage.getItem(KEYS[name]);
    } catch (err) {
      warn('读取失败（浏览器可能禁用了本地存储）：' + name);
      return safe;
    }

    if (raw === null || raw === '') return safe;

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      warn('JSON 已损坏，返回默认值：' + name);
      return safe;
    }

    if (isArrayKey(name) && !Array.isArray(parsed)) {
      warn('结构不符（应为数组），返回默认值：' + name);
      return safe;
    }

    if (isObjectKey(name) && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
      warn('结构不符（应为对象），返回默认值：' + name);
      return safe;
    }

    return parsed;
  }

  /* set(name, value) —— 写成功返回 true；失败返回 false 并广播提示 */
  function set(name, value) {
    if (!Object.prototype.hasOwnProperty.call(KEYS, name)) {
      warn('未知的 key：' + name);
      reportError(name, '未知的数据类型，没有保存。');
      return false;
    }
    try {
      window.localStorage.setItem(KEYS[name], JSON.stringify(value));
      return true;
    } catch (err) {
      warn('写入失败（可能已禁用本地存储或配额已满）：' + name);
      reportError(name, '数据没能保存：浏览器存储可能已满或被禁用。建议先导出备份，再清理空间重试。');
      return false;
    }
  }

  /* remove(name) —— 只删本项目自己的 key，绝不使用 localStorage.clear() */
  function remove(name) {
    if (!Object.prototype.hasOwnProperty.call(KEYS, name)) {
      warn('未知的 key：' + name);
      return false;
    }
    try {
      window.localStorage.removeItem(KEYS[name]);
      return true;
    } catch (err) {
      warn('删除失败：' + name);
      return false;
    }
  }

  /* has(name) —— 该 key 是否已经存在（不判断内容是否合法） */
  function has(name) {
    if (!Object.prototype.hasOwnProperty.call(KEYS, name)) return false;
    try {
      return window.localStorage.getItem(KEYS[name]) !== null;
    } catch (err) {
      return false;
    }
  }

  /* ---------- 数据管理：导出 / 导入 / 清空 ---------- */

  var SCHEMA_VERSION = 1;
  var APP_NAME = '个人工作台';

  /* 六类业务数据（meta 单独处理，不在这张表里） */
  var DATA_KEYS = ['todos', 'notes', 'links', 'snippets', 'ledger', 'habits'];

  var LABELS = {
    todos: '待办',
    notes: '笔记',
    links: '常用网站',
    snippets: '常用文本',
    ledger: '记账',
    habits: '打卡设置与记录'
  };

  /* 清空时只删这些 key —— 明确列出，绝不调用 localStorage.clear() */
  function allKeys() {
    return DATA_KEYS.concat(['meta']).map(function (name) { return KEYS[name]; });
  }

  function readAll() {
    var data = {};
    DATA_KEYS.forEach(function (name) { data[name] = get(name); });
    return data;
  }

  /* 条数（用于导入摘要；habits 是对象，单独描述） */
  function countOf(name, value) {
    if (name === 'habits') {
      var cfg = value && value.config ? Object.keys(value.config).length : 0;
      var rec = value && value.records || {};
      var days = rec.day ? Object.keys(rec.day).length : 0;
      var weeks = rec.week ? Object.keys(rec.week).length : 0;
      return cfg + ' 项设置 · ' + days + ' 天记录 · ' + weeks + ' 周记录';
    }
    if (Array.isArray(value)) return value.length + ' 条';
    return '—';
  }

  /* 组装导出内容：只有结构化数据，不含任何图片 / base64 */
  function buildExport() {
    return {
      app: APP_NAME,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: readAll(),
      meta: get('meta')
    };
  }

  /* 校验导入内容；返回 { ok, errors, summary, payload } */
  function validateImport(text) {
    var errors = [];

    var parsed;
    try {
      parsed = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (err) {
      return { ok: false, errors: ['这不是有效的 JSON 文件。'], summary: [] };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, errors: ['文件内容不是一份导出数据（顶层应该是对象）。'], summary: [] };
    }

    var version = parsed.schemaVersion;
    if (typeof version !== 'number' || !isFinite(version)) {
      return { ok: false, errors: ['缺少 schemaVersion，无法确认这份文件的格式。'], summary: [] };
    }
    if (version > SCHEMA_VERSION) {
      return {
        ok: false,
        errors: ['这份文件来自更新的版本（schemaVersion=' + version + '，本页只认 ' + SCHEMA_VERSION + '）。请升级页面后再导入，现有数据不会被改动。'],
        summary: []
      };
    }
    if (version < SCHEMA_VERSION) {
      return {
        ok: false,
        errors: ['这份文件的版本偏旧（schemaVersion=' + version + '），没有对应的迁移逻辑，暂不导入，以免丢字段。现有数据不会被改动。'],
        summary: []
      };
    }

    if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
      return { ok: false, errors: ['缺少 data 段。'], summary: [] };
    }

    var summary = [];
    var payload = { data: {}, meta: parsed.meta };

    DATA_KEYS.forEach(function (name) {
      var value = parsed.data[name];
      var label = LABELS[name];

      if (value === undefined || value === null) {
        summary.push({ label: label, detail: '文件里没有，导入后这一项会被清空', missing: true });
        payload.data[name] = cloneDefault(name);
        return;
      }

      if (isArrayKey(name) && !Array.isArray(value)) {
        errors.push('「' + label + '」应该是数组。');
        return;
      }
      if (isObjectKey(name) && (!value || typeof value !== 'object' || Array.isArray(value))) {
        errors.push('「' + label + '」应该是对象。');
        return;
      }

      payload.data[name] = value;
      summary.push({ label: label, detail: countOf(name, value), missing: false });
    });

    if (errors.length) return { ok: false, errors: errors, summary: [] };

    /* meta 不是必需，但必须是对象 */
    if (payload.meta !== undefined && payload.meta !== null &&
        (typeof payload.meta !== 'object' || Array.isArray(payload.meta))) {
      return { ok: false, errors: ['meta 应该是对象。'], summary: [] };
    }

    return {
      ok: true,
      errors: [],
      summary: summary,
      exportedAt: parsed.exportedAt || '',
      payload: payload
    };
  }

  /* 覆盖写入。中途失败则回滚到写入前的内容，保证现有数据不被打散 */
  function applyImport(payload) {
    var backup = {};
    var names = DATA_KEYS.concat(['meta']);

    names.forEach(function (name) {
      try { backup[name] = window.localStorage.getItem(KEYS[name]); }
      catch (err) { backup[name] = null; }
    });

    function restore() {
      names.forEach(function (name) {
        try {
          if (backup[name] === null) window.localStorage.removeItem(KEYS[name]);
          else window.localStorage.setItem(KEYS[name], backup[name]);
        } catch (err) { /* 回滚尽力而为 */ }
      });
    }

    var failed = null;
    DATA_KEYS.forEach(function (name) {
      if (failed) return;
      if (!set(name, payload.data[name])) failed = name;
    });

    if (!failed && payload.meta !== undefined && payload.meta !== null) {
      if (!set('meta', payload.meta)) failed = 'meta';
    }

    if (failed) {
      restore();
      return { ok: false, message: '写入失败（' + (LABELS[failed] || failed) + '），已回滚到你原来的数据。' };
    }

    return { ok: true };
  }

  /* 清空：只删约定的 workbench.* key，禁止 localStorage.clear() */
  function clearAll() {
    var failed = [];
    allKeys().forEach(function (key) {
      try { window.localStorage.removeItem(key); }
      catch (err) { failed.push(key); }
    });
    return { ok: failed.length === 0, failed: failed };
  }

  window.Workbench = window.Workbench || {};
  window.Workbench.storage = {
    KEYS: KEYS,
    DATA_KEYS: DATA_KEYS,
    LABELS: LABELS,
    SCHEMA_VERSION: SCHEMA_VERSION,
    get: get,
    set: set,
    remove: remove,
    has: has,
    readAll: readAll,
    buildExport: buildExport,
    validateImport: validateImport,
    applyImport: applyImport,
    clearAll: clearAll
  };
})();
