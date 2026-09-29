# daka 回归 / 验收脚本

> **本目录是项目资产,不是缓存** —— 依据 `~/.workbuddy/RULES.md` §1(2026-09-28 补)。
> 脚本跨轮复用、任务结束**不清理**。跑完就删等于下轮重写。

## 为什么要有这个目录

09-24 ~ 09-28 期间,验收脚本被写了三遍又丢了三遍:

| 日期 | 脚本 | 断言数 | 结局 |
|---|---|---|---|
| 09-24 | `check-habits.js` | 80 | 落在 `.cache\`,被当缓存清掉 |
| 09-24 | `check-cache.js` | 25 | 同上 |
| 09-28 | `check-allview.js` | 59 | 同上 |

对照组:`net\tests\` 自 09-21 固化后一直在复用。**同一个问题两个项目两种处理**,本次统一。

## 命名

```
tests\check-<模块>.js       # 单模块验收,如 check-todo.js / check-habits.js
tests\check-all.js          # 全站回归(可选)
```

## 运行

本机 Git Bash 的 `PATH` 是坏的(`ls` / `tail` 都可能没有),jsdom 装在 node 的 workspace 下:

```bash
cd D:\workbuddy\daka
NODE_PATH="C:/Users/56839/.workbuddy/binaries/node/workspace/node_modules" \
  "C:/Users/56839/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" tests/check-<模块>.js
```

换机器时把上面两个占位符换成自己机器上的位置即可。

## 写断言前先读

技能 **`jsdom-acceptance-testing`** 里有可直接复制的引导模板(boot / ok / stripComments / sleep)
和七类断言清单(`references/assertion-checklist.md`),标出了最容易漏的两类:**旧数据兼容**、**其余模块回归**。

### 三个反复踩、每次都白排查一整轮的坑

1. **jsdom 灌完脚本后 `readyState` 仍是 `loading`** —— `init()` 挂在 `DOMContentLoaded` 上还没跑。
   必须 `await` 到 window 的 `load` 事件再断言,否则所有按钮都停在 HTML 里的初始样子,
   会误判成"一堆功能没实现"(09-24 首轮 12 项假失败全是这么来的,应用一行没改)。
2. **每个操作段开头先显式把状态设成预期值**,不要依赖上一段留下的状态。
   已踩 2 次:09-24「以为第二项没勾,其实上一节结束时是勾着的」;
   09-28「删 t2 找不到卡片,因为它属于本周、而当时还停在『本日』视图」。
3. **静态检查"有没有调用某 API"之前先剥掉注释** —— 否则注释里写的「禁止 xxx()」会被当成真调用。
   同理,改测试脚本前先 grep 有没有同名函数(09-23 在 net 重复定义过 `stripComments`)。

**测试失败先判"脚本错"还是"代码错"** —— 报错整齐划一(多个对象同时报同一种错)时,大概率是脚本自己。

## 发布后核对清单

发布 ≠ 完事。**每次发布后逐项 curl 核对**,不能只看"发布成功"就回报
(缓存事故那次就是靠这套核对才发现"线上文件是新的、问题在浏览器缓存")。

发布源自 09-28 起是 `dist/`(先跑 `python scripts/sync-dist.py`),不是项目根。

| # | 核对项 | 怎么查 |
|---|---|---|
| 1 | 各资源 200 | `/`、`/js/*.js`、`/css/style.css` |
| 2 | 缓存串是新的 | HTML 里 `?v=YYYYMMDD` 与本地一致 |
| 3 | 新代码真的上去了 | curl 到的 js 里含本次新增的函数名 / 类名 |
| 4 | 结构符合预期 | 如 Tab 顺序、新增的 CSS 类在位 |
| 5 | `dist/` 自检通过 | `sync-dist.py` 遇隐藏项 / `.genie` / 项目文档会中止 |

**遇到 403 不要当成"文件不存在"** —— 腾讯云 WAF 会返回拦截页(不是 404),
说明请求根本没到源站,结论只能停在"无法确认"。要看响应体再下结论。
