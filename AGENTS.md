# **个人工作台 · 开发指令**

## **项目概述**

轻量前端单页应用。HTML + CSS + JS，**零依赖、零构建**。

**双击 `index.html` 就能直接看**；但**开发时请用本地静态服务器**，不要用 `file://`：

```bash
python -m http.server 8777     # 然后访问 http://127.0.0.1:8777/
```

原因：剪贴板 API 与 OCR 的 worker 在 `file://` 下会被浏览器限制。

数据只走 localStorage。账单 OCR 用 Tesseract.js，确认后才写入账本。

## **目录（请保持稳定，不要每天推倒重来）**

所有文件直接放在当前工作目录根下，不要再套一层 workbench 文件夹：

├── index.html
├── css/style.css
├── js/app.js
├── js/storage.js
├── js/todo.js
├── js/notes.js
├── js/links.js
├── js/habits.js
├── js/ledger.js
├── js/ocr.js
├── PRD.md
├── AGENTS.md
├── PROJECT.md
├── README.md
├── LICENSE
└── .gitignore

## **脚本加载顺序**

index.html 底部按顺序引入：storage.js → 各模块 js → 全部加载完后再 init。

不要让多个模块各自重复执行全站 init。app.js 负责启动、导航和看板刷新，各业务文件只暴露本模块需要的函数。

违反这条的典型症状：同一次点击触发多次响应、看板数字翻倍、来回切页后逐渐变慢，且控制台不报错。新增模块时如出现上述现象，优先检查是否有文件自行绑定了初始化。

## **静态资源与缓存（2026-09-24 补，血泪条款）**

- **改了任何 `css/` 或 `js/` 文件，必须同步改 `index.html` 里那 9 处 `?v=` 版本号**（当前为 `?v=20260924j`）。
  改完换成当天日期；同一天改多次就写 `20260924b`、`20260924c`。
- **为什么必须**：本站是纯静态、没有构建步骤，文件名也不带 hash。服务端只发 `Last-Modified`、**没有 `Cache-Control`**，
  浏览器会按启发式规则自己决定能不能用缓存。不加版本号时，**用户浏览器会拿"旧 CSS 配新 HTML"**——
  症状极具迷惑性：页面上每个 SVG 图标都变成一个大黑块（默认 `fill: black`、默认 300×150 尺寸），
  新加的类名（`.card-mint`、`.card-icon`、`.brand-mark`、flex 版导航）全部不生效，看起来像"换肤彻底坏了"。
  实测踩过一次：线上 HTML 已是新版、CSS 还是旧缓存。
- **内联 SVG 必须自带 `width` / `height` / `fill="none"` / `stroke="currentColor"` 属性**，
  不能只靠 `.icon` 类提供。原因同上：CSS 一旦过期或没加载，只靠类名的图标会退化成黑块把布局撑烂。
  属性写在标签上属于"兜底"，`.icon` 类仍是一致的样式来源。

## **localStorage keys**

- workbench.todos
- workbench.notes
- workbench.links
- workbench.snippets
- workbench.ledger
- workbench.habits
- workbench.meta

禁止把图片 base64 写入 localStorage。

从 Day 9 起，所有业务模块只通过 storage.js 读写。读取到缺失或损坏的 JSON 时返回安全默认值，不让整页白屏。

本约束不设过渡期：从第一个业务模块起就必须走 storage.js。禁止在任何模块中直接调用 localStorage.getItem / setItem；如需调试，可在控制台临时查看，但不能写进业务代码。

## **开发规范**

