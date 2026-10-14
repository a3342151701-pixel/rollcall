/*!
 * roster.js — 点名名单的数据模型
 * 负责：名单与抽取记录的本地存储、从粘贴文本或表格里解析姓名、随机抽取。
 * 纯逻辑、不碰 DOM，直接以普通 script 加载，暴露全局 Roster。
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'roll-call/v1';
  var HISTORY_LIMIT = 50;
  var MAX_NAMES = 2000;

  /* 姓名列的表头写法（用来判断表格里哪一列是姓名） */
  var NAME_HEADERS = [
    '姓名', '名字', '学生姓名', '学生名字', '学生名称', '学员姓名', '成员姓名', '人员姓名',
    '花名', '名单', '名册', '同学', '同学姓名', '人员', '成员', '学生', '学员',
    'name', 'student', 'studentname', 'fullname', 'username', 'member'
  ];

  /* 明显不是姓名的内容：表头、统计行、性别、备注等，遇到就跳过不当作姓名 */
  var STOP_WORDS = [
    '姓名', '名字', '学生', '学员', '同学', '成员', '人员', '花名', '名单', '花名册', '名册', '班级', '序号', '学号', '编号', '学籍号',
    '性别', '男', '女', '男女', '备注', '说明', '备注信息', '成绩', '分数', '得分', '平均分', '总分', '合计', '总计', '小计', '统计',
    '人数', '总人数', '出勤', '缺勤', '请假', '考勤', '学院', '专业', '年级', '班级名称', '老师', '教师', '辅导员', '班主任',
    '日期', '时间', '星期', '节次', '课程', '教室', '地点', '组别', '小组', '第一组', '第二组', '第三组', '第四组', '第五组', '第六组',
    'name', 'student', 'no', 'id', 'index', 'class', 'group', 'sex', 'gender', 'note', 'remark', 'score', 'total', 'sum', 'count'
  ];

  var CN_NAME_RE = /^[\u4e00-\u9fa5]{2,6}$/;
  var CN_DOT_NAME_RE = /^[\u4e00-\u9fa5]{1,6}(?:[·•・][\u4e00-\u9fa5]{1,6}){1,2}$/;
  var EN_NAME_RE = /^[A-Za-z][A-Za-z'’\-]*(?: [A-Za-z][A-Za-z'’\-]*){0,3}$/;

  var CN_DIGITS = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

  /* ---------------------------------------------------------------- 基础工具 */

  function trim(value) {
    return String(value == null ? '' : String(value)).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  }

  function clampInt(value, min, max, dflt) {
    var n = parseInt(value, 10);
    if (isNaN(n)) n = dflt;
    return Math.min(max, Math.max(min, n));
  }

  function uniq(list) {
    var seen = {}, out = [];
    list.forEach(function (item) {
      var key = String(item);
      if (seen[key]) return;
      seen[key] = 1;
      out.push(item);
    });
    return out;
  }

  /* ------------------------------------------------------------ 姓名识别 */

  function stopKey(text) {
    return String(text == null ? '' : text).replace(/[\s\u00a0]+/g, '').toLowerCase();
  }

  function isStopWord(text) {
    var key = stopKey(text);
    if (!key) return true;
    for (var i = 0; i < STOP_WORDS.length; i++) {
      if (stopKey(STOP_WORDS[i]) === key) return true;
    }
    return false;
  }

  /** 判断一格内容是不是姓名列表的表头（「姓名」「名字」「Name」…） */
  function isNameHeader(text) {
    var key = stopKey(text);
    if (!key) return false;
    for (var i = 0; i < NAME_HEADERS.length; i++) {
      if (stopKey(NAME_HEADERS[i]) === key) return true;
    }
    return false;
  }

  /* 清掉序号、学号、引号、多余空白等噪音，得到干净的名字 */
  function normalizeName(raw) {
    var text = String(raw == null ? '' : raw)
      .replace(/\u00a0/g, ' ')
      .replace(/[\u3000\t]/g, ' ')
      .replace(/^[\s"'“”‘’《》【】\[\]()（）]+/, '')
      .replace(/[\s"'“”‘’《》【】\[\]()（）]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    /* 「第3号 张三」这种写法 */
    text = text.replace(/^第\s*\d{1,12}\s*号\s*/, '');
    /* 行首的序号或学号：1.张三 / 1、张三 / 1 张三 / 2026001 张三 */
    text = text.replace(/^第?\s*\d{1,12}\s*(?=[.、,，:：)）]|\s)/, '');
    text = text.replace(/^[.、,，:：)）\-–—•*·\s]+/, '').trim();
    /* 「张三同学」这种写法去掉后缀（剩下的部分太短就保留原样） */
    var suffix = /(同学|学生)$/.exec(text);
    if (suffix && text.length - suffix[0].length >= 2) text = text.slice(0, text.length - suffix[0].length);
    return text;
  }

  /** 已经过 normalizeName 的文本是否像一个人名 */
  function isNameLike(text) {
    var t = trim(text);
    if (!t || isStopWord(t)) return false;
    if (/\d/.test(t)) return false;
    if (t.length >= 3 && /[班系院级组队]$/.test(t)) return false;
    if (CN_NAME_RE.test(t) || CN_DOT_NAME_RE.test(t)) return true;
    if (EN_NAME_RE.test(t) && /[A-Za-z]{2}/.test(t)) return true;
    return false;
  }

  /** 纯数字或纯符号（学号、序号、占位符），静默忽略 */
  function isNumericNoise(text) {
    return /^(?:\d+|[-–—+*/\\|.、,，:：()（）]+)$/.test(trim(text));
  }

  /**
   * 把一段文本拆成姓名：支持每行一个，也支持用逗号、顿号、分号、空格分隔
   * 返回 { names, dropped, skipped, duplicates }
   *   dropped    —— 看起来不是姓名、也没有被识别为学号/表头的内容（会在提示里列出）
   *   skipped    —— 学号、表头、统计行等明显不是姓名的内容（静默忽略）
   *   duplicates —— 输入里重复出现的次数
   */
  function parseNames(text) {
    var raw = String(text == null ? '' : text);
    var tokens = [];
    raw.split(/[\r\n;；,，、|｜]+/).forEach(function (chunk) {
      String(chunk).split(/\s+/).forEach(function (piece) {
        if (trim(piece)) tokens.push(piece);
      });
    });
    return pickNames(tokens);
  }

  function pickNames(tokens) {
    var result = { names: [], dropped: [], skipped: 0, duplicates: 0 };
    var seen = {};
    tokens.forEach(function (token) {
      var text = trim(token);
      if (!text) return;
      var name = normalizeName(text);
      if (!name) { result.skipped++; return; }
      if (isStopWord(name) || isNumericNoise(name)) { result.skipped++; return; }
      if (!isNameLike(name)) { result.dropped.push(text); return; }
      if (seen[name]) { result.duplicates++; return; }
      seen[name] = 1;
      result.names.push(name);
    });
    return result;
  }

  /* -------------------------------------------------------- 表格里的姓名列 */

  function toRows(rows) {
    return (rows || []).map(function (row) {
      return (row || []).map(function (cell) { return trim(cell); });
    });
  }

  /** 找出表头行（某一行里有「姓名」这类列标题）；找不到返回 -1 */
  function findHeaderRow(rows) {
    var limit = Math.min(rows.length, 10);
    for (var r = 0; r < limit; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        if (isNameHeader(rows[r][c])) return r;
      }
    }
    return -1;
  }

  /**
   * 分析整张表，给出每个候选列的情况，并挑出最像「姓名」的一列。
   * 返回 { headerRow, columns: [{ index, header, headerMatch, names, valid, total, samples }], best }
   */
  function analyzeRows(input) {
    var rows = toRows(input);
    var width = 0;
    rows.forEach(function (row) { width = Math.max(width, row.length); });
    var headerRow = findHeaderRow(rows);
    var columns = [];

    for (var c = 0; c < width; c++) {
      var tokens = [];
      var total = 0;
      var samples = [];
      for (var r = 0; r < rows.length; r++) {
        if (r === headerRow) continue;
        if (headerRow >= 0 && r < headerRow) continue;
        var cell = rows[r][c];
        if (!cell) continue;
        total++;
        if (samples.length < 5) samples.push(cell);
        cell.split(/\s+/).forEach(function (piece) { if (piece) tokens.push(piece); });
      }
      var picked = pickNames(tokens);
      columns.push({
        index: c,
        header: headerRow >= 0 ? rows[headerRow][c] : '',
        headerMatch: headerRow >= 0 && isNameHeader(rows[headerRow][c]),
        names: picked.names,
        valid: picked.names.length,
        total: total,
        samples: samples
      });
    }

    var best = -1;
    var bestScore = 0;
    columns.forEach(function (column) {
      if (!column.valid) return;
      var ratio = column.total ? column.valid / column.total : 0;
      var score = column.valid * 10 + (column.headerMatch ? 100 : 0) + Math.round(ratio * 20);
      if (score > bestScore) { bestScore = score; best = column.index; }
    });

    return { headerRow: headerRow, columns: columns, best: best };
  }

  /** 取出姓名：columnIndex >= 0 取该列，传 -1 表示把整张表里所有像姓名的内容都取出来 */
  function extractNames(input, columnIndex) {
    var rows = toRows(input);
    var headerRow = findHeaderRow(rows);
    var tokens = [];
    rows.forEach(function (row, r) {
      if (r === headerRow) return;
      if (headerRow >= 0 && r < headerRow) return;
      row.forEach(function (cell, c) {
        if (!cell) return;
        if (columnIndex >= 0 && c !== columnIndex) return;
        cell.split(/\s+/).forEach(function (piece) { if (piece) tokens.push(piece); });
      });
    });
    return pickNames(tokens);
  }

  /* ------------------------------------------------------------- 随机数 */

  function randInt(max) {
    if (max <= 1) return 0;
    var cryptoObj = global.crypto || global.msCrypto;
    if (cryptoObj && cryptoObj.getRandomValues) {
      var buf = new Uint32Array(1);
      /* 拒绝采样去掉取模偏差，保证每个人被抽到的概率一样 */
      var limit = Math.floor(4294967296 / max) * max;
      var value;
      do { cryptoObj.getRandomValues(buf); value = buf[0]; } while (value >= limit);
      return value % max;
    }
    return Math.floor(Math.random() * max);
  }

  /** 从列表里随机取 count 个（不放回，顺序也是随机的） */
  function sample(list, count) {
    var arr = (list || []).slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = randInt(i + 1);
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr.slice(0, Math.max(0, Math.min(count, arr.length)));
  }

  /* ------------------------------------------------------- 状态与持久化 */

  var state = {
    names: [],
    drawn: [],
    history: [],
    settings: { count: 1, avoidRepeat: true, animate: true }
  };

  var listeners = [];

  function onChange(fn) { listeners.push(fn); }

  function emit() {
    listeners.slice().forEach(function (fn) {
      try { fn(state); } catch (err) { console.error(err); }
    });
  }

  function sanitizeNames(list) {
    var out = [];
    (list || []).forEach(function (item) {
      var name = trim(item);
      if (!name) return;
      out.push(name);
    });
    return uniq(out).slice(0, MAX_NAMES);
  }

  function mergeSettings(input) {
    var src = input || {};
    return {
      count: clampInt(src.count, 1, MAX_NAMES, 1),
      avoidRepeat: src.avoidRepeat !== false,
      animate: src.animate !== false
    };
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      var names = sanitizeNames(data.names);
      state.names = names;
      state.drawn = sanitizeNames(data.drawn).filter(function (name) { return names.indexOf(name) >= 0; });
      state.history = (data.history || []).slice(0, HISTORY_LIMIT).map(function (entry) {
        return {
          at: entry && entry.at ? String(entry.at) : new Date().toISOString(),
          names: sanitizeNames(entry && entry.names),
          pool: clampInt(entry && entry.pool, 0, MAX_NAMES, 0)
        };
      }).filter(function (entry) { return entry.names.length; });
      state.settings = mergeSettings(data.settings);
      return true;
    } catch (err) {
      console.warn('读取点名名单失败：', err);
      return false;
    }
  }

  function save() {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        names: state.names,
        drawn: state.drawn,
        history: state.history,
        settings: state.settings
      }));
    } catch (err) {
      console.warn('保存点名名单失败（可能是浏览器禁用了本地存储）：', err);
    }
    emit();
  }

  /* --------------------------------------------------------- 名单增删改 */

  /** 追加姓名，返回 { added: [新增的], duplicates: [名单里已有的] } */
  function addNames(list, options) {
    var added = [];
    var duplicates = [];
    sanitizeNames(list).forEach(function (name) {
      if (state.names.indexOf(name) >= 0) { duplicates.push(name); return; }
      if (state.names.length >= MAX_NAMES) return;
      state.names.push(name);
      added.push(name);
    });
    if (!options || options.save !== false) save();
    return { added: added, duplicates: duplicates };
  }

  /** 用一份新名单替换现有名单，返回 { added, removed } */
  function setNames(list, options) {
    var before = state.names.slice();
    var names = sanitizeNames(list);
    state.names = names;
    state.drawn = state.drawn.filter(function (name) { return names.indexOf(name) >= 0; });
    if (!options || options.save !== false) save();
    return {
      added: names.filter(function (name) { return before.indexOf(name) < 0; }),
      removed: before.filter(function (name) { return names.indexOf(name) < 0; })
    };
  }

  function removeName(name, options) {
    var index = state.names.indexOf(name);
    if (index < 0) return false;
    state.names.splice(index, 1);
    state.drawn = state.drawn.filter(function (item) { return item !== name; });
    if (!options || options.save !== false) save();
    return true;
  }

  function clearNames(options) {
    state.names = [];
    state.drawn = [];
    if (!options || options.save !== false) save();
  }

  function hasName(name) { return state.names.indexOf(name) >= 0; }

  function sorted() { return state.names.slice().sort(function (a, b) { return String(a).localeCompare(String(b), 'zh-Hans-CN'); }); }

  /* --------------------------------------------------------- 本轮抽取状态 */

  function isDrawn(name) { return state.drawn.indexOf(name) >= 0; }

  /** 切换某个人的「本轮已抽」标记（例如同学请假，可以手动取消） */
  function toggleDrawn(name, options) {
    if (!hasName(name)) return false;
    if (isDrawn(name)) state.drawn = state.drawn.filter(function (item) { return item !== name; });
    else state.drawn.push(name);
    if (!options || options.save !== false) save();
    return true;
  }

  function clearDrawn(options) {
    state.drawn = [];
    if (!options || options.save !== false) save();
  }

  /** 候选池：开了「本轮不重复」就排除已抽到的人 */
  function candidates() {
    if (!state.settings.avoidRepeat) return state.names.slice();
    return state.names.filter(function (name) { return state.drawn.indexOf(name) < 0; });
  }

  function setSettings(patch, options) {
    state.settings = mergeSettings(Object.assign({}, state.settings, patch));
    if (!options || options.save !== false) save();
    return state.settings;
  }

  /**
   * 抽 count 个人（一次抽取内不会重复，顺序即抽到的顺序）。
   * 返回 { picked, want, poolSize, shortage, drained }
   *   shortage —— 候选池不够，实际少抽了几个
   *   drained  —— 候选池已经空了（本轮所有人都抽过了）
   */
  function draw(count, options) {
    var pool = candidates();
    var want = clampInt(count, 1, MAX_NAMES, 1);
    var picked = sample(pool, want);
    var at = new Date().toISOString();

    if (picked.length) {
      if (state.settings.avoidRepeat) {
        picked.forEach(function (name) {
          if (state.drawn.indexOf(name) < 0) state.drawn.push(name);
        });
      }
      state.history.unshift({ at: at, names: picked.slice(), pool: pool.length });
      state.history = state.history.slice(0, HISTORY_LIMIT);
    }
    if (!options || options.save !== false) save();

    return {
      picked: picked,
      want: want,
      poolSize: pool.length,
      shortage: want - picked.length,
      drained: pool.length > 0 && pool.length === picked.length
    };
  }

  function clearHistory(options) {
    state.history = [];
    if (!options || options.save !== false) save();
  }

  /* --------------------------------------------------------------- 导出 */

  function toText() {
    return state.names.join('\n');
  }

  function historyText() {
    return state.history.map(function (entry) {
      return formatTime(entry.at) + '\t' + entry.names.join('、');
    }).join('\n');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function formatTime(iso) {
    var date = iso ? new Date(iso) : new Date();
    if (isNaN(date.getTime())) return '';
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
      ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  global.Roster = {
    STORAGE_KEY: STORAGE_KEY,
    NAME_HEADERS: NAME_HEADERS,
    state: state,
    onChange: onChange,
    emit: emit,
    load: load,
    save: save,
    trim: trim,
    clampInt: clampInt,
    normalizeName: normalizeName,
    isNameLike: isNameLike,
    isNameHeader: isNameHeader,
    isStopWord: isStopWord,
    parseNames: parseNames,
    analyzeRows: analyzeRows,
    extractNames: extractNames,
    sample: sample,
    randInt: randInt,
    addNames: addNames,
    setNames: setNames,
    removeName: removeName,
    clearNames: clearNames,
    hasName: hasName,
    sorted: sorted,
    isDrawn: isDrawn,
    toggleDrawn: toggleDrawn,
    clearDrawn: clearDrawn,
    candidates: candidates,
    setSettings: setSettings,
    draw: draw,
    clearHistory: clearHistory,
    toText: toText,
    historyText: historyText,
    formatTime: formatTime
  };
})(window);
