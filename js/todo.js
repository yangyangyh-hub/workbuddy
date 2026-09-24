/* 个人工作台 · js/todo.js
   待办模块：数据读写、统计、截止日期文案、优先级、进度档位。

   数据结构（PRD §2）：
     id, bucket(today|week|month), text, done, priority(high|mid|low), progress,
     deadline(可空), noteId(可空), createdAt

   ★ 进度档位（2026-09-24 新增）
   - progress 取值 0 / 20 / 40 / 60 / 80 / 100；100 就是「完成」
   - done 是 progress 的**派生值**：写入时同步维护，读取时一律用 isDone() 判断。
     这样即使某个字段被手改脏了，也不会出现「进度 100% 却显示未完成」这种矛盾。
   - 旧记录没有 progress → 按 done 反推（true→100 / false→0）。
     不写迁移脚本、schemaVersion 不变、用户不需要重新导入。

   历史：2026-09-24 曾短暂实现过「子任务」（subtasks）。当天按 yang 的要求撤销，
   改为「一条待办 = 一个进度值」。存储里遗留的 subtasks 字段一律忽略，
   **不主动改动用户的存储**（删数据是不可逆动作，不做）。

   约定：
   - 只通过 Workbench.storage 读写，不直接碰 localStorage
   - 每次数据变化派发 'workbench:data-changed'（detail.module = 'todo'）通知看板刷新
   - bucket 由用户自己选，不按日期自动归类；周期切换时也不自动移动 */
