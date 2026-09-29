/* 验收：看板待办面板改为「全部待办」+ 待办页默认进入「全部」视图
   （2026-09-29）

   覆盖：
     A. 看板面板 = 全部待办（标题 / 计数 / 归属标签 / 三档混排）
     B. 看板空状态
     C. 待办页默认视图 = all（页签高亮 + 卡片数 + 新增归属回落）
     D. 待办页切档回归
     E. 「全部」视图下新增（bucket 必须落 today，不能写 all）
     F. 旧数据兼容（无 progress）+ 进度档位往返
     G. 看板与待办页计数口径一致
     H. 其他模块回归（笔记 / 快捷入口 / 打卡 / 记账 / 主题 / 昵称）
     Z. 静态检查（含 HTML 默认高亮页签 与 app.js 默认视图 必须一致）

   跑：
     cd D:\workbuddy\daka
     NODE_PATH="C:/Users/56839/.workbuddy/binaries/node/workspace/node_modules" \
       "C:/Users/56839/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" tests/check-all-todo.js
*/
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['storage', 'todo', 'notes', 'links', 'habits', 'ledger', 'ocr', 'app'];
const STORAGE_PREFIX = 'workbench.';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, actual) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; failures.push(name); console.log('  \u2717 ' + name + (actual !== undefined ? '   [' + actual + ']' : '')); }
}

async function boot(store) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = dom.window;

  if (store) {
    Object.keys(store).forEach((k) => {
      win.localStorage.setItem(STORAGE_PREFIX + k, typeof store[k] === 'string' ? store[k] : JSON.stringify(store[k]));
    });
  }

  FILES.forEach((f) => {
    win.eval(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'));
  });

  /* ★ 必须等 load：init() 挂在 DOMContentLoaded 上，等早了一律是假失败 */
  if (win.document.readyState !== 'complete') {
    await new Promise((res) => win.addEventListener('load', res, { once: true }));
  }
  return { dom, win };
}

/* 造三档各一条的旧数据（**故意不带 progress** → 走 done 反推那条兼容分支） */
function seedTodos(win) {
  win.localStorage.setItem('workbench.todos', JSON.stringify([
    { id: 'a1', bucket: 'today', text: '本日的活', done: false, priority: 'high', deadline: '', noteId: '', createdAt: '2026-09-20T01:00:00.000Z' },
    { id: 'b1', bucket: 'week', text: '本周的活', done: false, priority: 'mid', deadline: '', noteId: '', createdAt: '2026-09-21T01:00:00.000Z' },
    { id: 'c1', bucket: 'month', text: '本月的活', done: true, priority: 'low', deadline: '2026-10-30', noteId: '', createdAt: '2026-09-22T01:00:00.000Z' }
  ]));
}

