/* 个人工作台 · js/ledger.js
   记账模块（手动记账部分）。
   数据结构（PRD §6）：id, amount, type(in|out), category, note, createdAt, source
   金额：**以「分」为单位的整数、数字类型存储**（8650 = ¥86.50），展示时除以 100 保留两位小数。
   本周 = 周一到周日；日期一律按用户本地时间。
   OCR 相关逻辑今天不做（不引入 Tesseract、不处理图片）。 */
(function () {
  'use strict';

  var storage = window.Workbench.storage;

  var TYPES = ['in', 'out'];
  var TYPE_LABEL = { in: '收入', out: '支出' };

  /* 分类固定枚举，用户不可自定义（PRD §6） */
  var CATEGORIES = {
    out: ['餐饮', '交通', '购物', '居住', '医疗', '其他'],
    in: ['工资', '报销', '其他']
  };

  /* 金额上限：99,999,999.99 元 */
  var MAX_CENTS = 9999999999;

  function newId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (err) {
      /* 忽略，走兜底 */
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function notify() {
    window.dispatchEvent(new CustomEvent('workbench:data-changed', {
      detail: { module: 'ledger' }
    }));
  }

  function getAll() {
    var list = storage.get('ledger');
    return Array.isArray(list) ? list : [];
  }

  /* 新记录的排前面；同一毫秒写入时用写入顺序兜底 */
  function getList() {
    return getAll()
      .map(function (item, index) { return { item: item, index: index }; })
      .sort(function (a, b) {
        var byTime = String(b.item.createdAt).localeCompare(String(a.item.createdAt));
        if (byTime !== 0) return byTime;
        return b.index - a.index;
      })
      .map(function (pair) { return pair.item; });
  }

  /* ---------- 金额 ---------- */

  /* 金额格式化：分 → 两位小数字符串。8650 → "86.50" */
  function formatAmount(cents) {
    var n = Number(cents);
    if (!isFinite(n)) n = 0;
    return (n / 100).toFixed(2);
  }

  /* 用户输入的「元」→「分」。只接受正数，最多两位小数 */
  function parseAmount(raw) {
    var s = typeof raw === 'string' ? raw.trim() : String(raw === undefined || raw === null ? '' : raw).trim();
    if (s === '') return { ok: false, message: '金额不能为空。' };

    s = s.replace(/^[¥￥]/, '').trim();          /* 容忍误输的货币符号 */
    if (s.charAt(0) === '.') s = '0' + s;        /* 容忍漏写整数位的 .5 */
    if (!/^\d+(\.\d{1,2})?$/.test(s)) {
      return { ok: false, message: '金额只能是数字，最多两位小数，例如 86.50。' };
    }

    var yuan = Number(s);
    if (!isFinite(yuan) || yuan <= 0) return { ok: false, message: '金额要大于 0。' };

    var cents = Math.round(yuan * 100);
    if (cents <= 0) return { ok: false, message: '金额要大于 0。' };
    if (cents > MAX_CENTS) return { ok: false, message: '金额太大，超出可记录范围。' };

    return { ok: true, cents: cents };
  }

  /* ---------- 周期汇总（单位：分） ---------- */

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  /* 本周起点：周一 00:00（本地时间） */
  function startOfWeek(date) {
    var day = date.getDay();               /* 0=周日 */
    var offset = day === 0 ? 6 : day - 1;  /* 周一为 0 */
    var monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
    return monday.getTime();
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  }

  function sumBetween(list, type, from, now) {
    return list.reduce(function (acc, item) {
      if (!item || item.type !== type) return acc;
      var t = new Date(item.createdAt).getTime();
      if (isNaN(t) || t < from || t > now) return acc;
      return acc + (Number(item.amount) || 0);
    }, 0);
  }

  /* 今日 / 本周 / 本月 的收与支 */
  function getSummary() {
    var list = getAll();
    var now = new Date();
    var ts = now.getTime();

    function pack(from) {
      return { in: sumBetween(list, 'in', from, ts), out: sumBetween(list, 'out', from, ts) };
    }

    return {
      today: pack(startOfDay(now)),
      week: pack(startOfWeek(now)),
      month: pack(startOfMonth(now))
    };
  }

  /* 展示用：把某条记录的时间显示到秒（MM-DD HH:mm:ss） */
  function formatCreatedAt(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /* ---------- 写入 ---------- */

  function add(input) {
    var data = input || {};

    if (TYPES.indexOf(data.type) === -1) {
      return { ok: false, message: '类型只能是收入或支出。' };
    }
    var type = data.type;

    var parsed = parseAmount(data.amount);
    if (!parsed.ok) return parsed;

    var category = typeof data.category === 'string' ? data.category.trim() : '';
    if (category === '') return { ok: false, message: '分类必填。' };
    if (CATEGORIES[type].indexOf(category) === -1) {
      return { ok: false, message: '分类不在可选范围内。' };
    }

    var note = typeof data.note === 'string' ? data.note.trim() : '';

    /* source：手动记账是 manual；OCR 确认卡入账是 ocr。只认这两个值 */
    var source = data.source === 'ocr' ? 'ocr' : 'manual';

    var item = {
      id: newId(),
      amount: parsed.cents,               /* 分，数字类型 */
      type: type,
      category: category,
      note: note,
      createdAt: new Date().toISOString(), /* 确认保存时自动生成 */
      source: source
    };

    var list = getAll();
    list.push(item);
    if (!storage.set('ledger', list)) {
      return { ok: false, message: '保存失败，浏览器存储可能不可用。' };
    }

    notify();
    return { ok: true, item: item };
  }

  function remove(id) {
    var list = getAll();
    var next = list.filter(function (item) { return !item || item.id !== id; });
    if (next.length === list.length) return false;
    storage.set('ledger', next);
    notify();
    return true;
  }

  window.Workbench = window.Workbench || {};
  window.Workbench.ledger = {
    TYPES: TYPES,
    TYPE_LABEL: TYPE_LABEL,
    CATEGORIES: CATEGORIES,
    getAll: getAll,
    getList: getList,
    formatAmount: formatAmount,
    formatCreatedAt: formatCreatedAt,
    parseAmount: parseAmount,
    getSummary: getSummary,
    add: add,
    remove: remove
  };
})();