- 原生 JS；不要引入 React/Vue/jQuery
- 金额：以「分」为单位的整数存储（8650 = ¥86.50），展示时除以 100 并保留两位小数
- id 使用 crypto.randomUUID()；若浏览器不支持再使用不会与现有记录重复的兜底方案
- 模块之间通过 storage + 自定义事件通知看板刷新
- 统一事件名：workbench:data-changed，detail.module 标明发生变化的模块
- 日期按用户本地时间计算；每周从周一开始
- 用户输入按纯文本渲染，不直接拼入 innerHTML；渲染列表与详情时禁止用字符串拼接生成 HTML（如 innerHTML = `<li>${text}</li>`），统一做法是 createElement + textContent，或克隆模板后逐个填充 textContent。原因：除注入风险外，文字中含 < 或 & 时会造成渲染错乱，且只在有真实数据时才暴露
- 网站 URL 只接受 http:// 和 https://；新窗口打开时使用 noopener
- 禁止使用 localStorage.clear()；清空时只删除本项目约定的 workbench.* key
- **凡是「为空就自动补默认值」的逻辑，必须配一个"是否初始化过"的标记**，否则用户把内容清光之后会被自动种回来，看起来像删不掉。已有两处先例：常用网站的 `meta.linksSeeded`、打卡的 `habits.initialized`
- **"延时刷新/延后重排"这类逻辑，挂起标志必须在写入之前设置**。原因：数据层写完会**同步**派发 `workbench:data-changed` → 立刻触发刷新，等写入函数返回时界面早就重绘完了，再设标志就晚了（待办点「完成」后延迟重排那次踩过）
- **从存储读出来的数组不能直接当"干净数据"用**。读取路径必须过一层清洗（丢掉 `null`、空文本、超限项），否则一个脏条目就会在渲染时抛错、把整页搞崩。清洗函数要保证**幂等**，且兜底生成的 id 必须是**确定性的**（用下标），不能用随机值 —— 随机 id 每次渲染都变，点上去就找不到那一项
- **改动已有数据结构时先想清楚老数据怎么办**：能靠"缺字段按默认值处理"兼容的就别升 `schemaVersion`（如待办的 `priority`、`progress`）；确实要换形状时，务必保证老记录还能读出来 —— 打卡的四个老 key（`water` / `sport` / `study` / `work`）就是因为记录按 id 存，换 id 等于丢历史，所以一直原样保留
- **判断「完成」这类状态只能有一个入口**。若某个字段是派生出来的（如待办的 `done` 由 `progress` 推导），就统一走那个判定函数，别在别处再写一遍 `item.done === true` —— 两个真相来源迟早打架

## **设计要求**

- 视觉基调（**2026-09-24 改版，取代原来的「冷灰蓝」**）：奶油纸底 + 细点阵纹理，卡片圆角 16px、几乎无边框，用**薄荷 / 粉 / 杏三色平涂**区分模块，强调色是**深墨绿**
- **颜色一律用 `css/style.css` 顶部的 CSS 变量**，组件里禁止写十六进制或 `rgb()` 硬编码。原因：深浅两套主题是同一套变量在两处取值，写死颜色在深色模式下会露出浅色底
- 深浅色两套：深色是 `html[data-theme="dark"]` 的变量覆盖块。**新增颜色变量必须两处都写**（写成 `html[...]` 而不是 `[data-theme=...]`，是为了权重压过 `:root`，否则命中顺序一变动就失效）
- 图标一律**内联 SVG**（统一挂 `.icon` 类，`stroke: currentColor`），不引入图标字体、不引入任何图片文件；点阵底纹用 CSS `radial-gradient` 画
- 主题偏好存 `workbench.meta.theme`，**不新增 localStorage key**
- 打开默认今日看板；左侧 6 项导航
- **字体三件套**：字体栈 / 字重 / 字距要一起改。单字重字体（幼圆、书法体）必须配 `font-weight: 400`，写 700 会被浏览器合成加粗糊掉
- 只做电脑网页，不要单独做手机页

## **禁止**

- 不要加登录、后端、npm 必须项（Tesseract 可用 CDN）
- 不要在 OCR 后自动入账
- 不要删除用户已有的 localStorage 数据，除非用户点「清空」

## **验收**

- 每个模块都有空状态
- 从 Day 10 起，已经实现的模块刷新后数据仍在
- OCR 必须出现确认卡
- 导出数据包含 schemaVersion 和 exportedAt；导入前必须校验并二次确认
- **换肤或新增组件后，浅色与深色各看一遍**：不允许出现深底深字、浅底浅字；组件样式里不得有硬编码颜色
- **改完至少跑一遍 jsdom 冒烟验收**（见 `PROJECT.md` 的说明）：加载真实 `index.html` +
  真实 js，断言结构、交互、**旧数据兼容**、其余模块回归、以及静态规则（无 `innerHTML`、
  除 storage 外不碰 `localStorage`）
