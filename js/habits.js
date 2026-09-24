/* 个人工作台 · js/habits.js
   打卡模块：用户自己增删改的打卡项 + 分周期进度。
   2026-09-24 改版：从「四种固定」开放为可自建 / 改名字 / 改类型 / 删除。

   数据结构（存在 workbench.habits，对象）：
     {
       initialized: true,                       // 见下方「为什么需要这个标记」
       config: {
         <id>: { label: '喝水', kind: 'count'|'once', period: 'day'|'week',
                 target: Number, order: Number }
       },
       records: {
         day:  { '2026-09-20': { <id>: 3, ... }, ... },   // key = 当天本地日期
         week: { '2026-09-14': { ... }, ... }             // key = 该周「周一」的本地日期
       }
     }

   约定与坑：
   - 日/周分开两张表，避免「周一」既是周起点又是当天、键名相同而串数据
   - 进新的一天 / 新的一周时，当前周期自然从 0 算起；**历史周期的键一直保留，不删除**
   - 多次型（count）：+1，达到目标后停止增加；一次型（once）：目标固定 1，点一下完成
   - **老数据的四个 key（water / sport / study / work）原样保留**：记录是按 id 存的，
     换 id 等于把历史记录全丢掉。新加的打卡项才用随机 id。
   - **为什么需要 initialized 标记**：如果只按「config 为空就种回那四项」来判断，
     用户把打卡项全删光之后，下次读取又会把四项自动种回来 —— 用户会以为删不掉。
     所以写成「从没初始化过 且 config 为空」才种，任何一次写入都会打上 initialized。
   - records 里暂时对不上 config 的 key **不丢弃**（删除打卡时是显式清理）。
     原因：读取时顺手过滤，一旦哪次读到配置异常就会把历史记录悄悄抹掉。 */
