/* 个人工作台 · js/notes.js
   快速笔记模块：数据读写。
   数据结构（PRD §3）：id, cause(可空), body, createdAt
   提交制：只有点「提交」才写入，输入过程不保存、不留草稿。
   提交后不可编辑，写错只能删除重录（PRD §3 / §8）。 */
(function () {
  'use strict';

  var storage = window.Workbench.storage;

  /* 生成 id：优先 crypto.randomUUID()，不支持时退回时间戳 + 随机串 */
  /* TODO：等第三个模块也需要生成 id 时，再把它提到共用位置 */
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
      detail: { module: 'notes' }
    }));
  }

  function getAll() {
    var list = storage.get('notes');
    return Array.isArray(list) ? list : [];
  }

  function saveAll(list) {
    return storage.set('notes', list);
  }

  /* 新提交的排前面。
     同一毫秒内提交两条时 createdAt 会完全相同，用「后写入的更大」兜底，保证顺序稳定。 */
  function sortItems(list) {
    return list
      .map(function (note, index) { return { note: note, index: index }; })
      .sort(function (a, b) {
        var byTime = String(b.note.createdAt).localeCompare(String(a.note.createdAt));
        if (byTime !== 0) return byTime;
        return b.index - a.index;
      })
      .map(function (pair) { return pair.note; });
  }

  function getList() {
    return sortItems(getAll());
  }

  function getById(id) {
    var found = getAll().filter(function (item) { return item && item.id === id; });
    return found.length ? found[0] : null;
  }

  function count() {
    return getAll().length;
  }

  /* 提交时间展示到秒：2026-09-17 08:30:00 */
  function formatCreatedAt(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /* 起因选填、内容必填；内容为空白（含纯空格、换行）时不写入 */
  function add(input) {
    var data = input || {};
    var body = typeof data.body === 'string' ? data.body.trim() : '';
    if (body === '') return null;

    var cause = typeof data.cause === 'string' ? data.cause.trim() : '';

    var note = {
      id: newId(),
      cause: cause,
      body: body,
      createdAt: new Date().toISOString()   /* 提交时写入，之后不可改 */
    };

    var list = getAll();
    list.push(note);
    if (!saveAll(list)) return null;
    notify();
    return note;
  }

  function remove(id) {
    var list = getAll();
    var next = list.filter(function (item) { return !item || item.id !== id; });
    if (next.length === list.length) return false;
    saveAll(next);
    notify();
    return true;
  }

  window.Workbench = window.Workbench || {};
  window.Workbench.notes = {
    getAll: getAll,
    getList: getList,
    getById: getById,
    count: count,
    formatCreatedAt: formatCreatedAt,
    add: add,
    remove: remove
  };
})();
