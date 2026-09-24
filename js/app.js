/* 个人工作台 · js/app.js
   职责只有三件：启动、左侧导航、看板刷新（外加待办页的界面绑定）。
   全站唯一的 init 在这里执行；其他模块只暴露函数，不得自行初始化。
   刷新入口：window.Workbench.app.refresh(module)，
   各模块数据变化后派发 'workbench:data-changed' 事件（detail.module 标明来源模块）即可触发重绘。 */
(function () {
  'use strict';

  var W = window.Workbench;
  var WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  var BUCKET_LABEL = { today: '本日', week: '本周', month: '本月' };

  /* 待办页的界面状态（只存在内存里，不属于业务数据） */
  var todoBucket = 'today';
  var selectedTodoId = null;

  /* 笔记页的界面状态 */
  var selectedNoteId = null;
  var noteFlashTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function show(el, visible) {
    if (!el) return;
    if (visible) el.removeAttribute('hidden');
    else el.setAttribute('hidden', 'hidden');
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function makeEmpty(text) {
    var p = document.createElement('p');
    p.className = 'empty';
    p.textContent = text;
    return p;
  }

  /* ---------- 顶部日期与问候 ---------- */

  function renderHeader() {
    var now = new Date();
    var hour = now.getHours();
    setText('dateYear', now.getFullYear());
    setText('dateMonth', (now.getMonth() + 1) + '月');
    setText('dateDay', now.getDate());
    setText('weekText', WEEK[now.getDay()]);
    setText('greetText', hour < 11 ? '早上好' : (hour < 18 ? '下午好' : '晚上好'));
  }

  /* ---------- 三张汇总卡 ---------- */

  function renderSummaryCards() {
    var all = W.todo.getProgress();
    var today = W.todo.getProgress('today');
    var week = W.todo.getProgress('week');
    var month = W.todo.getProgress('month');

    setText('boardTodoDone', all.done);
    setText('boardTodoTotal', all.total);
    setText('boardTodoNote', all.total === 0
      ? '还没有待办'
      : '本日 ' + today.done + '/' + today.total +
        ' · 本周 ' + week.done + '/' + week.total +
        ' · 本月 ' + month.done + '/' + month.total);

    var money = W.ledger.getSummary();
    setText('boardIncome', W.ledger.formatAmount(money.today.in));
    setText('boardExpense', W.ledger.formatAmount(money.today.out));
    setText('boardBalance', W.ledger.formatAmount(money.today.in - money.today.out));
    setText('boardWeekIn', W.ledger.formatAmount(money.week.in));
    setText('boardWeekOut', W.ledger.formatAmount(money.week.out));
    setText('boardMonthIn', W.ledger.formatAmount(money.month.in));
    setText('boardMonthOut', W.ledger.formatAmount(money.month.out));

    var habit = W.habits.getSummary();
    setText('boardHabitDone', habit.done);
    setText('boardHabitTotal', habit.total);
    setText('boardHabitNote', habit.items.length
      ? habit.items.map(function (it) {
          return it.label + ' ' + habitShortState(it);
        }).join(' · ')
      : '还没有打卡项');
  }

  /* 打卡的短状态文案：多次型显示 3/8，一次型显示已达标/未完成 */
  function habitShortState(item) {
    if (item.kind === 'once') return item.done ? '已达标' : '未完成';
    return item.value + '/' + item.target;
  }

  /* ---------- 看板下方两块面板 ---------- */

  function renderTodayPanel() {
    var host = $('boardTodayList');
    if (!host) return;

    var items = W.todo.getByBucket('today');
    var done = items.filter(function (item) { return W.todo.isDone(item); }).length;

    setText('boardTodayDone', done);
    setText('boardTodayTotal', items.length);

    clear(host);

    if (items.length === 0) {
      host.appendChild(makeEmpty('今天还没有待办。'));
      return;
    }

    var ul = document.createElement('ul');
    ul.className = 'task-list';

    items.forEach(function (item) {
      var li = document.createElement('li');
      if (W.todo.isDone(item)) li.className = 'is-done';

      var prio = document.createElement('span');
      var prioKey = W.todo.getPriority(item);
      prio.className = 'prio-dot prio-' + prioKey;
      prio.textContent = W.todo.PRIORITY_LABEL[prioKey];
      prio.title = '优先级：' + W.todo.PRIORITY_LABEL[prioKey];

      var box = document.createElement('span');
      box.className = 'box';

      var text = document.createElement('span');
      text.className = 'task-text';
      text.textContent = item.text;

      /* 进度条 + 百分比：和待办页的卡片同一个口径（PRD：一条待办 = 一个进度值） */
      var percent = W.todo.getPercent(item);
      var line = document.createElement('div');
      line.className = 'todo-mini';

      var bar = document.createElement('span');
      bar.className = 'todo-bar';
      var fill = document.createElement('i');
      fill.style.width = percent + '%';
      bar.appendChild(fill);

      var num = document.createElement('span');
      num.className = 'todo-percent num';
      num.textContent = percent + '%';

      line.appendChild(bar);
      line.appendChild(num);

      var deadline = document.createElement('span');
      deadline.className = 'task-time num';
      deadline.textContent = W.todo.deadlineText(item.deadline);

      li.appendChild(prio);
      li.appendChild(box);
      li.appendChild(text);
      li.appendChild(line);
      li.appendChild(deadline);
      ul.appendChild(li);
    });

    host.appendChild(ul);
  }

  function renderHabitPanel() {
    var host = $('boardHabitList');
    if (!host) return;

    var summary = W.habits.getSummary();

    setText('boardHabitMetaDone', summary.done);
    setText('boardHabitMetaTotal', summary.total);

    clear(host);

    /* 打卡项由用户自己增删，所以这里必须有空状态（AGENTS：每个模块都要有空状态） */
    if (summary.items.length === 0) {
      host.appendChild(makeEmpty('还没有打卡项。到「打卡」页添加一个。'));
      return;
    }

    var ul = document.createElement('ul');
    ul.className = 'check-list';

    summary.items.forEach(function (item) {
      var li = document.createElement('li');
      if (item.done) li.className = 'is-ok';

      var name = document.createElement('span');
      name.className = 'ck-name';
      name.textContent = item.label;

      var bar = document.createElement('span');
      bar.className = 'bar';
      var fill = document.createElement('i');
      var percent = item.target > 0 ? Math.round(item.value / item.target * 100) : 0;
      if (percent > 100) percent = 100;
      fill.style.width = percent + '%';
      bar.appendChild(fill);

      var val = document.createElement('span');
      val.className = 'ck-val num';
      val.textContent = habitShortState(item);

      li.appendChild(name);
      li.appendChild(bar);
      li.appendChild(val);
      ul.appendChild(li);
    });

    host.appendChild(ul);
  }

  /* ---------- 待办页 ---------- */

  function renderTodoTabs() {
    var tabs = document.querySelectorAll('#todoTabs .tab');
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].dataset.bucket === todoBucket) tabs[i].classList.add('is-active');
      else tabs[i].classList.remove('is-active');
    }
    setText('todoAddBucket', BUCKET_LABEL[todoBucket]);
  }

  /* ---------- 待办列表 ---------- */

  /* 上一次渲染时每条待办的完成状态。用来找出"这次状态翻转了"的卡片，
     给它一个淡入 —— 否则那张卡片看起来是凭空出现在新位置的 */
  var lastTodoDone = {};

  /* 点「完成」时整条会翻转、按排序要跳到已完成区。直接重排会让卡片"嗖"地飞走，
     用户容易以为自己点错了。所以：先把这张卡片原地更新（进度条 / 档位高亮 /
     完成样式立刻可见），700ms 后再整体重排，并给移动的卡片一个淡入。 */
  var todoReorderTimer = null;
  var todoListHold = false;

  function endTodoListHold() {
    window.clearTimeout(todoReorderTimer);
    todoListHold = false;
  }

  /* 只重画一张卡片，不动位置 */
  function refreshTodoCardNow(id) {
    var host = $('todoListPanel');
    if (!host) return;

    var old = host.querySelector('.todo-card[data-id="' + id + '"]');
    if (!old || !old.parentNode) return;

    var item = W.todo.getById(id);
    if (!item) return;

    old.parentNode.replaceChild(buildTodoCard(item), old);
  }

  /* 写进度时统一用它包一层。id 必须显式传进来 —— 在列表里点某张卡片的档位时，
     那条不一定是右栏选中的那条，用 selectedTodoId 会错位。
     ★ 为什么不能在写完之后再挂：数据层写完会立刻派发 data-changed → 刷新 → 重排，
       等它返回时卡片早就跳走了。所以**必须在写之前就把列表挂住**，
       写完再看完成状态有没有翻转：翻转了原地更新 + 700ms 后重排；没翻转就正常重排。 */
  function writeTodoWithHold(id, write) {
    todoListHold = true;
    var res = write();

    if (res && res.ok && res.flipped && id) {
      refreshTodoCardNow(id);
      window.clearTimeout(todoReorderTimer);
      todoReorderTimer = window.setTimeout(function () {
        todoListHold = false;
        renderTodoList();
        var card = document.querySelector('#todoListPanel .todo-card[data-id="' + id + '"]');
        if (card) card.classList.add('is-just-moved');
      }, 700);
    } else {
      endTodoListHold();
      renderTodoList();
    }

    return res;
  }

  /* ---------- 进度档位：卡片与详情区共用 ---------- */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* 动态建内联 SVG 图标。width/height/fill/stroke 必须逐个写属性 ——
     只靠 CSS 类的话，样式一旦没加载，图标会退化成 300×150 的纯黑块把布局撑烂。
     （AGENTS「静态资源与缓存」血泪条款） */
  function makeIcon(paths, size) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('aria-hidden', 'true');

    paths.forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  /* 把档位按钮填进容器：20% / 40% / 60% / 80% / 完成。
     当前档位高亮；再点当前档位 = 退回 0%（数据层 applyTick 负责反转） */
  function fillTickRow(row, item) {
    var current = W.todo.getPercent(item);

    W.todo.PROGRESS_TICKS.forEach(function (tick) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tick';
      btn.dataset.action = 'tick';
      btn.dataset.tick = String(tick);
      btn.textContent = tick + '%';
      btn.title = current === tick ? '再点一下退回 0%' : '推进到 ' + tick + '%';
      if (current === tick) btn.classList.add('is-current');
      row.appendChild(btn);
    });

    var reached = current === W.todo.PROGRESS_DONE;
    var doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'tick tick-done';
    doneBtn.dataset.action = 'tick';
    doneBtn.dataset.tick = String(W.todo.PROGRESS_DONE);
    doneBtn.title = reached ? '再点一下取消完成' : '标记为已完成（100%）';
    doneBtn.setAttribute('aria-label', doneBtn.title);
    if (reached) doneBtn.classList.add('is-current');
    doneBtn.appendChild(makeIcon(['M5 12.5l4.5 4.5L19 6.5'], 13));

    var doneText = document.createElement('span');
    doneText.textContent = '完成';
    doneBtn.appendChild(doneText);

    row.appendChild(doneBtn);
  }

  /* 一条待办 → 一张卡片。抽成函数是为了「整体重排」与「原地更新一张」共用同一段
     构建逻辑，避免两处各写一份、改一处漏一处。

     卡片三行：① 优先级 + 标题 + 截止日期 + 删除
               ② 进度条 + 百分比
               ③ 档位按钮（20/40/60/80/完成） */
  function buildTodoCard(item) {
    var li = document.createElement('li');
    li.className = 'todo-card';
    li.dataset.id = item.id;
    if (W.todo.isDone(item)) li.classList.add('is-done');
    if (item.id === selectedTodoId) li.classList.add('is-selected');

    var percent = W.todo.getPercent(item);

    /* ---------- ① 头部 ---------- */

    /* 优先级小标：点一下循环切换 高 → 中 → 低 */
    var prioKey = W.todo.getPriority(item);
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'todo-priority prio-' + prioKey;
    chip.dataset.action = 'priority';
    chip.textContent = W.todo.PRIORITY_LABEL[prioKey];
    chip.title = '优先级：' + W.todo.PRIORITY_LABEL[prioKey] + '。点一下切换（高 → 中 → 低）';
    chip.setAttribute('aria-label', chip.title);

    var text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = item.text;

    var deadline = document.createElement('span');
    deadline.className = 'todo-deadline';
    var label = W.todo.deadlineText(item.deadline);
    deadline.textContent = label;
    if (!item.deadline) deadline.classList.add('is-none');
    else if (label === '今天到期') deadline.classList.add('is-today');
    else if (label.indexOf('已过期') === 0) deadline.classList.add('is-overdue');

    /* 删除做成图标（和参考图一致），但 aria-label 与 title 必须有，否则读屏和
       悬停都认不出这是什么按钮 */
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'todo-del';
    del.dataset.action = 'delete';
    del.title = '删除这条待办';
    del.setAttribute('aria-label', '删除这条待办');
    del.appendChild(makeIcon(['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 13h10l1-13'], 15));

    var head = document.createElement('div');
    head.className = 'todo-card-head';
    head.appendChild(chip);
    head.appendChild(text);
    head.appendChild(deadline);
    head.appendChild(del);

    /* ---------- ② 进度条 + 百分比 ---------- */

    var line = document.createElement('div');
    line.className = 'todo-card-bar';

    var bar = document.createElement('span');
    bar.className = 'todo-bar';
    var fill = document.createElement('i');
    fill.style.width = percent + '%';
    bar.appendChild(fill);

    var num = document.createElement('span');
    num.className = 'todo-percent num';
    num.textContent = percent + '%';

    line.appendChild(bar);
    line.appendChild(num);

    /* ---------- ③ 档位 ---------- */

    var ticks = document.createElement('div');
    ticks.className = 'tick-row';
    fillTickRow(ticks, item);

    li.appendChild(head);
    li.appendChild(line);
    li.appendChild(ticks);

    return li;
  }

  function renderTodoList() {
    var host = $('todoListPanel');
    if (!host) return;

    var items = W.todo.getByBucket(todoBucket);
    var done = items.filter(function (item) { return W.todo.isDone(item); }).length;

    var meta = $('todoListMeta');
    if (meta) {
      clear(meta);
      var d = document.createElement('span');
      d.className = 'num';
      d.textContent = done;
      var t = document.createElement('span');
      t.className = 'num';
      t.textContent = items.length;
      meta.appendChild(d);
      meta.appendChild(document.createTextNode(' / '));
      meta.appendChild(t);
    }

    clear(host);

    if (items.length === 0) {
      host.appendChild(makeEmpty('「' + BUCKET_LABEL[todoBucket] + '」还没有待办。'));
      lastTodoDone = {};
      return;
    }

    var ul = document.createElement('ul');
    ul.className = 'todo-list';
    var nextDone = {};

    items.forEach(function (item) {
      var li = buildTodoCard(item);

      /* 完成状态翻转过的卡片（点了「完成」/ 取消完成）标一下，让它淡入到新位置 */
      var was = lastTodoDone[item.id];
      var now = W.todo.isDone(item);
      if (was !== undefined && was !== now) li.classList.add('is-moved');

      nextDone[item.id] = now;
      ul.appendChild(li);
    });

    host.appendChild(ul);
    lastTodoDone = nextDone;
  }

  function fillNoteSelect(item) {
    var select = $('todoNote');
    if (!select) return;

    clear(select);

    var none = document.createElement('option');
    none.value = '';
    none.textContent = '不关联笔记';
    select.appendChild(none);

    var notes = W.notes.getAll();
    var linked = item.noteId || '';
    var linkedExists = false;

    notes.forEach(function (note) {
      var opt = document.createElement('option');
      opt.value = note.id;
      var body = typeof note.body === 'string' ? note.body : '';
      var label = body === '' ? '(空笔记)' : body.slice(0, 24);
      opt.textContent = typeof note.cause === 'string' && note.cause !== ''
        ? note.cause + ' · ' + label
        : label;
      select.appendChild(opt);
      if (note.id === linked) linkedExists = true;
    });

    if (notes.length === 0) {
      var tip = document.createElement('option');
      tip.value = '';
      tip.disabled = true;
      tip.textContent = '（还没有笔记）';
      select.appendChild(tip);
    }

    /* 笔记已被删除：保留待办原有的 noteId，并明确提示，不静默清空 */
    if (linked !== '' && !linkedExists) {
      var gone = document.createElement('option');
      gone.value = linked;
      gone.textContent = '原笔记已删';
      select.appendChild(gone);
      select.value = linked;
      setText('todoNoteHint', '原笔记已删。关联信息仍保留，可改选其他笔记或选「不关联笔记」。');
    } else {
      select.value = linked;
      setText('todoNoteHint', '');
    }
  }

  /* 优先级下拉：选项固定三项，当前值取不到就落到「中」 */
  function fillPrioritySelect(current) {
    var select = $('todoPriority');
    if (!select) return;

    clear(select);

    W.todo.PRIORITIES.forEach(function (key) {
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = W.todo.PRIORITY_LABEL[key];
      select.appendChild(opt);
    });

    select.value = W.todo.getPriority({ priority: current });
  }

  function renderTodoDetail() {
    var item = selectedTodoId ? W.todo.getById(selectedTodoId) : null;

    if (!item) {
      selectedTodoId = null;
      setText('todoDetailMeta', '未选择');
      show($('todoDetailEmpty'), true);
      show($('todoForm'), false);
      return;
    }

    show($('todoDetailEmpty'), false);
    show($('todoForm'), true);

    var percent = W.todo.getPercent(item);
    setText('todoDetailMeta', percent === W.todo.PROGRESS_DONE ? '已完成' : '进行中 · ' + percent + '%');
    setText('todoSaveHint', '');

    $('todoText').value = item.text;
    $('todoDeadline').value = item.deadline || '';
    setText('todoDeadlineHint', W.todo.deadlineText(item.deadline));
    setText('todoCreated', W.todo.formatCreatedAt(item.createdAt));
    fillPrioritySelect(item.priority);

    /* 进度档位：和卡片共用同一套按钮，保证两处长得一样、行为一样 */
    var tickHost = $('todoTicks');
    if (tickHost) {
      clear(tickHost);
      fillTickRow(tickHost, item);
    }

    fillNoteSelect(item);
    /* 只有关联的笔记确实存在时，「查看笔记」才有意义 */
    show($('todoNoteBtn'), !!(item.noteId && W.notes.getById(item.noteId)));
  }

  function renderTodoPage() {
    renderTodoTabs();
    /* 挂住期间不重排列表：留给用户看清刚才那一下，稍后由 holdTodoListReorder 收尾 */
    if (!todoListHold) renderTodoList();
    renderTodoDetail();
  }

  function selectTodo(id) {
    selectedTodoId = id;
    renderTodoList();
    renderTodoDetail();
  }

  /* ---------- 待办页事件绑定（只在启动时绑一次） ---------- */

  function bindTodoUI() {
    var tabs = $('todoTabs');
    if (tabs) {
      tabs.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.tab') : null;
        if (!btn) return;
        todoBucket = btn.dataset.bucket;
        renderTodoPage();
      });
    }

    var form = $('todoAddForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = $('todoInput');
        var text = input.value;

        if (text.trim() === '') {       /* 空字符串或只有空格：不添加 */
          input.value = '';
          input.focus();
          return;
        }

        /* 新增是明确动作，别让"等会儿再重排"把它也挂住 */
        endTodoListHold();

        var created = W.todo.add({ text: text, bucket: todoBucket });
        input.value = '';
        input.focus();
        if (created) selectTodo(created.id);
      });
    }
    /* 档位按钮在两处出现（列表卡片、右栏详情），共用这一个处理函数 ——
       两处各写一份迟早会长歪，行为必须完全一致 */
    function handleTick(id, tick) {
      if (!id) return;

      var res = writeTodoWithHold(id, function () {
        return W.todo.applyTick(id, tick);
      });

      if (res && res.ok) return;

      /* 只有写入失败才提示；数据层没写进去，界面也不该动 */
      if (res && res.message) setText('todoSaveHint', res.message);
    }

    var listHost = $('todoListPanel');
    if (listHost) {
      listHost.addEventListener('click', function (e) {
        var li = e.target.closest ? e.target.closest('.todo-card') : null;
        if (!li) return;

        var id = li.dataset.id;
        var action = e.target.closest ? e.target.closest('[data-action]') : null;

        if (action && action.dataset.action === 'tick') {
          handleTick(id, action.dataset.tick);
          return;
        }

        if (action && action.dataset.action === 'priority') {
          W.todo.cyclePriority(id);   /* 写入后会派发事件，由统一刷新入口重绘 */
          return;
        }

        if (action && action.dataset.action === 'delete') {
          if (window.confirm('删除这条待办？删除后无法恢复。')) {
            W.todo.remove(id);
            if (selectedTodoId === id) selectedTodoId = null;
            renderTodoPage();
          }
          return;
        }

        selectTodo(id);
      });
    }

    /* 详情区的档位按钮 */
    var detailTicks = $('todoTicks');
    if (detailTicks) {
      detailTicks.addEventListener('click', function (e) {
        if (!selectedTodoId) return;

        var btn = e.target.closest ? e.target.closest('[data-action="tick"]') : null;
        if (!btn) return;

        handleTick(selectedTodoId, btn.dataset.tick);
      });
    }

    var deadline = $('todoDeadline');
    if (deadline) {
      deadline.addEventListener('change', function () {
        if (!selectedTodoId) return;
        setText('todoDeadlineHint', W.todo.deadlineText(deadline.value));
      });
    }

    var saveBtn = $('todoSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (!selectedTodoId) return;

        var text = $('todoText').value;
        if (text.trim() === '') {
          setText('todoSaveHint', '内容不能为空，未保存。');
          return;
        }

        W.todo.update(selectedTodoId, {
          text: text,
          deadline: $('todoDeadline').value,
          noteId: $('todoNote').value,
          priority: $('todoPriority').value
        });

        renderTodoPage();
        setText('todoSaveHint', '已保存。');
      });
    }

    var noteBtn = $('todoNoteBtn');
    if (noteBtn) {
      noteBtn.addEventListener('click', function () {
        if (!selectedTodoId) return;
        var item = W.todo.getById(selectedTodoId);
        if (!item || !item.noteId) return;
        openNote(item.noteId);   /* 走统一导航，并高亮目标笔记 */
      });
    }

    var deleteBtn = $('todoDeleteBtn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        if (!selectedTodoId) return;
        if (window.confirm('删除这条待办？删除后无法恢复。')) {
          W.todo.remove(selectedTodoId);
          selectedTodoId = null;
          renderTodoPage();
        }
      });
    }
  }

  /* ---------- 笔记页 ---------- */

  function renderNoteList() {
    var host = $('noteListPanel');
    if (!host) return;

    var notes = W.notes.getList();

    var meta = $('noteListMeta');
    if (meta) {
      clear(meta);
      var n = document.createElement('span');
      n.className = 'num';
      n.textContent = notes.length;
      meta.appendChild(n);
      meta.appendChild(document.createTextNode(' 条'));
    }

    clear(host);

    if (notes.length === 0) {
      host.appendChild(makeEmpty('还没有笔记。写完点提交试试。'));
      return;
    }

    var ul = document.createElement('ul');
    ul.className = 'note-list';

    notes.forEach(function (note) {
      var li = document.createElement('li');
      li.className = 'note-item';
      li.dataset.id = note.id;
      if (note.id === selectedNoteId) li.classList.add('is-selected');

      var main = document.createElement('div');
      main.className = 'note-item-main';

      if (typeof note.cause === 'string' && note.cause !== '') {
        var cause = document.createElement('span');
        cause.className = 'note-item-cause';
        cause.textContent = note.cause;
        main.appendChild(cause);
      }

      var body = document.createElement('span');
      body.className = 'note-item-text';
      body.textContent = note.body;

      var time = document.createElement('span');
      time.className = 'note-item-time';
      time.textContent = W.notes.formatCreatedAt(note.createdAt);

      main.appendChild(body);
      li.appendChild(main);
      li.appendChild(time);
      ul.appendChild(li);
    });

    host.appendChild(ul);
  }

  function renderNoteDetail() {
    var note = selectedNoteId ? W.notes.getById(selectedNoteId) : null;

    if (!note) {
      selectedNoteId = null;
      setText('noteDetailMeta', '未选择');
      show($('noteDetailEmpty'), true);
      show($('noteDetail'), false);
      return;
    }

    show($('noteDetailEmpty'), false);
    show($('noteDetail'), true);

    setText('noteDetailMeta', '已提交');
    setText('noteDetailCause', note.cause ? note.cause : '未填');
    setText('noteDetailBody', note.body);
    setText('noteDetailTime', W.notes.formatCreatedAt(note.createdAt));
  }

  function renderNotesPage() {
    renderNoteList();
    renderNoteDetail();
  }

  /* 供待办「查看笔记」等处跳转使用：走统一导航，并高亮目标笔记 */
  function openNote(noteId) {
    if (!noteId || !W.notes.getById(noteId)) return false;
    selectedNoteId = noteId;
    goToPage('note');
    renderNotesPage();

    var row = document.querySelector('.note-item[data-id="' + noteId + '"]');
    if (row) {
      row.classList.add('is-highlight');
      if (typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'nearest' });
      }
      if (noteFlashTimer) window.clearTimeout(noteFlashTimer);
      noteFlashTimer = window.setTimeout(function () {
        row.classList.remove('is-highlight');
        noteFlashTimer = null;
      }, 1600);
    }
    return true;
  }

  /* ---------- 笔记页事件绑定（只在启动时绑一次） ---------- */

  function bindNoteUI() {
    var form = $('noteForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();

        var bodyEl = $('noteBody');
        var causeEl = $('noteCause');

        /* 内容必填；只有空格或换行也不提交 */
        if (bodyEl.value.trim() === '') {
          setText('noteHint', '内容不能为空，未提交。');
          bodyEl.focus();
          return;
        }

        var created = W.notes.add({ cause: causeEl.value, body: bodyEl.value });
        if (!created) {
          setText('noteHint', '保存失败，内容已保留在输入框里，请检查浏览器存储是否可用。');
          return;
        }

        /* 提交成功后才清空输入区 */
        causeEl.value = '';
        bodyEl.value = '';
        setText('noteHint', '已提交。');
        selectedNoteId = created.id;
        renderNotesPage();
        causeEl.focus();
      });
    }

    var listHost = $('noteListPanel');
    if (listHost) {
      listHost.addEventListener('click', function (e) {
        var li = e.target.closest ? e.target.closest('.note-item') : null;
        if (!li) return;
        selectedNoteId = li.dataset.id;
        renderNotesPage();
      });
    }

    var deleteBtn = $('noteDeleteBtn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        if (!selectedNoteId) return;
        if (window.confirm('删除这条笔记？删除后无法恢复，已关联它的待办会显示「原笔记已删」。')) {
          W.notes.remove(selectedNoteId);
          selectedNoteId = null;
          renderNotesPage();
        }
      });
    }
  }

  /* ---------- 快捷入口页 ---------- */

  function renderSiteList() {
    var host = $('siteListPanel');
    if (!host) return;

    var sites = W.links.getSites();

    var meta = $('siteCount');
    if (meta) {
      clear(meta);
      var n = document.createElement('span');
      n.className = 'num';
      n.textContent = sites.length;
      meta.appendChild(n);
      meta.appendChild(document.createTextNode(' 个'));
    }

    clear(host);

    if (sites.length === 0) {
      host.appendChild(makeEmpty('还没有常用网站。上面可以添加。'));
      return;
    }

    var ul = document.createElement('ul');
    ul.className = 'item-list';

    sites.forEach(function (site) {
      var li = document.createElement('li');
      li.className = 'item-row';
      li.dataset.id = site.id;

      var link = document.createElement('a');
      link.className = 'item-name site-link';
      link.href = site.url;
      link.target = '_blank';
      link.rel = 'noopener';                 /* 新窗口打开必须带 noopener */
      link.textContent = site.name;

      var hostname = document.createElement('span');
      hostname.className = 'item-sub';
      hostname.textContent = W.links.siteHost(site.url);

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'item-del';
      del.dataset.action = 'delete';
      del.textContent = '删除';

      li.appendChild(link);
      li.appendChild(hostname);
      li.appendChild(del);
      ul.appendChild(li);
    });

    host.appendChild(ul);
  }

  function renderSnippetList() {
    var host = $('snippetListPanel');
    if (!host) return;

    var snippets = W.links.getSnippets();

    var meta = $('snippetCount');
    if (meta) {
      clear(meta);
      var n = document.createElement('span');
      n.className = 'num';
      n.textContent = snippets.length;
      meta.appendChild(n);
      meta.appendChild(document.createTextNode(' 条'));
    }

    clear(host);

    if (snippets.length === 0) {
      host.appendChild(makeEmpty('还没有常用文本。上面可以添加。'));
      return;
    }

    var ul = document.createElement('ul');
    ul.className = 'item-list';

    snippets.forEach(function (snippet) {
      var li = document.createElement('li');
      li.className = 'item-row';
      li.dataset.id = snippet.id;

      var name = document.createElement('span');
      name.className = 'item-name';
      name.textContent = snippet.name;

      var text = document.createElement('span');
      text.className = 'item-sub';
      text.textContent = snippet.text;

      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'item-act';
      copyBtn.dataset.action = 'copy';
      copyBtn.textContent = '复制';

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'item-del';
      del.dataset.action = 'delete';
      del.textContent = '删除';

      li.appendChild(name);
      li.appendChild(text);
      li.appendChild(copyBtn);
      li.appendChild(del);
      ul.appendChild(li);
    });

    host.appendChild(ul);
  }

  function renderLinksPage() {
    renderSiteList();
    renderSnippetList();
  }

  /* ---------- 复制到剪贴板：优先 clipboard API，失败走兜底 ---------- */

  /* 兜底：临时 textarea + execCommand，用完立即移除 */
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);

    var done = false;
    try {
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      done = document.execCommand('copy');
    } catch (err) {
      done = false;
    }

    document.body.removeChild(ta);
    return { ok: !!done, how: 'legacy' };
  }

  function copyToClipboard(text) {
    return new Promise(function (resolve) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(function () {
          resolve({ ok: true, how: 'clipboard' });
        }).catch(function () {
          resolve(legacyCopy(text));
        });
        return;
      }
      resolve(legacyCopy(text));
    });
  }

  function showCopyFallback(text) {
    var box = $('copyFallback');
    var body = $('copyFallbackBody');
    if (!box || !body) return;
    body.textContent = text;
    show(box, true);
  }

  function hideCopyFallback() {
    var box = $('copyFallback');
    var body = $('copyFallbackBody');
    if (body) body.textContent = '';
    show(box, false);
  }

  /* ---------- 快捷入口页事件绑定（只在启动时绑一次） ---------- */

  function bindLinksUI() {
    var siteForm = $('siteForm');
    if (siteForm) {
      siteForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var nameEl = $('siteName');
        var urlEl = $('siteUrl');

        var result = W.links.addSite({ name: nameEl.value, url: urlEl.value });
        if (!result.ok) {
          setText('siteHint', result.message);
          return;
        }

        nameEl.value = '';
        urlEl.value = '';
        setText('siteHint', '已添加：' + result.item.name + '（' + W.links.siteHost(result.item.url) + '）');
        renderLinksPage();
        nameEl.focus();
      });
    }

    var siteList = $('siteListPanel');
    if (siteList) {
      siteList.addEventListener('click', function (e) {
        var del = e.target.closest ? e.target.closest('[data-action="delete"]') : null;
        if (!del) return;
        var row = del.closest('.item-row');
        if (!row) return;
        if (window.confirm('删除这个快捷入口？删除后无法恢复。')) {
          W.links.removeSite(row.dataset.id);
          renderLinksPage();
        }
      });
    }

    var snippetForm = $('snippetForm');
    if (snippetForm) {
      snippetForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var nameEl = $('snippetName');
        var textEl = $('snippetText');

        var result = W.links.addSnippet({ name: nameEl.value, text: textEl.value });
        if (!result.ok) {
          setText('snippetHint', result.message);
          return;
        }

        nameEl.value = '';
        textEl.value = '';
        setText('snippetHint', '已添加：' + result.item.name);
        renderLinksPage();
        nameEl.focus();
      });
    }

    var snippetList = $('snippetListPanel');
    if (snippetList) {
      snippetList.addEventListener('click', function (e) {
        var row = e.target.closest ? e.target.closest('.item-row') : null;
        if (!row) return;
        var action = e.target.closest ? e.target.closest('[data-action]') : null;
        if (!action) return;

        var id = row.dataset.id;
        var list = W.links.getSnippets();
        var hit = null;
        list.forEach(function (item) { if (item.id === id) hit = item; });
        if (!hit) return;

        if (action.dataset.action === 'copy') {
          copyToClipboard(hit.text).then(function (res) {
            if (res.ok) {
              hideCopyFallback();
              setText('snippetHint', '已复制：' + hit.name);
            } else {
              setText('snippetHint', '复制失败，请手动选中下方内容复制。');
              showCopyFallback(hit.text);
            }
          });
          return;
        }

        if (action.dataset.action === 'delete') {
          if (window.confirm('删除这条常用文本？删除后无法恢复。')) {
            W.links.removeSnippet(id);
            hideCopyFallback();
            renderLinksPage();
          }
        }
      });
    }
  }

  /* ---------- 打卡页 ---------- */

  function habitBucketText(item) {
    if (item.period === 'week') return '本周（周一起 ' + item.bucket + '）';
    return '今日（' + item.bucket + '）';
  }

  function setHabitCardMessage(card, text) {
    var meta = card.querySelector('.habit-meta');
    if (meta) meta.textContent = text;
  }

  function renderHabitsPage() {
    var host = $('habitGrid');
    if (!host) return;

    clear(host);

    var list = W.habits.getAllProgress();

    if (list.length === 0) {
      host.appendChild(makeEmpty('还没有打卡项。在上面填个名字，点「添加」试试。'));
      return;
    }

    list.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'habit-card';
      card.dataset.key = item.key;
      if (item.done) card.classList.add('is-done');

      /* 标题直接做成可编辑的输入框：改完失焦（或按回车）即保存 */
      var head = document.createElement('div');
      head.className = 'habit-head';

      var titleInput = document.createElement('input');
      titleInput.className = 'habit-title-input';
      titleInput.type = 'text';
      titleInput.maxLength = W.habits.LABEL_MAX;
      titleInput.value = item.label;
      titleInput.dataset.role = 'label';
      titleInput.setAttribute('aria-label', '打卡项名称');

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'habit-del';
      delBtn.dataset.action = 'remove';
      delBtn.textContent = '删除';

      head.appendChild(titleInput);
      head.appendChild(delBtn);

      /* 数值：多次型 3 / 8，一次型 已完成 / 未完成 */
      var stat = document.createElement('div');
      stat.className = 'habit-stat';

      var valueEl = document.createElement('span');
      valueEl.className = 'num habit-value';
      valueEl.textContent = item.kind === 'once'
        ? (item.done ? '已完成' : '未完成')
        : String(item.value);
      stat.appendChild(valueEl);

      if (item.kind === 'count') {
        var sep = document.createElement('span');
        sep.className = 'habit-sep';
        sep.textContent = '/';

        var targetEl = document.createElement('span');
        targetEl.className = 'num habit-target-text';
        targetEl.textContent = String(item.target);

        stat.appendChild(sep);
        stat.appendChild(targetEl);
      }

      /* 进度条 */
      var bar = document.createElement('div');
      bar.className = 'habit-bar';
      var fill = document.createElement('i');
      var percent = item.target > 0 ? Math.round(item.value / item.target * 100) : 0;
      if (percent > 100) percent = 100;
      fill.style.width = percent + '%';
      bar.appendChild(fill);

      /* 按钮 + 状态 */
      var actions = document.createElement('div');
      actions.className = 'habit-actions';

      var bumpBtn = document.createElement('button');
      bumpBtn.type = 'button';
      bumpBtn.className = 'btn-primary habit-bump';
      bumpBtn.dataset.action = 'bump';
      bumpBtn.textContent = item.done ? '已达标' : (item.kind === 'once' ? '完成' : '+1');
      if (item.done) bumpBtn.disabled = true;      /* 达标后停止继续增加 */

      /* −1：用来纠错（误点 +1），一次型达标时减 1 就是撤销完成。
         当前是 0 就没得减，直接禁用，点不动比点完弹提示更清爽 */
      var downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'btn-plain habit-down';
      downBtn.dataset.action = 'down';
      downBtn.textContent = '−1';
      downBtn.title = item.kind === 'once' ? '撤销这次打卡' : '减一次';
      downBtn.setAttribute('aria-label', downBtn.title);
      if (item.value <= 0) downBtn.disabled = true;

      var state = document.createElement('span');
      state.className = 'habit-state';
      state.textContent = item.done ? '已达标' : '未达标';

      actions.appendChild(bumpBtn);
      actions.appendChild(downBtn);
      actions.appendChild(state);

      /* 设置：类型 + 周期 + 目标次数（一次型不给改目标） */
      var setting = document.createElement('div');
      setting.className = 'habit-setting';

      var kindField = document.createElement('label');
      kindField.className = 'habit-field';

      var kindText = document.createElement('span');
      kindText.className = 'habit-field-label';
      kindText.textContent = '类型';

      var kindSelect = document.createElement('select');
      kindSelect.className = 'habit-select';
      kindSelect.dataset.role = 'kind';
      W.habits.KINDS.forEach(function (kind) {
        var opt = document.createElement('option');
        opt.value = kind;
        opt.textContent = W.habits.KIND_LABEL[kind];
        kindSelect.appendChild(opt);
      });
      kindSelect.value = item.kind;

      kindField.appendChild(kindText);
      kindField.appendChild(kindSelect);
      setting.appendChild(kindField);

      var periodField = document.createElement('label');
      periodField.className = 'habit-field';

      var periodText = document.createElement('span');
      periodText.className = 'habit-field-label';
      periodText.textContent = '周期';

      var periodSelect = document.createElement('select');
      periodSelect.className = 'habit-select';
      periodSelect.dataset.role = 'period';
      W.habits.PERIODS.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p;
        opt.textContent = W.habits.PERIOD_LABEL[p];
        periodSelect.appendChild(opt);
      });
      periodSelect.value = item.period;

      periodField.appendChild(periodText);
      periodField.appendChild(periodSelect);
      setting.appendChild(periodField);

      if (item.kind === 'count') {
        var targetField = document.createElement('label');
        targetField.className = 'habit-field';

        var targetText = document.createElement('span');
        targetText.className = 'habit-field-label';
        targetText.textContent = '目标次数';

        var targetInput = document.createElement('input');
        targetInput.className = 'habit-input num';
        targetInput.type = 'number';
        targetInput.min = '1';
        targetInput.step = '1';
        targetInput.value = String(item.target);
        targetInput.dataset.role = 'target';

        targetField.appendChild(targetText);
        targetField.appendChild(targetInput);
        setting.appendChild(targetField);
      } else {
        var fixed = document.createElement('span');
        fixed.className = 'habit-field-label';
        fixed.textContent = '一次型：目标固定为 1，点一下即完成';
        setting.appendChild(fixed);
      }

      /* 当前周期 */
      var meta = document.createElement('div');
      meta.className = 'habit-meta';
      meta.textContent = habitBucketText(item);

      card.appendChild(head);
      card.appendChild(stat);
      card.appendChild(bar);
      card.appendChild(actions);
      card.appendChild(setting);
      card.appendChild(meta);
      host.appendChild(card);
    });
  }

  /* ---------- 打卡页事件绑定（只在启动时绑一次） ---------- */

  /* 新增表单里的两个下拉，选项由数据层给，避免两边各写一份 */
  function renderHabitAddOptions() {
    var kindSel = $('habitKind');
    var periodSel = $('habitPeriod');

    if (kindSel && kindSel.options.length === 0) {
      W.habits.KINDS.forEach(function (kind) {
        var opt = document.createElement('option');
        opt.value = kind;
        opt.textContent = W.habits.KIND_LABEL[kind];
        kindSel.appendChild(opt);
      });
    }

    if (periodSel && periodSel.options.length === 0) {
      W.habits.PERIODS.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p;
        opt.textContent = W.habits.PERIOD_LABEL[p];
        periodSel.appendChild(opt);
      });
    }

    syncHabitTargetInput();
  }

  /* 一次型的目标固定为 1，所以把输入框禁掉，免得用户以为能改 */
  function syncHabitTargetInput() {
    var kindSel = $('habitKind');
    var target = $('habitTarget');
    if (!kindSel || !target) return;

    var once = kindSel.value === 'once';
    target.disabled = once;
    if (once) target.value = '1';
  }

  function bindHabitAddForm() {
    renderHabitAddOptions();

    var form = $('habitAddForm');
    if (!form) return;

    var kindSel = $('habitKind');
    if (kindSel) kindSel.addEventListener('change', syncHabitTargetInput);

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var nameEl = $('habitName');
      var periodEl = $('habitPeriod');
      var targetEl = $('habitTarget');

      var result = W.habits.addHabit({
        label: nameEl ? nameEl.value : '',
        kind: kindSel ? kindSel.value : 'count',
        period: periodEl ? periodEl.value : 'day',
        target: targetEl ? targetEl.value : 1
      });

      if (!result.ok) {
        setText('habitAddHint', result.message);
        return;
      }

      if (nameEl) nameEl.value = '';
      if (targetEl) targetEl.value = '1';
      setText('habitAddHint', '已添加「' + result.item.label + '」。');
    });
  }

  function bindHabitsUI() {
    var grid = $('habitGrid');
    if (!grid) return;

    grid.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!btn) return;

      var card = btn.closest('.habit-card');
      if (!card) return;

      var id = card.dataset.key;

      if (btn.dataset.action === 'remove') {
        var progress = W.habits.getProgress(id);
        var label = progress ? progress.label : '这个打卡项';
        var n = W.habits.countRecords(id);
        var tail = n > 0
          ? '它会连同 ' + n + ' 个周期的记录一起删除。'
          : '它还没有任何记录。';

        /* 删除是不可恢复的，按项目惯例二次确认，并且把"会删掉多少"讲清楚 */
        if (!window.confirm('删除「' + label + '」？' + tail + '删除后无法恢复。')) return;

        var removed = W.habits.removeHabit(id);
        if (!removed.ok) setHabitCardMessage(card, removed.message);
        return;
      }

      if (btn.dataset.action === 'bump') {
        var result = W.habits.bump(id);
        if (!result.changed && result.message) setHabitCardMessage(card, result.message);
        return;
      }

      if (btn.dataset.action === 'down') {
        var dec = W.habits.unbump(id);
        if (!dec.changed && dec.message) setHabitCardMessage(card, dec.message);
      }
    });

    grid.addEventListener('change', function (e) {
      var el = e.target;
      if (!el || !el.dataset || !el.dataset.role) return;

      var card = el.closest ? el.closest('.habit-card') : null;
      if (!card) return;

      var id = card.dataset.key;
      var res = null;

      if (el.dataset.role === 'label') {
        res = W.habits.updateHabit(id, { label: el.value });
        if (!res.ok) {
          /* 名字不能空：把输入框退回原值，并说明原因 */
          setHabitCardMessage(card, res.message);
          var current = W.habits.getProgress(id);
          if (current) el.value = current.label;
        }
        return;
      }

      if (el.dataset.role === 'kind') {
        res = W.habits.updateHabit(id, { kind: el.value });
        if (!res.ok) setHabitCardMessage(card, res.message);
        return;
      }

      if (el.dataset.role === 'period') {
        res = W.habits.setPeriod(id, el.value);
        if (!res.ok) setHabitCardMessage(card, res.message);
        return;
      }

      if (el.dataset.role === 'target') {
        res = W.habits.setTarget(id, el.value);
        if (!res.ok) {
          setHabitCardMessage(card, res.message);
          var cur = W.habits.getProgress(id);
          if (cur) el.value = String(cur.target);   /* 回退到有效值 */
        }
      }
    });
  }

  /* ---------- 记账页 ---------- */

  /* 分类下拉随类型变化 */
  function renderLedgerCategories() {
    var typeEl = $('ledgerType');
    var catEl = $('ledgerCategory');
    if (!typeEl || !catEl) return;

    var type = W.ledger.TYPES.indexOf(typeEl.value) !== -1 ? typeEl.value : 'out';
    var list = W.ledger.CATEGORIES[type];
    var current = catEl.value;

    clear(catEl);
    list.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      catEl.appendChild(opt);
    });

    /* 原来选中的分类在新类型里还有就保留，否则回到第一个 */
    catEl.value = list.indexOf(current) !== -1 ? current : list[0];
  }

  function renderLedgerFigures() {
    var money = W.ledger.getSummary();
    setText('ledgerTodayIn', W.ledger.formatAmount(money.today.in));
    setText('ledgerTodayOut', W.ledger.formatAmount(money.today.out));
    setText('ledgerWeekIn', W.ledger.formatAmount(money.week.in));
    setText('ledgerWeekOut', W.ledger.formatAmount(money.week.out));
    setText('ledgerMonthIn', W.ledger.formatAmount(money.month.in));
    setText('ledgerMonthOut', W.ledger.formatAmount(money.month.out));
  }

  function renderLedgerList() {
    var host = $('ledgerListPanel');
    if (!host) return;

    var items = W.ledger.getList();

    var meta = $('ledgerCount');
    if (meta) {
      clear(meta);
      var n = document.createElement('span');
      n.className = 'num';
      n.textContent = items.length;
      meta.appendChild(n);
      meta.appendChild(document.createTextNode(' 笔'));
    }

    clear(host);

    if (items.length === 0) {
      host.appendChild(makeEmpty('还没有记账记录。上面记一笔试试。'));
      return;
    }

    var ul = document.createElement('ul');
    ul.className = 'ledger-list';

    items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'ledger-item';
      li.dataset.id = item.id;

      var tag = document.createElement('span');
      tag.className = 'ledger-tag ' + (item.type === 'in' ? 'is-in' : 'is-out');
      tag.textContent = W.ledger.TYPE_LABEL[item.type] || '—';

      var amount = document.createElement('span');
      amount.className = 'num ledger-amount-text ' + (item.type === 'in' ? 'amount-in' : 'amount-out');
      amount.textContent = W.ledger.formatAmount(item.amount);

      var category = document.createElement('span');
      category.className = 'ledger-category';
      category.textContent = item.category;

      var note = document.createElement('span');
      note.className = 'ledger-note-text';
      note.textContent = item.note ? item.note : '';

      var time = document.createElement('span');
      time.className = 'num ledger-time';
      time.textContent = W.ledger.formatCreatedAt(item.createdAt);

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'item-del';
      del.dataset.action = 'delete';
      del.textContent = '删除';

      li.appendChild(tag);
      li.appendChild(amount);
      li.appendChild(category);
      li.appendChild(note);
      li.appendChild(time);
      li.appendChild(del);
      ul.appendChild(li);
    });

    host.appendChild(ul);
  }

  function renderLedgerPage() {
    renderLedgerCategories();
    renderLedgerFigures();
    renderLedgerList();
  }

  /* ---------- 记账页事件绑定（只在启动时绑一次） ---------- */

  function bindLedgerUI() {
    var typeEl = $('ledgerType');
    if (typeEl) {
      typeEl.addEventListener('change', function () {
        renderLedgerCategories();
        setText('ledgerHint', '金额要大于 0、最多两位小数；分类必填，备注选填。');
      });
    }

    var form = $('ledgerForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();

        var result = W.ledger.add({
          type: $('ledgerType').value,
          category: $('ledgerCategory').value,
          amount: $('ledgerAmount').value,
          note: $('ledgerNote').value
        });

        if (!result.ok) {
          setText('ledgerHint', result.message);
          return;
        }

        var label = W.ledger.TYPE_LABEL[result.item.type];
        $('ledgerAmount').value = '';
        $('ledgerNote').value = '';
        setText('ledgerHint', '已记一笔：' + label + ' ' +
          W.ledger.formatAmount(result.item.amount) + ' 元（' + result.item.category + '）');
        renderLedgerPage();
        $('ledgerAmount').focus();
      });
    }

    var listHost = $('ledgerListPanel');
    if (listHost) {
      listHost.addEventListener('click', function (e) {
        var del = e.target.closest ? e.target.closest('[data-action="delete"]') : null;
        if (!del) return;
        var row = del.closest('.ledger-item');
        if (!row) return;
        if (window.confirm('删除这条记账记录？删除后无法恢复。')) {
          W.ledger.remove(row.dataset.id);
          renderLedgerPage();
        }
      });
    }
  }

  /* ---------- 记账页：账单 OCR + 确认卡 ---------- */

  var ocrPreviewUrl = null;     /* 临时图片 URL，用完必须 revoke */
  var ocrResult = null;         /* 上一次识别的结果（只在内存里，不落存储） */

  function setOcrState(text) { setText('ocrState', text); }
  function setOcrMessage(text) { setText('ocrMessage', text); }

  /* 释放临时图片 URL —— 禁止把图片或 base64 写进 localStorage，靠这里兜住内存 */
  function releaseOcrPreviewUrl() {
    if (ocrPreviewUrl) {
      try { window.URL.revokeObjectURL(ocrPreviewUrl); } catch (err) { /* 忽略 */ }
      ocrPreviewUrl = null;
    }
    var img = $('ocrPreviewImg');
    if (img) img.removeAttribute('src');
    show($('ocrPreview'), false);
  }

  function renderOcrCategories() {
    var typeEl = $('ocrType');
    var catEl = $('ocrCategory');
    if (!typeEl || !catEl) return;

    var type = W.ledger.TYPES.indexOf(typeEl.value) !== -1 ? typeEl.value : 'out';
    var list = W.ledger.CATEGORIES[type];
    var current = catEl.value;

    clear(catEl);
    list.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      catEl.appendChild(opt);
    });
    catEl.value = list.indexOf(current) !== -1 ? current : list[0];
  }

  function renderOcrCandidates(candidates) {
    var host = $('ocrCandidates');
    if (!host) return;

    clear(host);

    /* 只有一个候选就没必要给选择 */
    if (!candidates || candidates.length < 2) {
      show(host, false);
      return;
    }

    var label = document.createElement('span');
    label.className = 'field-hint';
    label.textContent = '识别到多个金额，点一下可切换：';
    host.appendChild(label);

    candidates.forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ocr-chip';
      btn.dataset.amount = c.value;
      btn.textContent = c.value + (c.why ? '（' + c.why + '）' : '');
      host.appendChild(btn);
    });

    show(host, true);
  }

  function renderOcrRaw(text) {
    var wrap = $('ocrRawWrap');
    var pre = $('ocrRawText');
    if (!wrap || !pre) return;
    if (!text) { show(wrap, false); return; }
    pre.textContent = text;
    show(wrap, true);
  }

  function resetOcrCard() {
    show($('ocrCard'), false);
    show($('ocrCandidates'), false);
    show($('ocrRawWrap'), false);
    setText('ocrCardMessage', '');
    setText('ocrCardHint', '请核对后再入账');
    var amount = $('ocrAmount');
    var note = $('ocrNote');
    if (amount) amount.value = '';
    if (note) note.value = '';
    ocrResult = null;
  }

  /* 打开确认卡：识别成功、识别失败、金额为空 —— 三种情况都要打开 */
  function openOcrCard(result, amounts) {
    var hint;
    if (!result.ok) {
      hint = (result.message || '识别失败。') + '没读到金额，请手填。';
    } else if (!amounts.best) {
      hint = '没读到金额，请手填。';
    } else {
      hint = '请核对后再入账。金额是识别出来的，可能不准。';
    }

    var typeEl = $('ocrType');
    if (typeEl) typeEl.value = result.text ? W.ocr.guessType(result.text) : 'out';
    renderOcrCategories();

    var amountEl = $('ocrAmount');
    if (amountEl) amountEl.value = amounts.best || '';

    renderOcrCandidates(amounts.candidates);
    renderOcrRaw(result.text);
    setText('ocrCardHint', hint);
    setText('ocrCardMessage', '');

    show($('ocrCard'), true);
    if (amountEl && !amountEl.value) amountEl.focus();
  }

  function handleOcrFile(file) {
    var checked = W.ocr.checkImage(file);
    if (!checked.ok) {
      setOcrMessage(checked.message);
      return;
    }

    releaseOcrPreviewUrl();
    resetOcrCard();

    ocrPreviewUrl = window.URL.createObjectURL(file);
    var img = $('ocrPreviewImg');
    if (img) img.src = ocrPreviewUrl;
    show($('ocrPreview'), true);

    setOcrMessage('');
    setOcrState('识别中…');

    W.ocr.recognize(file, function (text, percent) {
      setOcrState(percent === null || percent === undefined ? text : text + ' ' + percent + '%');
    }).then(function (result) {
      /* 识别结束（无论成败）都释放临时 URL 与预览 */
      releaseOcrPreviewUrl();

      ocrResult = { text: result.text };
      var amounts = W.ocr.extractAmounts(result.text);

      setOcrState(result.ok ? '识别完成' : '识别失败');
      if (!result.ok) setOcrMessage(result.message || '识别失败，请手动填写。');
      else if (!amounts.best) setOcrMessage('没读到金额，请手填。');

      openOcrCard(result, amounts);
    });
  }

  function bindOcrUI() {
    var fileEl = $('ocrFile');
    if (fileEl) {
      fileEl.addEventListener('change', function () {
        var file = fileEl.files && fileEl.files[0];
        fileEl.value = '';                 /* 同一张图可以再选一次 */
        if (file) handleOcrFile(file);
      });
    }

    /* 粘贴截图：只在记账页处于激活状态时响应 */
    document.addEventListener('paste', function (e) {
      var page = $('page-ledger');
      if (!page || !page.classList.contains('is-active')) return;
      if (!e.clipboardData || !e.clipboardData.items) return;

      var items = e.clipboardData.items;
      for (var i = 0; i < items.length; i++) {
        var type = items[i].type || '';
        if (type.indexOf('image/') !== 0) continue;
        var file = items[i].getAsFile ? items[i].getAsFile() : null;
        if (file) {
          if (e.preventDefault) e.preventDefault();
          handleOcrFile(file);
          return;
        }
      }
    });

    var typeEl = $('ocrType');
    if (typeEl) {
      typeEl.addEventListener('change', function () {
        renderOcrCategories();
      });
    }

    var chips = $('ocrCandidates');
    if (chips) {
      chips.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('[data-amount]') : null;
        if (!btn) return;
        var amountEl = $('ocrAmount');
        if (amountEl) amountEl.value = btn.dataset.amount;
      });
    }

    var confirmBtn = $('ocrConfirmBtn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        var result = W.ledger.add({
          type: $('ocrType').value,
          category: $('ocrCategory').value,
          amount: $('ocrAmount').value,
          note: $('ocrNote').value,
          source: 'ocr'
        });

        if (!result.ok) {
          setText('ocrCardMessage', result.message);
          return;
        }

        var label = W.ledger.TYPE_LABEL[result.item.type];
        resetOcrCard();
        setOcrState('已入账');
        setOcrMessage('已入账：' + label + ' ' + W.ledger.formatAmount(result.item.amount) +
          ' 元（' + result.item.category + '），来源 OCR。');
        renderLedgerPage();
      });
    }

    var cancelBtn = $('ocrCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        releaseOcrPreviewUrl();
        resetOcrCard();
        setOcrState('未开始');
        setOcrMessage('已取消，没有入账。');
      });
    }
  }

  /* ---------- 页脚：导出 / 导入 / 清空 ---------- */

  var dataPanelMode = null;     /* 'import' | 'clear' */
  var pendingImport = null;     /* 通过校验、等待确认的导入内容 */

  function setDataMessage(text, isError) {
    var el = $('dataMessage');
    if (!el) return;
    el.textContent = text || '';
    if (isError) el.classList.add('is-error');
    else el.classList.remove('is-error');
  }

  function closeDataPanel() {
    dataPanelMode = null;
    pendingImport = null;
    show($('dataPanel'), false);
    clear($('dataPanelBody'));
  }

  function openDataPanel(mode, title, confirmText) {
    dataPanelMode = mode;
    setText('dataPanelTitle', title);
    setText('dataPanelConfirm', confirmText);
    clear($('dataPanelBody'));
    show($('dataPanel'), true);
  }

  function appendLine(host, text, className) {
    var p = document.createElement('p');
    p.className = className || 'data-line';
    p.textContent = text;
    host.appendChild(p);
    return p;
  }

  /* 导入摘要：逐类列出条数，缺失的明确标出来 */
  function renderImportSummary(result) {
    var host = $('dataPanelBody');
    clear(host);

    if (result.exportedAt) {
      appendLine(host, '导出时间：' + new Date(result.exportedAt).toLocaleString(), 'data-line');
    } else {
      appendLine(host, '文件里没有记录导出时间。', 'data-line');
    }
    appendLine(host, 'schemaVersion：' + W.storage.SCHEMA_VERSION, 'data-line');

    var ul = document.createElement('ul');
    ul.className = 'data-summary';
    result.summary.forEach(function (row) {
      var li = document.createElement('li');
      var name = document.createElement('span');
      name.className = 'data-summary-name';
      name.textContent = row.label;
      var detail = document.createElement('span');
      detail.className = 'data-summary-detail';
      detail.textContent = row.detail;
      if (row.missing) detail.classList.add('is-warning');
      li.appendChild(name);
      li.appendChild(detail);
      ul.appendChild(li);
    });
    host.appendChild(ul);

    appendLine(host, '确认后会用文件里的内容**覆盖**本机现有数据，覆盖后无法撤销。', 'data-line is-warning');
  }

  function renderImportErrors(errors) {
    var host = $('dataPanelBody');
    clear(host);
    appendLine(host, '这份文件没有通过校验，**现有数据没有被改动**：', 'data-line');
    var ul = document.createElement('ul');
    ul.className = 'data-summary';
    errors.forEach(function (msg) {
      var li = document.createElement('li');
      li.textContent = msg;
      ul.appendChild(li);
    });
    host.appendChild(ul);
  }

  function refreshEverything() {
    window.dispatchEvent(new CustomEvent('workbench:data-changed', {
      detail: { module: 'storage' }
    }));
  }

  /* 导出：下载一个 JSON 文件；用完释放临时 URL */
  function doExport() {
    var payload = W.storage.buildExport();
    var text = JSON.stringify(payload, null, 2);

    var d = new Date();
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    var name = '个人工作台备份-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';

    var url = null;
    try {
      var blob = new Blob([text], { type: 'application/json' });
      url = window.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setDataMessage('已导出 ' + name + '（' + Math.round(text.length / 1024) + ' KB）。');
    } catch (err) {
      setDataMessage('导出失败：浏览器不支持下载，或存储不可读。', true);
    } finally {
      if (url) {
        try { window.URL.revokeObjectURL(url); } catch (err2) { /* 忽略 */ }
      }
    }
  }

  function doImportFile(file) {
    if (!file) return;
    var reader = new FileReader();

    reader.onload = function () {
      var result = W.storage.validateImport(String(reader.result));
      if (!result.ok) {
        openDataPanel('import', '导入失败', '覆盖导入');
        show($('dataPanelConfirm'), false);
        show($('dataPanelCancel'), false);
        renderImportErrors(result.errors);
        setDataMessage('导入失败，现有数据未改动。', true);
        return;
      }

      pendingImport = result.payload;
      openDataPanel('import', '导入预览（确认后覆盖本机数据）', '覆盖导入');
      show($('dataPanelConfirm'), true);
      show($('dataPanelCancel'), true);
      renderImportSummary(result);
      setDataMessage('已读取文件，请先核对摘要。');
    };

    reader.onerror = function () {
      setDataMessage('读取文件失败，可以换一个文件再试。', true);
    };

    try {
      reader.readAsText(file);
    } catch (err) {
      setDataMessage('读取文件失败，可以换一个文件再试。', true);
    }
  }

  function confirmImport() {
    if (!pendingImport) return;
    var result = W.storage.applyImport(pendingImport);
    closeDataPanel();

    if (!result.ok) {
      setDataMessage(result.message, true);
      return;
    }

    refreshEverything();
    setDataMessage('导入完成，数据已覆盖为本机最新内容。');
  }

  /* 清空：先弹出确认面板，再走一次系统确认 —— 两次确认才真的删 */
  function askClear() {
    openDataPanel('clear', '清空全部数据（不可恢复）', '确认清空');
    var host = $('dataPanelBody');
    var counts = W.storage.readAll();
    appendLine(host, '下面这些内容会从本机浏览器里全部删掉：', 'data-line');
    var ul = document.createElement('ul');
    ul.className = 'data-summary';
    W.storage.DATA_KEYS.forEach(function (name) {
      var li = document.createElement('li');
      var n = document.createElement('span');
      n.className = 'data-summary-name';
      n.textContent = W.storage.LABELS[name];
      var d = document.createElement('span');
      d.className = 'data-summary-detail';
      var value = counts[name];
      d.textContent = name === 'habits'
        ? '设置与记录'
        : (Array.isArray(value) ? value.length + ' 条' : '—');
      li.appendChild(n);
      li.appendChild(d);
      ul.appendChild(li);
    });
    host.appendChild(ul);
    appendLine(host, '只删除本项目的 workbench.* 键；预置的常用网站不会自动恢复。', 'data-line is-warning');
    show($('dataPanelConfirm'), true);
    show($('dataPanelCancel'), true);
  }

  function confirmClear() {
    if (!window.confirm('最后确认一次：本机所有记录都会删除，且无法恢复。确定继续？')) return;

    /* 主题必须在 clearAll 之前读 —— clearAll 会把 meta 一起删掉，
       之后再读只会拿到默认的浅色 */
    var keepTheme = readTheme();
    var keepNickname = readNickname();

    var result = W.storage.clearAll();
    if (!result.ok) {
      setDataMessage('清空时部分数据没能删掉（' + result.failed.join('、') + '），可刷新后重试。', true);
      return;
    }

    /* 记下"已经初始化过"，避免下次刷新又把预置网站补回来。
       主题和昵称是显示偏好不是数据，这里一并写回去 —— 否则清空后界面会变回去，看起来像出了 bug */
    W.storage.set('meta', {
      schemaVersion: W.storage.SCHEMA_VERSION,
      linksSeeded: true,
      theme: keepTheme,
      nickname: keepNickname
    });

    closeDataPanel();
    refreshEverything();
    setDataMessage('已清空本机数据。预置的常用网站不会自动恢复。');
  }

  function bindDataUI() {
    var exportBtn = $('exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', doExport);

    var importBtn = $('importBtn');
    var importFile = $('importFile');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', function () {
        closeDataPanel();
        setDataMessage('');
        importFile.click();
      });
      importFile.addEventListener('change', function () {
        var file = importFile.files && importFile.files[0];
        importFile.value = '';             /* 同一个文件还能再选一次 */
        doImportFile(file);
      });
    }

    var clearBtn = $('clearBtn');
    if (clearBtn) clearBtn.addEventListener('click', askClear);

    var confirmBtn = $('dataPanelConfirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        if (dataPanelMode === 'import') confirmImport();
        else if (dataPanelMode === 'clear') confirmClear();
      });
    }

    var cancelBtn = $('dataPanelCancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        closeDataPanel();
        setDataMessage('已取消，数据没有改动。');
      });
    }

    var closeBtn = $('dataPanelClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        closeDataPanel();
        setDataMessage('已取消，数据没有改动。');
      });
    }

    /* 写入失败等存储层问题，统一在页脚给一句友好提示 */
    window.addEventListener('workbench:storage-error', function (e) {
      var msg = e.detail && e.detail.message;
      setDataMessage(msg || '数据没能保存，请稍后重试。', true);
    });
  }

  /* ---------- 番茄钟（极简节拍器） ----------
     范围见 PROJECT.md §4：25/5 写死、纯内存不落库、不统计、不出声、不与打卡联动。
     计时按「目标结束时刻」推算，不是每秒减一 —— 标签页切后台时 setInterval 会被节流到
     几秒一次甚至更慢，靠累减会走慢；用结束时刻算，回到前台时一步就校准回来。 */

  var POMO_PHASES = {
    focus: { label: '专注', seconds: 25 * 60 },
    rest:  { label: '休息', seconds: 5 * 60 }
  };
  var POMO_RING_LENGTH = 2 * Math.PI * 39;   /* 对应 index.html 里圆环的 r="39" */

  var pomo = {
    phase: 'focus',
    leftMs: POMO_PHASES.focus.seconds * 1000,
    endsAt: 0,        /* 运行中的目标结束时刻；没在跑就是 0 */
    timer: null
  };

  function pomoTotalMs() {
    return POMO_PHASES[pomo.phase].seconds * 1000;
  }

  function pomoRunning() {
    return pomo.timer !== null;
  }

  /* 毫秒 → MM:SS。向上取整，这样刚开始显示 25:00，归零时才显示 00:00 */
  function fmtClock(ms) {
    var total = Math.ceil(Math.max(0, ms) / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  function pomoStopTimer() {
    if (pomo.timer !== null) {
      window.clearInterval(pomo.timer);
      pomo.timer = null;
    }
    pomo.endsAt = 0;
  }

  function renderPomo() {
    var wrap = $('pomo');
    if (!wrap) return;

    var total = pomoTotalMs();
    var left = Math.max(0, Math.min(total, pomo.leftMs));
    var running = pomoRunning();

    setText('pomoTime', fmtClock(left));

    var bar = $('pomoBar');
    if (bar) {
      /* 整圈是 POMO_RING_LENGTH，offset 越大露出来的越少 —— 圆环随时间递减 */
      bar.style.strokeDasharray = POMO_RING_LENGTH + ' ' + POMO_RING_LENGTH;
      bar.style.strokeDashoffset = POMO_RING_LENGTH * (1 - left / total);
    }

    wrap.classList.toggle('is-rest', pomo.phase === 'rest');
    wrap.classList.toggle('is-running', running);

    var phases = document.querySelectorAll('#pomoPhases .pomo-phase');
    for (var i = 0; i < phases.length; i++) {
      if (phases[i].dataset.phase === pomo.phase) phases[i].classList.add('is-active');
      else phases[i].classList.remove('is-active');
    }

    var startBtn = $('pomoStart');
    var pauseBtn = $('pomoPause');
    if (startBtn) startBtn.disabled = running || left === 0;
    if (pauseBtn) pauseBtn.disabled = !running;

    var label = POMO_PHASES[pomo.phase].label;
    if (left === 0) setText('pomoHint', label + '时间到。要换一段就点上面的另一个按钮。');
    else if (running) setText('pomoHint', label + '中…切到别的标签页也会继续计时。');
    else if (left < total) setText('pomoHint', '已暂停，点「开始」接着走。');
    else setText('pomoHint', '25 / 5 固定长度，刷新后不保留。');
  }

  function pomoTick() {
    var left = pomo.endsAt - Date.now();
    if (left <= 0) {
      pomo.leftMs = 0;
      pomoStopTimer();
    } else {
      pomo.leftMs = left;
    }
    renderPomo();
  }

  function pomoStart() {
    if (pomoRunning() || pomo.leftMs <= 0) return;
    pomo.endsAt = Date.now() + pomo.leftMs;
    pomo.timer = window.setInterval(pomoTick, 250);
    renderPomo();
  }

  function pomoPause() {
    if (!pomoRunning()) return;
    pomo.leftMs = Math.max(0, pomo.endsAt - Date.now());
    pomoStopTimer();
    renderPomo();
  }

  function pomoReset() {
    pomoStopTimer();
    pomo.leftMs = pomoTotalMs();
    renderPomo();
  }

  function pomoSetPhase(phase) {
    if (!POMO_PHASES[phase]) return;
    pomoStopTimer();
    pomo.phase = phase;
    pomo.leftMs = pomoTotalMs();
    renderPomo();
  }

  function bindPomoUI() {
    var start = $('pomoStart');
    if (start) start.addEventListener('click', pomoStart);
    var pause = $('pomoPause');
    if (pause) pause.addEventListener('click', pomoPause);
    var reset = $('pomoReset');
    if (reset) reset.addEventListener('click', pomoReset);

    var phases = $('pomoPhases');
    if (phases) {
      phases.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.pomo-phase') : null;
        if (!btn) return;
        pomoSetPhase(btn.dataset.phase);
      });
    }

    renderPomo();
  }

  /* ---------- 深浅色主题 ----------
     偏好存进 workbench.meta.theme，不新增 localStorage key。
     主题是"显示偏好"而不是业务数据：清空数据时会一并保留，见 confirmClear()。 */

  var THEMES = ['light', 'dark'];

  function normalizeTheme(value) {
    return THEMES.indexOf(value) !== -1 ? value : 'light';
  }

  /* meta 里没写过、或者存了脏值，一律回落到浅色 */
  function readTheme() {
    var meta = W.storage.get('meta');
    return normalizeTheme(meta && meta.theme);
  }

  function applyTheme(theme) {
    var dark = theme === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    setText('themeToggleText', dark ? '浅色模式' : '深色模式');
    var btn = $('themeToggle');
    if (btn) btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }

  function toggleTheme() {
    var next = readTheme() === 'dark' ? 'light' : 'dark';
    var meta = W.storage.get('meta');
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {};
    meta.theme = next;
    W.storage.set('meta', meta);   /* 写不进去也照样切换，只是下次打开会回到默认 */
    applyTheme(next);
  }

  function bindThemeUI() {
    applyTheme(readTheme());
    var btn = $('themeToggle');
    if (btn) btn.addEventListener('click', toggleTheme);
  }

  /* ---------- 左栏问候语里的昵称 ----------
     存在 workbench.meta.nickname，和主题一样不新增 localStorage key。
     它算"显示偏好"而不是数据：清空数据时会保留，见 confirmClear()。 */

  var NICKNAME_MAX = 8;

  function readNickname() {
    var meta = W.storage.get('meta');
    var name = meta && typeof meta.nickname === 'string' ? meta.nickname : '';
    return name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, NICKNAME_MAX);
  }

  function applyNickname() {
    var input = $('nickname');
    if (!input) return;
    var name = readNickname();
    if (input.value !== name) input.value = name;
    input.title = name ? '点一下可以改昵称' : '点一下填昵称';
  }

  function saveNickname(value) {
    var name = typeof value === 'string'
      ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, NICKNAME_MAX)
      : '';

    var meta = W.storage.get('meta');
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {};
    meta.nickname = name;
    W.storage.set('meta', meta);   /* 写不进去也照样显示，只是下次打开会回到空 */

    applyNickname();
    return name;
  }

  function bindNicknameUI() {
    applyNickname();

    var input = $('nickname');
    if (!input) return;

    /* 用 change（失焦或回车后触发）而不是 input，避免每敲一个字就写一次存储 */
    input.addEventListener('change', function () { saveNickname(input.value); });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
  }

  /* ---------- 统一刷新入口 ---------- */

  function refresh(module) {
    renderSummaryCards();
    renderTodayPanel();
    renderHabitPanel();
    renderTodoPage();
    renderNotesPage();
    renderLinksPage();
    renderHabitsPage();
    renderLedgerPage();
    if (module) {
      /* 目前整体重绘；后续需要时再按 module 做局部刷新 */
    }
  }

  /* ---------- 左侧导航 ---------- */

  function showPage(name) {
    var pages = document.querySelectorAll('.page');
    for (var i = 0; i < pages.length; i++) pages[i].classList.remove('is-active');
    var target = $('page-' + name);
    if (target) target.classList.add('is-active');
  }

  function highlightNav(name) {
    var items = document.querySelectorAll('#nav .nav-item');
    for (var i = 0; i < items.length; i++) {
      if (items[i].dataset.page === name) items[i].classList.add('is-active');
      else items[i].classList.remove('is-active');
    }
  }

  function goToPage(name) {
    showPage(name);
    highlightNav(name);
  }

  function bindNav() {
    var nav = $('nav');
    if (!nav) return;

    nav.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.nav-item') : null;
      if (!btn) return;
      goToPage(btn.dataset.page);
    });
  }

  /* ---------- 启动 ---------- */

  var started = false;

  function init() {
    if (started) return;   /* 防止重复 init */
    started = true;

    W.links.ensureSeed();      /* 首次使用预置几个常用网站，只做一次 */

    renderHeader();
    bindPomoUI();              /* 番茄钟不依赖存储，单独初始化一次即可 */
    bindThemeUI();             /* 主题要在首帧就定下来，别等数据渲染完 */
    bindNicknameUI();
    refresh();
    bindNav();
    bindTodoUI();
    bindNoteUI();
    bindLinksUI();
    bindHabitsUI();
    bindHabitAddForm();
    bindLedgerUI();
    bindOcrUI();
    bindDataUI();

    window.addEventListener('workbench:data-changed', function (e) {
      refresh(e.detail && e.detail.module);
    });
  }

  W.app = {
    init: init,
    refresh: refresh,
    showPage: showPage,
    openNote: openNote,
    /* 番茄钟的读写口子。平时用不到，留着给验收脚本驱动 */
    pomo: {
      start: pomoStart,
      pause: pomoPause,
      reset: pomoReset,
      setPhase: pomoSetPhase,
      state: function () {
        return { phase: pomo.phase, leftMs: pomo.leftMs, running: pomoRunning() };
      }
    },
    /* 主题同理：界面上点按钮即可，这里给验收脚本用来断言 */
    theme: {
      current: readTheme,
      toggle: toggleTheme
    },
    nickname: {
      current: readNickname,
      set: saveNickname
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