(async function main() {
  console.log('\n== A. 看板待办面板 = 全部待办 ==');
  {
    const { dom, win } = await boot();
    seedTodos(win);
    win.Workbench.app.refresh();

    const title = win.document.querySelector('#page-board .lower .panel h2').textContent.trim();
    ok('面板标题为「全部待办」', title === '全部待办', title);

    ok('计数为 3 条（三档汇总）', win.document.getElementById('boardTodayTotal').textContent === '3',
      win.document.getElementById('boardTodayTotal').textContent);
    ok('已完成计数 1', win.document.getElementById('boardTodayDone').textContent === '1',
      win.document.getElementById('boardTodayDone').textContent);

    const rows = win.document.querySelectorAll('#boardTodayList .task-list li');
    ok('列表渲染 3 条', rows.length === 3, rows.length);

    const tags = Array.from(win.document.querySelectorAll('#boardTodayList .todo-bucket')).map((e) => e.textContent);
    ok('每条都带归属标签且覆盖三档',
      tags.length === 3 && ['本日', '本周', '本月'].every((t) => tags.indexOf(t) !== -1),
      tags.join(','));

    const texts = Array.from(win.document.querySelectorAll('#boardTodayList .task-text')).map((e) => e.textContent);
    ok('三档内容都在看板上', ['本日的活', '本周的活', '本月的活'].every((t) => texts.indexOf(t) !== -1), texts.join('|'));

    dom.window.close();
  }

  console.log('\n== B. 看板空状态 ==');
  {
    const { dom, win } = await boot();
    win.localStorage.setItem('workbench.todos', JSON.stringify([{ id: 'x', bucket: 'week', text: 'w', done: false, createdAt: '2026-09-01T00:00:00.000Z' }]));
    win.Workbench.app.refresh();
    ok('有本周待办时看板不空（不是只看本日）',
      win.document.querySelectorAll('#boardTodayList .task-list li').length === 1,
      win.document.querySelectorAll('#boardTodayList .task-list li').length);

    win.localStorage.setItem('workbench.todos', JSON.stringify([]));
    win.Workbench.app.refresh();
    const empty = win.document.querySelector('#boardTodayList .empty');
    ok('无任何待办时空状态文案正确', !!empty && empty.textContent === '还没有任何待办。', empty && empty.textContent);
    ok('空状态下计数为 0',
      win.document.getElementById('boardTodayTotal').textContent === '0' &&
      win.document.getElementById('boardTodayDone').textContent === '0');
    dom.window.close();
  }

  console.log('\n== C. 待办页默认进入「全部」 ==');
  {
    const { dom, win } = await boot();
    seedTodos(win);
    win.Workbench.app.refresh();

    const activeTab = win.document.querySelector('#todoTabs .tab.is-active');
    ok('默认高亮「全部」页签', !!activeTab && activeTab.dataset.bucket === 'all',
      activeTab && activeTab.dataset.bucket);

    ok('待办页进入即显示全部 3 条',
      win.document.querySelectorAll('#todoListPanel .todo-card').length === 3,
      win.document.querySelectorAll('#todoListPanel .todo-card').length);

    ok('「全部」视图下新增归属回落为「本日」',
      win.document.getElementById('todoAddBucket').textContent.trim() === '本日',
      win.document.getElementById('todoAddBucket').textContent.trim());

    dom.window.close();
  }

  console.log('\n== D. 待办页切档仍正常（回归） ==');
  {
    const { dom, win } = await boot();
    seedTodos(win);
    win.Workbench.app.refresh();

    function clickTab(key) {
      /* ★ 每次重新查询：点击会触发重绘，旧引用会失效 */
      const tab = win.document.querySelector('#todoTabs .tab[data-bucket="' + key + '"]');
      tab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    }

    clickTab('today');
    ok('切到「本日」只剩 1 条', win.document.querySelectorAll('#todoListPanel .todo-card').length === 1,
      win.document.querySelectorAll('#todoListPanel .todo-card').length);
    ok('「本日」态下无归属标签', win.document.querySelectorAll('#todoListPanel .todo-bucket').length === 0);
    ok('新增归属显示「本日」', win.document.getElementById('todoAddBucket').textContent.trim() === '本日');

    clickTab('month');
    ok('切到「本月」剩 1 条', win.document.querySelectorAll('#todoListPanel .todo-card').length === 1,
      win.document.querySelectorAll('#todoListPanel .todo-card').length);

    clickTab('all');
    ok('切回「全部」恢复 3 条', win.document.querySelectorAll('#todoListPanel .todo-card').length === 3,
      win.document.querySelectorAll('#todoListPanel .todo-card').length);
    ok('「全部」态下卡片带归属标签', win.document.querySelectorAll('#todoListPanel .todo-bucket').length === 3,
      win.document.querySelectorAll('#todoListPanel .todo-bucket').length);

    dom.window.close();
  }

  console.log('\n== E. 在「全部」视图下新增待办（回归） ==');
  {
    const { dom, win } = await boot();
    win.Workbench.app.refresh();

    const input = win.document.getElementById('todoInput');
    input.value = '全部视图下新加的任务';
    win.document.getElementById('todoAddForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));

    const stored = JSON.parse(win.localStorage.getItem('workbench.todos'));
    ok('新增成功 1 条', stored.length === 1, stored.length);
    ok('bucket 落为 today（绝不写入 all）', stored[0].bucket === 'today', stored[0].bucket);
    ok('progress 初始为 0', stored[0].progress === 0, stored[0].progress);
    ok('输入框已清空', input.value === '', input.value);
    dom.window.close();
  }

  console.log('\n== F. 旧数据兼容 + 进度档位（回归） ==');
  {
    const { dom, win } = await boot();
    seedTodos(win);
    win.Workbench.app.refresh();

    const doneCard = win.document.querySelector('#todoListPanel .todo-card[data-id="c1"]');
    ok('旧记录 done:true 渲染为已完成', !!doneCard && doneCard.classList.contains('is-done'));
    const percent = doneCard && doneCard.querySelector('.todo-percent');
    ok('旧记录 done:true 显示 100%', !!percent && percent.textContent === '100%', percent && percent.textContent);

    /* 点卡片上的「完成」档位 */
    const card = win.document.querySelector('#todoListPanel .todo-card[data-id="a1"]');
    card.querySelector('[data-tick="100"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

    const a1 = JSON.parse(win.localStorage.getItem('workbench.todos')).filter((t) => t.id === 'a1')[0];
    ok('点「完成」→ progress=100 且 done=true', a1.progress === 100 && a1.done === true,
      JSON.stringify({ p: a1.progress, d: a1.done }));

    /* 再点同一档 → 退回 0%（走数据层，避开 700ms 重排） */
    win.Workbench.todo.applyTick('a1', '100');
    const a1b = JSON.parse(win.localStorage.getItem('workbench.todos')).filter((t) => t.id === 'a1')[0];
    ok('再点同一档 → 退回 0%', a1b.progress === 0 && a1b.done === false,
      JSON.stringify({ p: a1b.progress, d: a1b.done }));

    dom.window.close();
  }

  console.log('\n== G. 看板与待办页计数口径一致 ==');
  {
    const { dom, win } = await boot();
    seedTodos(win);
    win.Workbench.app.refresh();

    const boardTotal = win.document.getElementById('boardTodayTotal').textContent;
    const listMeta = win.document.getElementById('todoListMeta').textContent.replace(/\s/g, '');
    ok('看板总数 == 待办页「全部」总数', boardTotal === '3' && listMeta === '1/3',
      'board=' + boardTotal + ' list=' + listMeta);

    ok('顶部汇总卡 total 也是 3', win.document.getElementById('boardTodoTotal').textContent === '3',
      win.document.getElementById('boardTodoTotal').textContent);
    dom.window.close();
  }

  console.log('\n== H. 其他模块回归 ==');
  {
    const { dom, win } = await boot();
    ok('笔记面板存在', !!win.document.getElementById('noteListPanel'));
    ok('快捷入口面板存在', !!win.document.getElementById('siteListPanel'));
    ok('打卡网格存在', !!win.document.getElementById('habitGrid'));
    ok('记账列表存在', !!win.document.getElementById('ledgerListPanel'));

    const res = win.Workbench.habits.addHabit({ label: '喝水', kind: 'count', period: 'day', target: 3 });
    ok('打卡新增成功', res.ok === true, JSON.stringify(res));
    win.Workbench.habits.bump(res.item.key);
    const p = win.Workbench.habits.getProgress(res.item.key);
    ok('打卡 +1 生效', p && p.value === 1, p && p.value);

    const led = win.Workbench.ledger.add({ type: 'out', category: win.Workbench.ledger.CATEGORIES.out[0], amount: '12.50', note: '午饭' });
    ok('记账新增成功', led.ok === true, JSON.stringify(led));
    ok('金额按分存储 1250', led.item && led.item.amount === 1250, led.item && led.item.amount);

    win.Workbench.app.theme.toggle();
    ok('主题可切换为深色', win.Workbench.app.theme.current() === 'dark', win.Workbench.app.theme.current());
    win.Workbench.app.nickname.set('yang');
    ok('昵称可写入', win.Workbench.app.nickname.current() === 'yang', win.Workbench.app.nickname.current());

    dom.window.close();
  }

  console.log('\n== Z. 静态检查 ==');
  {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    /* ⚠️ 这两个调用点实参写法不同，别搞混：
       read() 只收裸模块名（自动补 .js）；正则直接测 .js 源码串 */
    const read = (f) => strip(fs.readFileSync(path.join(ROOT, 'js', f.replace(/\.js$/, '') + '.js'), 'utf8'));
    const all = FILES.map(read).join('\n');
    ok('渲染不使用 innerHTML', all.indexOf('innerHTML') === -1);
    ok('没有 localStorage.clear', all.indexOf('localStorage.clear') === -1);
    ok('除存储层外不直接碰 localStorage',
      FILES.filter((f) => f !== 'storage').every((f) => !/localStorage\s*\./.test(read(f))));

    /* ★ 这两处默认值必须一致，否则「进入待办页先看到全部」只在刷新后成立 */
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const m = html.match(/<button type="button" class="tab is-active" data-bucket="([a-z]+)">/);
    ok('index.html 默认高亮页签 = all', !!m && m[1] === 'all', m && m[1]);
    ok('app.js 默认视图 = ALL_VIEW', /var todoBucket = W\.todo\.ALL_VIEW;/.test(read('app.js')));
    ok('看板面板标题已改为「全部待办」', html.indexOf('>全部待办<') !== -1);
  }

  console.log('\n========================================');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) console.log('失败清单：\n  - ' + failures.join('\n  - '));
  console.log('========================================');
  process.exit(fail ? 1 : 0);
})();