(function () {
  'use strict';

  var storage = window.Workbench.storage;
  var BUCKETS = ['today', 'week', 'month'];

  /* 优先级：高 → 中 → 低；数值越小越靠前 */
  var PRIORITIES = ['high', 'mid', 'low'];
  var PRIORITY_LABEL = { high: '高', mid: '中', low: '低' };
  var PRIORITY_RANK = { high: 0, mid: 1, low: 2 };
  var DEFAULT_PRIORITY = 'mid';

  /* 进度档位：界面上是四个按钮 + 一个「完成」按钮 */
  var PROGRESS_TICKS = [20, 40, 60, 80];
  var PROGRESS_DONE = 100;

  /* 生成 id：优先 crypto.randomUUID()，不支持时退回时间戳 + 随机串（不会与现有记录重复） */
  /* TODO：等第二个模块也需要生成 id 时，再把它提到共用位置 */
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
      detail: { module: 'todo' }
    }));
  }

  function getAll() {
    var list = storage.get('todos');
    return Array.isArray(list) ? list : [];
  }

  function saveAll(list) {
    return storage.set('todos', list);
  }

  function isValidBucket(bucket) {
    return BUCKETS.indexOf(bucket) !== -1;
  }

  /* 非法或缺失的优先级一律当「中」：旧记录没这个字段也能正常显示与排序 */
  function normalizePriority(value) {
    return PRIORITIES.indexOf(value) !== -1 ? value : DEFAULT_PRIORITY;
  }

  function getPriority(item) {
    return normalizePriority(item && item.priority);
  }

  /* 列表行上点一下循环切换：高 → 中 → 低 → 高 */
  function nextPriority(value) {
    var i = PRIORITIES.indexOf(normalizePriority(value));
    return PRIORITIES[(i + 1) % PRIORITIES.length];
  }

  function findIn(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  /* ---------- 进度档位 ---------- */

  /* 只认数字。字符串 '40'、null、undefined 一律当成「这个字段没写过」，
     好让它回落到 done —— 导入的 JSON 或手改过的数据都可能出现怪值 */
  function rawProgress(item) {
    if (!item) return null;
    var value = item.progress;
    if (typeof value !== 'number' || !isFinite(value)) return null;
    return value;
  }

  /* 归到最近的合法档位。手改或外部导入的数据里冒出 37% 这种，
     界面上没有对应按钮，就落到 40%；0 及以下归 0。

     ★ 两条规则，都是有意为之：
       1) 候选里**包含 100** —— 99 → 100、85 → 80。
          不把 100 特判排除，那会让函数行为难以预测。
       2) **正中间取较低档位**（30→20、50→40、70→60、90→80）。
          因为 `g < gap` 是严格小于：平局不替换，ticks 升序排列，先遇到的就是低的那个。
          理由：宁可少算完成，也不要把 90% 凭空判成「已完成」——
          完成必须是用户点出来的明确动作。 */
  function normalizeProgress(value) {
    var n = Number(value);
    if (!isFinite(n)) return null;

    n = Math.round(n);
    if (n <= 0) return 0;

    var ticks = PROGRESS_TICKS.concat([PROGRESS_DONE]);
    var best = ticks[0];
    var gap = Math.abs(n - best);

    ticks.forEach(function (tick) {
      var g = Math.abs(n - tick);
      if (g < gap) { gap = g; best = tick; }
    });
    return best;
  }

  /* 单条进度。没有 progress 字段（旧记录）→ 由 done 反推 */
  function getPercent(item) {
    var raw = rawProgress(item);
    if (raw !== null) return normalizeProgress(raw);
    return (item && item.done === true) ? PROGRESS_DONE : 0;
  }

  /* ★ 判断「完成」的唯一入口：只看进度，不看 done 字段。
     想改完成逻辑就改这里一处，别在别处再写一遍 item.done === true */
  function isDone(item) {
    return getPercent(item) === PROGRESS_DONE;
  }

  /* 把进度写成指定值。done 同步维护，两个字段永远一致 */
  function setProgress(id, value) {
    var list = getAll();
    var item = findIn(list, id);
    if (!item) return null;

    var next = normalizeProgress(value);
    if (next === null) next = 0;

    item.progress = next;
    item.done = next === PROGRESS_DONE;

    if (!saveAll(list)) return null;
    notify();
    return item;
  }

  /* 点一个档位按钮。★ 再点一次**当前这一档** → 退回 0%：
     界面上只有 20/40/60/80/完成 五个按钮，没有「0%」，靠这个反转回到未开始。
     「完成」按钮走同一条逻辑，所以完成后再点它就取消完成。 */
  function applyTick(id, tick) {
    var target = normalizeProgress(tick);
    if (target === null) return { ok: false, message: '进度档位不合法。' };

    var item = findIn(getAll(), id);
    if (!item) return { ok: false, message: '找不到这条待办。' };

    var before = isDone(item);
    var next = getPercent(item) === target ? 0 : target;
    var saved = setProgress(id, next);

    if (!saved) return { ok: false, message: '保存失败，浏览器存储可能不可用。' };

    return {
      ok: true,
      item: saved,
      percent: getPercent(saved),
      cleared: next === 0 && target !== 0,            /* 这一次是「取消」而不是「设为 0」 */
      flipped: isDone(saved) !== before               /* 完成状态翻转了 → 列表要重排 */
    };
  }

  /* ---------- 日期：一律按用户本地自然日计算 ---------- */

  function todayStart() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }

  /* 把 'YYYY-MM-DD' 解析成本地零点，避免被当成 UTC 解析而差一天 */
  function parseDateOnly(value) {
    if (typeof value !== 'string') return null;
    var parts = value.split('-');
    if (parts.length !== 3) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var d = parseInt(parts[2], 10);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d).getTime();
  }

  /* 截止日期文案：未填截止日期 / 今天到期 / 还剩 N 天 / 已过期 N 天 */
  function deadlineText(deadline) {
    var target = parseDateOnly(deadline);
    if (target === null) return '未填截止日期';

    var diff = Math.round((target - todayStart()) / 86400000);
    if (diff === 0) return '今天到期';
    if (diff > 0) return '还剩 ' + diff + ' 天';
    return '已过期 ' + Math.abs(diff) + ' 天';
  }

  /* 创建时间展示到秒：2026-09-16 15:08:27 */
  function formatCreatedAt(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /* ---------- 查询 ---------- */

  function sortItems(list) {
    return list.slice().sort(function (a, b) {
      var da = isDone(a) ? 1 : 0;
      var db = isDone(b) ? 1 : 0;
      if (da !== db) return da - db;                        /* 未完成排前面 */

      var pa = PRIORITY_RANK[getPriority(a)];
      var pb = PRIORITY_RANK[getPriority(b)];
      if (pa !== pb) return pa - pb;                        /* 再按 高 → 中 → 低 */

      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
  }

  function getByBucket(bucket) {
    if (!isValidBucket(bucket)) return [];
    return sortItems(getAll().filter(function (item) {
      return item && item.bucket === bucket;
    }));
  }

  function getById(id) {
    var found = getAll().filter(function (item) { return item && item.id === id; });
    return found.length ? found[0] : null;
  }

  /* 统计：传 bucket 就是该 Tab 的完成情况，不传就是全部。
     注意和「单条进度」getPercent 区分：这个返回 { done, total } 条数 */
  function getProgress(bucket) {
    var list = isValidBucket(bucket) ? getByBucket(bucket) : getAll();
    var done = list.filter(isDone).length;
    return { done: done, total: list.length };
  }

  /* ---------- 写入 ---------- */

  /* 空字符串或只有空格时不添加；返回新记录，未添加则返回 null */
  function add(input) {
    var data = input || {};
    var text = typeof data.text === 'string' ? data.text.trim() : '';
    if (text === '') return null;

    var item = {
      id: newId(),
      bucket: isValidBucket(data.bucket) ? data.bucket : 'today',
      text: text,
      done: false,
      priority: normalizePriority(data.priority),   /* 新加的默认「中」 */
      progress: 0,                                  /* 新建从 0% 开始 */
      deadline: data.deadline || '',
      noteId: data.noteId || '',
      createdAt: new Date().toISOString()   /* 提交时自动写入，之后不可改 */
    };

    var list = getAll();
    list.push(item);
    if (!saveAll(list)) return null;
    notify();
    return item;
  }

  /* 完成 / 取消完成。返回改动后的记录，找不到返回 null */
  function setDone(id, done) {
    return setProgress(id, done === true ? PROGRESS_DONE : 0);
  }

  function toggleDone(id) {
    var item = findIn(getAll(), id);
    if (!item) return null;
    return setProgress(id, isDone(item) ? 0 : PROGRESS_DONE);
  }

  /* 编辑：text / deadline / noteId / priority / progress。id 与 createdAt 不在这里改 */
  function update(id, patch) {
    var list = getAll();
    var hit = null;

    list.forEach(function (item) {
      if (!item || item.id !== id) return;

      if (patch && typeof patch.text === 'string') {
        var text = patch.text.trim();
        if (text === '') return;            /* 不允许把内容清空 */
        item.text = text;
      }
      if (patch && typeof patch.deadline === 'string') item.deadline = patch.deadline;
      if (patch && typeof patch.noteId === 'string') item.noteId = patch.noteId;
      if (patch && typeof patch.priority === 'string') item.priority = normalizePriority(patch.priority);

      if (patch && patch.progress !== undefined) {
        var next = normalizeProgress(patch.progress);
        if (next !== null) {
          item.progress = next;
          item.done = next === PROGRESS_DONE;
        }
      }

      hit = item;
    });

    if (!hit) return null;
    saveAll(list);
    notify();
    return hit;
  }

  /* 列表行上点一下：高 → 中 → 低 → 高。写不进去就返回 null */
  function cyclePriority(id) {
    var list = getAll();
    var hit = null;

    list.forEach(function (item) {
      if (item && item.id === id) {
        item.priority = nextPriority(item.priority);
        hit = item;
      }
    });

    if (!hit) return null;
    if (!saveAll(list)) return null;
    notify();
    return hit;
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
  window.Workbench.todo = {
    BUCKETS: BUCKETS,
    PRIORITIES: PRIORITIES,
    PRIORITY_LABEL: PRIORITY_LABEL,
    PROGRESS_TICKS: PROGRESS_TICKS,
    PROGRESS_DONE: PROGRESS_DONE,
    getPriority: getPriority,
    nextPriority: nextPriority,
    getPercent: getPercent,
    isDone: isDone,
    normalizeProgress: normalizeProgress,
    getAll: getAll,
    getByBucket: getByBucket,
    getById: getById,
    getProgress: getProgress,
    deadlineText: deadlineText,
    formatCreatedAt: formatCreatedAt,
    add: add,
    update: update,
    cyclePriority: cyclePriority,
    setProgress: setProgress,
    applyTick: applyTick,
    toggleDone: toggleDone,
    setDone: setDone,
    remove: remove
  };
})();
