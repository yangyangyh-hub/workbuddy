/* 个人工作台 · js/links.js
   快捷入口模块：常用网站（workbench.links）与常用文本（workbench.snippets）。
   数据结构（PRD §4）：网站 id, name, url；文本 id, name, text
   约定：
   - 只通过 Workbench.storage 读写
   - URL 只接受 http:// 与 https://；没有协议时补 https://，其他协议拒绝保存
   - 首次使用时预置几个常用网站，并在 workbench.meta 记 linksSeeded；
     用户把网站全删光之后，刷新也不会自动恢复预置 */
(function () {
  'use strict';

  var storage = window.Workbench.storage;

  var SEED_SITES = [
    { name: '邮箱', url: 'https://mail.qq.com' },
    { name: '腾讯文档', url: 'https://docs.qq.com' },
    { name: 'GitHub', url: 'https://github.com' },
    { name: '百度', url: 'https://www.baidu.com' }
  ];

  /* 形如 javascript: / data: / file: / mailto: 的协议头 */
  var SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

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

  function notify(module) {
    window.dispatchEvent(new CustomEvent('workbench:data-changed', {
      detail: { module: module }
    }));
  }

  /* ---------- 常用网站 ---------- */

  function getSites() {
    var list = storage.get('links');
    return Array.isArray(list) ? list : [];
  }

  /* 把用户输入变成规范 URL；只允许 http/https */
  function normalizeUrl(raw) {
    var value = typeof raw === 'string' ? raw.trim() : '';

    if (value === '') return { ok: false, message: '网址不能为空。' };
    if (/\s/.test(value)) return { ok: false, message: '网址里不能有空格。' };

    if (SCHEME_RE.test(value)) {
      if (!/^https?:\/\//i.test(value)) {
        return { ok: false, message: '只允许 http:// 或 https:// 开头的网址，其他协议不保存。' };
      }
    } else {
      value = 'https://' + value;      /* 没有协议时补 https:// */
    }

    var parsed;
    try {
      parsed = new window.URL(value);
    } catch (err) {
      return { ok: false, message: '这个网址看不懂，检查一下有没有写错。' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, message: '只允许 http:// 或 https:// 开头的网址。' };
    }
    if (!parsed.hostname) {
      return { ok: false, message: '网址缺主机名，例如 https://example.com。' };
    }
    if (parsed.hostname.indexOf('.') === -1 && parsed.hostname !== 'localhost') {
      return { ok: false, message: '网址看起来不完整，例如 https://example.com。' };
    }

    return { ok: true, url: parsed.href };
  }

  function siteHost(url) {
    try {
      return new window.URL(url).hostname;
    } catch (err) {
      return '';
    }
  }

  function addSite(input) {
    var data = input || {};
    var name = typeof data.name === 'string' ? data.name.trim() : '';
    if (name === '') return { ok: false, message: '名称不能为空。' };

    var checked = normalizeUrl(data.url);
    if (!checked.ok) return checked;

    var item = { id: newId(), name: name, url: checked.url };
    var list = getSites();
    list.push(item);
    if (!storage.set('links', list)) {
      return { ok: false, message: '保存失败，浏览器存储可能不可用。' };
    }
    notify('links');
    return { ok: true, item: item };
  }

  function removeSite(id) {
    var list = getSites();
    var next = list.filter(function (item) { return !item || item.id !== id; });
    if (next.length === list.length) return false;
    storage.set('links', next);
    notify('links');
    return true;
  }

  /* 首次使用预置：只在 meta.linksSeeded 不是 true 时执行一次。
     用户把预置的全删掉后，linksSeeded 仍是 true，刷新不会恢复。 */
  function ensureSeed() {
    var meta = storage.get('meta');
    if (meta && meta.linksSeeded === true) return false;

    if (getSites().length === 0) {
      storage.set('links', SEED_SITES.map(function (site) {
        return { id: newId(), name: site.name, url: site.url };
      }));
    }

    meta = storage.get('meta') || {};
    meta.linksSeeded = true;
    storage.set('meta', meta);
    return true;
  }

  /* ---------- 常用文本 ---------- */

  function getSnippets() {
    var list = storage.get('snippets');
    return Array.isArray(list) ? list : [];
  }

  function addSnippet(input) {
    var data = input || {};
    var name = typeof data.name === 'string' ? data.name.trim() : '';
    var text = typeof data.text === 'string' ? data.text.trim() : '';

    if (name === '') return { ok: false, message: '名称不能为空。' };
    if (text === '') return { ok: false, message: '内容不能为空。' };

    var item = { id: newId(), name: name, text: text };
    var list = getSnippets();
    list.push(item);
    if (!storage.set('snippets', list)) {
      return { ok: false, message: '保存失败，浏览器存储可能不可用。' };
    }
    notify('snippets');
    return { ok: true, item: item };
  }

  function removeSnippet(id) {
    var list = getSnippets();
    var next = list.filter(function (item) { return !item || item.id !== id; });
    if (next.length === list.length) return false;
    storage.set('snippets', next);
    notify('snippets');
    return true;
  }

  window.Workbench = window.Workbench || {};
  window.Workbench.links = {
    SEED_SITES: SEED_SITES,
    getSites: getSites,
    getSnippets: getSnippets,
    normalizeUrl: normalizeUrl,
    siteHost: siteHost,
    addSite: addSite,
    removeSite: removeSite,
    ensureSeed: ensureSeed,
    addSnippet: addSnippet,
    removeSnippet: removeSnippet
  };
})();
