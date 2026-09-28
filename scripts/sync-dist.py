# -*- coding: utf-8 -*-
# 把「浏览器真正要下载的文件」同步到 dist/，供静态站部署使用。
#
# 为什么需要它：部署源过去是**项目根**，会把这些东西一起传到线上 ——
#   .git/          整个 git 历史（而且每次 commit 都会长大）
#   .workbuddy/    我的工作日志（含基础设施细节）
#   .wbapp_*.genie 本地部署标记（含本机绝对路径）
#   四份项目文档    （已经在 GitHub 上，线上不必再放一份）
# 改用 dist/ 之后，公开面就只剩源码本身。
#
# 用法：python scripts/sync-dist.py
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')

# 只有这三样是浏览器真正要下载的
ITEMS = ['index.html', 'css', 'js']

# 这些绝不该出现在 dist 里（出现就中止，宁可部署失败也不上脏东西）
FORBIDDEN_NAMES = ['.git', '.workbuddy', 'PROJECT.md', 'PRD.md', 'AGENTS.md',
                   'README.md', 'LICENSE', '.cache']


def main():
    for name in ITEMS:
        if not os.path.exists(os.path.join(ROOT, name)):
            sys.exit('★ 找不到 %s，已中止' % os.path.join(ROOT, name))

    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)

    for name in ITEMS:
        src = os.path.join(ROOT, name)
        dst = os.path.join(DIST, name)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)

    # 列出结果
    files = []
    for root, dirs, names in os.walk(DIST):
        for f in sorted(names):
            p = os.path.join(root, f)
            files.append((os.path.relpath(p, DIST).replace('\\', '/'), os.path.getsize(p)))

    total = sum(s for _, s in files)
    print('已同步到 dist/：')
    for rel, size in sorted(files):
        print('  %-26s %8d B' % (rel, size))
    print('共 %d 个文件，%.1f KB' % (len(files), total / 1024.0))

    # 安全核对：dist 里不允许有隐藏项 / 部署标记 / 项目文档
    bad = []
    for root, dirs, names in os.walk(DIST):
        for n in list(dirs) + list(names):
            if n.startswith('.') or n.endswith('.genie') or n in FORBIDDEN_NAMES:
                bad.append(n)
    if bad:
        sys.exit('★ dist/ 里出现了不该有的东西：%s，已中止' % sorted(set(bad)))

    print('核对通过：dist/ 里没有 .git / .workbuddy / .genie / 项目文档')


main()