(function () {
  'use strict';

  var storage = window.Workbench.storage;

  var PERIODS = ['day', 'week'];
  var PERIOD_LABEL = { day: '每日', week: '每周' };

  var KINDS = ['count', 'once'];
  var KIND_LABEL = { count: '多次型', once: '一次型' };

  var DEFAULT_PERIOD = 'day';
  var DEFAULT_KIND = 'count';
  var LABEL_MAX = 12;

  /* 老版本的四个固定项。既用于首次初始化，也用于给老数据补 label / kind */
  var LEGACY = [
    { key: 'water', label: '喝水', kind: 'count', target: 8 },
    { key: 'sport', label: '运动', kind: 'once',  target: 1 },
    { key: 'study', label: '学习', kind: 'count', target: 1 },
    { key: 'work',  label: '工作', kind: 'once',  target: 1 }
  ];

  function legacyDef(id) {
    var found = LEGACY.filter(function (m) { return m.key === id; });
    return found.length ? found[0] : null;
  }

  function notify() {
    window.dispatchEvent(new CustomEvent('workbench:data-changed', {
      detail: { module: 'habits' }
    }));
  }

  function intOr(value, fallback) {
    var n = Math.floor(Number(value));
    return isFinite(n) ? n : fallback;
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /* 新打卡项的 id。与待办用同一套兜底写法：优先 crypto.randomUUID() */
  function newId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (err) {
      /* 忽略，走兜底 */
    }
    return 'hb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* 名称：去掉首尾空白、压掉换行、截断到上限。空名返回 '' 由调用方决定怎么处理 */
  function cleanLabel(value) {
    if (typeof value !== 'string') return '';
    var text = value.replace(/[\r\n\t]+/g, ' ').trim();
    if (text.length > LABEL_MAX) text = text.slice(0, LABEL_MAX);
    return text;
  }

  function normalizeKind(value, fallback) {
    return KINDS.indexOf(value) !== -1 ? value : fallback;
  }

  function normalizePeriod(value) {
    return PERIODS.indexOf(value) !== -1 ? value : DEFAULT_PERIOD;
  }

  /* 一次型的目标永远是 1；多次型至少 1 */
  function normalizeTarget(kind, value, fallback) {
    if (kind === 'once') return 1;
    var n = intOr(value, fallback);
    if (!isFinite(n) || n < 1) n = 1;
    if (n > 999) n = 999;
    return n;
  }

  /* ---------- 周期键：一律按用户本地时间 ---------- */

  function dayKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  /* 本周起点 = 周一；周日归到上一个周一 */
  function mondayOf(date) {
    var day = date.getDay();                 /* 0 = 周日 */
    var offset = day === 0 ? 6 : day - 1;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
  }

  function bucketKey(period, date) {
    return period === 'week' ? dayKey(mondayOf(date)) : dayKey(date);
  }

  /* ---------- 读取与规范化 ---------- */

  function emptyStore() {
    return { initialized: true, config: {}, records: { day: {}, week: {} } };
  }

  function normalize(raw) {
    var src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    var rawConfig = (src.config && typeof src.config === 'object' && !Array.isArray(src.config))
      ? src.config : {};
    var ids = Object.keys(rawConfig);

    var out = emptyStore();
    out.initialized = true;

    /* 只有「从没初始化过」且 config 为空，才种回老的四项。
       被用户删空（有 initialized）就真的是空的，不再自己长回来。 */
    if (ids.length === 0 && src.initialized !== true) {
      LEGACY.forEach(function (mod, i) {
        out.config[mod.key] = {
          label: mod.label, kind: mod.kind, period: DEFAULT_PERIOD,
          target: mod.target, order: i
        };
      });
    } else {
      ids.forEach(function (id, i) {
        var saved = (rawConfig[id] && typeof rawConfig[id] === 'object') ? rawConfig[id] : {};
        var legacy = legacyDef(id);

        var label = cleanLabel(saved.label);
        if (label === '') label = legacy ? legacy.label : '未命名';

        var kind = normalizeKind(saved.kind, legacy ? legacy.kind : DEFAULT_KIND);
        var period = normalizePeriod(saved.period);
        var target = normalizeTarget(kind, saved.target, legacy ? legacy.target : 1);

        out.config[id] = {
          label: label,
          kind: kind,
          period: period,
          target: target,
          order: intOr(saved.order, i)
        };
      });
    }

    ['day', 'week'].forEach(function (period) {
      var table = (src.records && typeof src.records === 'object' && src.records[period]) || {};
      if (!table || typeof table !== 'object') return;

      Object.keys(table).forEach(function (bucket) {
        var entry = table[bucket];
        if (!entry || typeof entry !== 'object') return;

        var clean = {};
        Object.keys(entry).forEach(function (id) {
          var v = intOr(entry[id], 0);
          if (v > 0) clean[id] = v;
        });

        if (Object.keys(clean).length > 0) out.records[period][bucket] = clean;
      });
    });

    return out;
  }

  function getStore() {
    return normalize(storage.get('habits'));
  }

  function saveStore(store) {
    store.initialized = true;
    return storage.set('habits', store);
  }

  /* 兼容旧调用：返回存储里的原始内容 */
  function getAll() {
    var raw = storage.get('habits');
    return raw && typeof raw === 'object' ? raw : {};
  }

  /* ---------- 查询 ---------- */

  /* 按 order 排好的打卡项列表（只含配置，不含进度） */
  function listHabits(store) {
    var s = store || getStore();
    return Object.keys(s.config)
      .map(function (id) {
        var cfg = s.config[id];
        return {
          id: id, label: cfg.label, kind: cfg.kind,
          period: cfg.period, target: cfg.target, order: cfg.order
        };
      })
      .sort(function (a, b) {
        if (a.order !== b.order) return a.order - b.order;
        /* order 相同时按 id 兜底，保证顺序稳定不跳 */
        return String(a.id).localeCompare(String(b.id));
      });
  }

  function getProgress(id) {
    var store = getStore();
    var cfg = store.config[id];
    if (!cfg) return null;

    var bucket = bucketKey(cfg.period, new Date());
    var entry = store.records[cfg.period][bucket] || {};
    var value = intOr(entry[id], 0);
    if (value > cfg.target) value = cfg.target;   /* 防御：超出目标一律按目标算 */

    return {
      id: id,
      key: id,                    /* 旧字段名，看板那边还在用 */
      label: cfg.label,
      kind: cfg.kind,
      period: cfg.period,
      periodLabel: PERIOD_LABEL[cfg.period],
      target: cfg.target,
      value: value,
      done: value >= cfg.target,
      bucket: bucket
    };
  }

  function getAllProgress() {
    return listHabits().map(function (item) { return getProgress(item.id); });
  }

  /* 看板要的概览：当前周期达标 X / 总数 */
  function getSummary() {
    var items = getAllProgress();
    var done = items.filter(function (it) { return it && it.done; }).length;
    return { done: done, total: items.length, items: items };
  }

  /* 某一项到底有多少个周期留下了记录（删除时用来告诉用户会连带删掉多少） */
  function countRecords(id) {
    var raw = storage.get('habits') || {};
    var tables = raw.records || {};
    var total = 0;
    ['day', 'week'].forEach(function (period) {
      var table = tables[period];
      if (!table || typeof table !== 'object') return;
      Object.keys(table).forEach(function (bucket) {
        var entry = table[bucket];
        if (entry && typeof entry === 'object' && intOr(entry[id], 0) > 0) total++;
      });
    });
    return total;
  }

  /* ---------- 打卡项：增 / 改 / 删 ---------- */

  function addHabit(input) {
    var data = input || {};
    var label = cleanLabel(data.label);
    if (label === '') return { ok: false, message: '先给打卡项起个名字。' };

    var kind = normalizeKind(data.kind, DEFAULT_KIND);
    var store = getStore();
    var id = newId();

    var maxOrder = -1;
    Object.keys(store.config).forEach(function (k) {
      if (store.config[k].order > maxOrder) maxOrder = store.config[k].order;
    });

    store.config[id] = {
      label: label,
      kind: kind,
      period: normalizePeriod(data.period),
      target: normalizeTarget(kind, data.target, 1),
      order: maxOrder + 1
    };

    if (!saveStore(store)) return { ok: false, message: '保存失败，浏览器存储可能不可用。' };
    notify();
    return { ok: true, id: id, item: getProgress(id) };
  }

  /* 改名字 / 类型 / 周期 / 目标。id 与已有记录都不动 */
  function updateHabit(id, patch) {
    var store = getStore();
    var cfg = store.config[id];
    if (!cfg) return { ok: false, message: '找不到这个打卡项。' };

    var data = patch || {};

    if (data.label !== undefined) {
      var label = cleanLabel(data.label);
      if (label === '') return { ok: false, message: '名字不能空着。' };
      cfg.label = label;
    }

    if (data.kind !== undefined) {
      var kind = normalizeKind(data.kind, null);
      if (!kind) return { ok: false, message: '类型只能是「一次型」或「多次型」。' };
      cfg.kind = kind;
      /* 切成一次型时目标强制回 1；切回多次型至少留 1，不让目标变成 0 */
      cfg.target = kind === 'once' ? 1 : normalizeTarget(kind, cfg.target, 1);
    }

    if (data.period !== undefined) {
      var period = normalizePeriod(data.period);
      if (PERIODS.indexOf(data.period) === -1) return { ok: false, message: '周期只能是「每日」或「每周」。' };
      cfg.period = period;
    }

    if (data.target !== undefined) {
      if (cfg.kind === 'once') {
        /* 一次型不接受自定义目标，但也不该报错打断用户 —— 直接按 1 处理 */
        cfg.target = 1;
      } else {
        var n = Math.floor(Number(data.target));
        if (!isFinite(n) || n < 1) return { ok: false, message: '目标次数要填大于 0 的整数。' };
        cfg.target = normalizeTarget(cfg.kind, n, 1);
      }
    }

    if (!saveStore(store)) return { ok: false, message: '保存失败，浏览器存储可能不可用。' };
    notify();
    return { ok: true, item: getProgress(id) };
  }

  /* 删除打卡项。records 里属于它的记录一并清掉（调用方必须先让用户确认） */
  function removeHabit(id) {
    var store = getStore();
    if (!store.config[id]) return { ok: false, message: '找不到这个打卡项。' };

    var label = store.config[id].label;
    var removed = countRecords(id);

    delete store.config[id];

    ['day', 'week'].forEach(function (period) {
      var table = store.records[period];
      Object.keys(table).forEach(function (bucket) {
        if (table[bucket] && Object.prototype.hasOwnProperty.call(table[bucket], id)) {
          delete table[bucket][id];
          /* 这一天的记录被清空就整条去掉，别留空壳 */
          if (Object.keys(table[bucket]).length === 0) delete table[bucket];
        }
      });
    });

    if (!saveStore(store)) return { ok: false, message: '保存失败，浏览器存储可能不可用。' };
    notify();
    return { ok: true, label: label, removedRecords: removed };
  }

  /* ---------- 记录：打卡与设置（保持原有对外名字） ---------- */

  function bump(id) {
    var store = getStore();
    var cfg = store.config[id];
    if (!cfg) return { changed: false, message: '找不到这个打卡项。' };

    var bucket = bucketKey(cfg.period, new Date());
    var map = store.records[cfg.period];
    if (!map[bucket]) map[bucket] = {};

    var current = intOr(map[bucket][id], 0);
    if (current >= cfg.target) {
      return { changed: false, message: '已经达标了，不再增加。', progress: getProgress(id) };
    }

    map[bucket][id] = current + 1;
    if (!saveStore(store)) {
      return { changed: false, message: '保存失败，浏览器存储可能不可用。' };
    }

    notify();
    return { changed: true, progress: getProgress(id) };
  }

  /* 点一下 −1（一次型达标时值为 1，减 1 就是撤销完成）。减到 0 为止。
     减到 0 时把这条键删掉，不留 0 值 —— 免得存储里堆一堆"值为 0 的空记录" */
  function unbump(id) {
    var store = getStore();
    var cfg = store.config[id];
    if (!cfg) return { changed: false, message: '找不到这个打卡项。' };

    var bucket = bucketKey(cfg.period, new Date());
    var table = store.records[cfg.period];
    var entry = table[bucket];
    var current = entry ? intOr(entry[id], 0) : 0;

    if (current <= 0) {
      return { changed: false, message: '当前是 0，没有可减的次数。', progress: getProgress(id) };
    }

    if (current - 1 > 0) {
      entry[id] = current - 1;
    } else {
      delete entry[id];
      /* 这一天的记录被清空就整条去掉，别留空壳 */
      if (Object.keys(entry).length === 0) delete table[bucket];
    }

    if (!saveStore(store)) {
      return { changed: false, message: '保存失败，浏览器存储可能不可用。' };
    }

    notify();
    return { changed: true, progress: getProgress(id) };
  }

  /* 设置周期：每日 / 每周。切换周期只是换一张表看，旧表数据留着 */
  function setPeriod(id, period) {
    return updateHabit(id, { period: period });
  }

  /* 设置目标次数：一次型固定 1，不接受修改 */
  function setTarget(id, target) {
    var store = getStore();
    var cfg = store.config[id];
    if (!cfg) return { ok: false, message: '找不到这个打卡项。' };
    if (cfg.kind === 'once') return { ok: false, message: '一次型的目标固定为 1，不能改。' };
    return updateHabit(id, { target: target });
  }

  window.Workbench = window.Workbench || {};
  window.Workbench.habits = {
    PERIODS: PERIODS,
    PERIOD_LABEL: PERIOD_LABEL,
    KINDS: KINDS,
    KIND_LABEL: KIND_LABEL,
    LABEL_MAX: LABEL_MAX,
    LEGACY: LEGACY,
    getAll: getAll,
    listHabits: listHabits,
    countRecords: countRecords,
    getProgress: getProgress,
    getAllProgress: getAllProgress,
    getSummary: getSummary,
    addHabit: addHabit,
    updateHabit: updateHabit,
    removeHabit: removeHabit,
    bump: bump,
    unbump: unbump,
    setPeriod: setPeriod,
    setTarget: setTarget
  };
})();
