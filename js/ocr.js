/* 个人工作台 · js/ocr.js
   账单 OCR：图片只在本机浏览器里处理，不走任何云端 OCR API、不传后端、不写 localStorage。

   ⚠️ 版本必须成套，不要改成 latest / 不带版本号的别名（会造成主库、worker、core 版本错配）：
   - 主库     tesseract.js@7.0.0
   - worker   tesseract.js@7.0.0
   - core     tesseract.js-core@7.0.0（worker 会按 SIMD 支持自动挑具体文件）
   - 语言模型 @tesseract.js-data 下 4.0.0 路径里的 chi_sim / eng
   这些地址的实际可达性与体积已逐个验证过，见 README.md。

   设计：
   - 主库脚本**懒加载**：第一次真正要识别时才注入 <script>，不拖慢首屏
   - 识别完立即 terminate worker；临时图片 URL 由 app.js 负责释放
   - 想改成"离线可用 + 仓库自带语言包"时，只需把下面 PATHS 换成本地 vendor/ 路径，
     四者仍然成套即可 */
(function () {
  'use strict';

  var TESSERACT_VERSION = '7.0.0';
  var CORE_VERSION = '7.0.0';
  var CDN_BASE = 'https://cdn.jsdelivr.net/npm/';

  var PATHS = {
    lib: CDN_BASE + 'tesseract.js@' + TESSERACT_VERSION + '/dist/tesseract.min.js',
    worker: CDN_BASE + 'tesseract.js@' + TESSERACT_VERSION + '/dist/worker.min.js',
    core: CDN_BASE + 'tesseract.js-core@' + CORE_VERSION,
    /* 语言模型由主库按 lang 自行拼成 …/@tesseract.js-data/<lang>/4.0.0/<lang>.traineddata.gz，
       所以这里**不覆盖 langPath** —— 一个 langPath 无法同时指向 chi_sim 与 eng 两个目录 */
    langBase: CDN_BASE + '@tesseract.js-data',
    langVersionPath: '4.0.0'
  };

  /* 语言模型的实际地址（写出来便于核对，也是主库默认会拼出的地址） */
  var LANG_URLS = {
    chi_sim: PATHS.langBase + '/chi_sim/' + PATHS.langVersionPath + '/chi_sim.traineddata.gz',
    eng: PATHS.langBase + '/eng/' + PATHS.langVersionPath + '/eng.traineddata.gz'
  };

  var LANG = 'chi_sim+eng';
  var MAX_BYTES = 8 * 1024 * 1024;               /* 单张图上限 8MB */
  var ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

  var libPromise = null;
  var worker = null;

  var STATUS_TEXT = {
    'loading tesseract core': '正在加载识别核心…',
    'initializing tesseract': '正在初始化识别引擎…',
    'loading language traineddata': '正在加载语言模型（首次较慢）…',
    'loaded language traineddata': '语言模型已就绪',
    'initializing api': '正在准备识别…',
    'recognizing text': '正在识别文字…'
  };

  /* ---------- 懒加载主库 ---------- */

  function loadLibrary() {
    if (libPromise) return libPromise;

    libPromise = new Promise(function (resolve, reject) {
      if (window.Tesseract) { resolve(window.Tesseract); return; }

      var s = document.createElement('script');
      s.src = PATHS.lib;
      s.async = true;
      s.setAttribute('data-ocr-lib', 'tesseract.js@' + TESSERACT_VERSION);
      s.onload = function () {
        if (window.Tesseract) resolve(window.Tesseract);
        else reject(new Error('识别库加载后仍不可用。'));
      };
      s.onerror = function () {
        libPromise = null;              /* 允许下次重试 */
        reject(new Error('识别库下载失败，检查网络后重试。'));
      };
      document.head.appendChild(s);
    });

    return libPromise;
  }

  /* ---------- 图片校验 ---------- */

  function checkImage(file) {
    if (!file) return { ok: false, message: '没有拿到图片。' };
    if (ALLOWED.indexOf(file.type) === -1) {
      return { ok: false, message: '只支持 jpg / png / webp 图片。' };
    }
    if (file.size > MAX_BYTES) {
      return {
        ok: false,
        message: '图片 ' + (file.size / 1048576).toFixed(1) + 'MB，超过 8MB 上限，请压缩后重试。'
      };
    }
    return { ok: true };
  }

  /* ---------- 识别 ---------- */

  function ensureWorker(onStatus) {
    if (worker) return Promise.resolve(worker);

    return loadLibrary().then(function (Tesseract) {
      var options = {
        workerPath: PATHS.worker,
        corePath: PATHS.core,
        logger: function (m) {
          if (!onStatus || !m) return;
          var text = STATUS_TEXT[m.status];
          if (!text) return;
          var percent = typeof m.progress === 'number' ? Math.round(m.progress * 100) : null;
          onStatus(text, percent);
        }
      };

      return Tesseract.createWorker(LANG, 1, options).then(function (w) {
        worker = w;
        return worker;
      });
    });
  }

  function terminate() {
    if (!worker) return Promise.resolve();
    var w = worker;
    worker = null;
    try {
      return Promise.resolve(w.terminate()).catch(function () {});
    } catch (err) {
      return Promise.resolve();
    }
  }

  /* 识别一张图（Blob/File）。无论成功失败都不抛给调用方，而是返回结构化结果 */
  function recognize(image, onStatus) {
    return ensureWorker(onStatus).then(function (w) {
      return w.recognize(image);
    }).then(function (res) {
      var text = res && res.data && typeof res.data.text === 'string' ? res.data.text : '';
      return { ok: true, text: text };
    }).catch(function (err) {
      /* 主库下载失败 / 语言模型下载失败 / 识别出错：统一收敛成失败结果，不抛异常 */
      terminate();
      return {
        ok: false,
        text: '',
        message: (err && err.message) ? err.message : '识别失败，可以手动填写金额。'
      };
    });
  }

  /* ---------- 从识别文本里抽金额 ---------- */

  var KEYWORD_WEIGHT = [
    { re: /实付|实收款|实收|付款金额|支付金额|已付|应付/, weight: 100 },
    { re: /合计|总计|共计|小计|订单金额|消费金额|金额/, weight: 80 },
    { re: /付款|支付|收款|到账|消费/, weight: 50 }
  ];

  function toHalfWidth(s) {
    return String(s || '')
      .replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
      .replace(/．/g, '.')
      .replace(/，/g, ',')
      .replace(/[¥￥]/g, '¥');
  }

  function toNumber(raw) {
    var s = String(raw || '').replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    var n = Number(s);
    return isFinite(n) && n > 0 ? n : null;
  }

  function keywordWeight(line) {
    var w = 0;
    KEYWORD_WEIGHT.forEach(function (k) { if (k.re.test(line)) w = Math.max(w, k.weight); });
    return w;
  }

  /* 返回 { best, candidates }，金额都是「元」的两位小数字符串 */
  function extractAmounts(text) {
    var lines = toHalfWidth(text).split(/\r?\n/);
    var found = [];

    function push(raw, score, why) {
      var n = toNumber(raw);
      if (n === null) return;
      found.push({ value: n.toFixed(2), score: score, why: why });
    }

    lines.forEach(function (line) {
      if (line.trim() === '') return;
      var lineScore = keywordWeight(line);
      var m;

      var yenRe = /¥\s*(\d[\d,]*(?:\.\d{1,2})?)/g;
      while ((m = yenRe.exec(line)) !== null) push(m[1], 90 + lineScore, '¥ 前缀');

      var kwRe = /(实付|实收款|实收|付款金额|支付金额|已付|应付|合计|总计|共计|小计|订单金额|消费金额|金额|付款|支付|收款|到账|消费)/g;
      while ((m = kwRe.exec(line)) !== null) {
        var seg = line.slice(m.index, m.index + m[0].length + 16);
        var nm = seg.match(/(\d[\d,]*(?:\.\d{1,2})?)/);
        if (nm) push(nm[1], (lineScore || 60) + 5, m[0] + ' 附近');
      }

      var yuanRe = /(\d[\d,]*(?:\.\d{1,2})?)\s*元/g;
      while ((m = yuanRe.exec(line)) !== null) push(m[1], 40 + lineScore, '带「元」');

      var bareRe = /(\d[\d,]*\.\d{1,2})/g;
      while ((m = bareRe.exec(line)) !== null) push(m[1], 20 + lineScore, '小数');
    });

    /* 按分值排序；同分时取较大金额（账单总额通常大于明细行） */
    found.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return Number(b.value) - Number(a.value);
    });

    var seen = {};
    var candidates = [];
    found.forEach(function (c) {
      if (seen[c.value]) return;
      seen[c.value] = true;
      if (candidates.length < 5) candidates.push(c);
    });

    return {
      best: candidates.length ? candidates[0].value : '',
      candidates: candidates
    };
  }

  /* 轻量猜测收/支：命中收款类词按收入，否则按支出（只是预填，确认卡可改） */
  function guessType(text) {
    var t = toHalfWidth(text);
    if (/收款|收入|到账|退款|已收/.test(t)) return 'in';
    return 'out';
  }

  window.Workbench = window.Workbench || {};
  window.Workbench.ocr = {
    VERSIONS: { tesseract: TESSERACT_VERSION, core: CORE_VERSION, lang: LANG },
    PATHS: PATHS,
    LANG_URLS: LANG_URLS,
    MAX_BYTES: MAX_BYTES,
    ALLOWED_TYPES: ALLOWED,
    checkImage: checkImage,
    recognize: recognize,
    extractAmounts: extractAmounts,
    guessType: guessType,
    terminate: terminate
  };
})();
