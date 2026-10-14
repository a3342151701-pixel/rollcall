/*!
 * rollcall.js — 随机点名页面的界面与交互
 * 名单的增删、从花名册文件导入、随机抽取与结果展示、抽取记录。
 * 依赖 js/sheet.js（读文件）、js/roster.js（名单与抽取逻辑）。
 */
(function () {
  'use strict';

  var $ = function (selector) { return document.querySelector(selector); };
  var $$ = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };

  var ROLL_MS = 1000;      /* 名字滚动的时长 */
  var ROLL_TICK = 70;      /* 滚动时换名字的间隔 */
  var PREVIEW_LIMIT = 80;  /* 导入预览最多显示多少个名字 */

  var ui = {
    picked: [],
    animating: false
  };

  var rollTimer = null;
  var rollStopTimer = null;

  function settings() { return Roster.state.settings; }

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(message, isError) {
    var wrap = $('#toastWrap');
    var el = document.createElement('div');
    el.className = 'toast' + (isError ? ' is-error' : '');
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 260);
    }, isError ? 4200 : 2600);
  }

  function countOf(value) {
    return Roster.clampInt(value, 1, Math.max(1, Roster.state.names.length || 1), 1);
  }

  /* ------------------------------------------------------------- 渲染 */

  function renderNames() {
    var container = $('#rollNames');
    var names = Roster.state.names;
    if (!names.length) {
      container.innerHTML = '<p class="empty-hint">名单还是空的：在上面输入姓名，粘贴一批名字，或者导入花名册文件（Excel / CSV / txt 都支持）。</p>';
      return;
    }
    container.innerHTML = names.map(function (name) {
      var drawn = Roster.isDrawn(name);
      return '<span class="name-chip' + (drawn ? ' is-drawn' : '') + '" data-name="' + esc(name) + '">' +
        '<button type="button" class="name-chip-main" data-act="toggle" title="' +
          (drawn ? '本轮已经抽到了，点一下取消标记' : '点一下标记为本轮已抽') + '">' + esc(name) + '</button>' +
        '<button type="button" class="name-chip-del" data-act="remove" title="从名单里删除">×</button>' +
      '</span>';
    }).join('');
  }

  function renderResult() {
    var container = $('#rollResult');
    if (!ui.picked.length) {
      container.innerHTML = '<p class="roll-placeholder">点上面的「开始抽取」，被点到的名字会显示在这里。</p>';
      return;
    }
    container.innerHTML = ui.picked.map(function (name, index) {
      return '<span class="pick-card' + (ui.animating ? ' is-rolling' : '') + '">' +
        '<i>' + (index + 1) + '</i>' + esc(name) + '</span>';
    }).join('');
  }

  function renderHistory() {
    var container = $('#rollHistory');
    var history = Roster.state.history;
    if (!history.length) {
      container.innerHTML = '<p class="empty-hint">还没有抽取记录。</p>';
      return;
    }
    container.innerHTML = history.map(function (entry, index) {
      return '<div class="history-item">' +
        '<div class="history-meta"><span>' + esc(Roster.formatTime(entry.at)) + '</span>' +
          '<span class="history-count">' + entry.names.length + ' 人' +
            (entry.pool ? ' / 候选 ' + entry.pool + ' 人' : '') + '</span>' +
          '<button type="button" class="mini" data-history="' + index + '">复制</button>' +
        '</div>' +
        '<div class="history-names">' + entry.names.map(esc).join('、') + '</div>' +
      '</div>';
    }).join('');
  }

  function renderControls() {
    var names = Roster.state.names;
    var candidates = Roster.candidates();
    var drawn = Roster.state.drawn.length;

    $('#rollCount').textContent = '共 ' + names.length + ' 人';
    $('#rollPool').textContent = settings().avoidRepeat
      ? '候选 ' + candidates.length + ' 人 · 已抽 ' + drawn + ' 人'
      : '候选 ' + candidates.length + ' 人（可重复抽）';

    $('#rollFooter').textContent = '名单 ' + names.length + ' 人 · 本轮已抽 ' + drawn + ' 人 · 剩余 ' +
      (settings().avoidRepeat ? candidates.length : names.length) + ' 人 · 抽取记录 ' + Roster.state.history.length + ' 条';

    var input = $('#rollCountInput');
    input.max = String(Math.max(1, names.length));
    if (document.activeElement !== input) input.value = String(settings().count);

    $('#rollAvoid').checked = settings().avoidRepeat;
    $('#rollAnimate').checked = settings().animate;

    $('#rollStart').textContent = ui.animating ? '抽取中…'
      : (settings().avoidRepeat && names.length && !candidates.length ? '本轮已抽完 · 重置本轮' : '开始抽取');
  }

  function render() {
    renderNames();
    renderResult();
    renderHistory();
    renderControls();
  }

  /* --------------------------------------------------------------- 名字 */

  function reportParse(result, options) {
    var notes = [];
    if (result.skipped) notes.push('忽略了 ' + result.skipped + ' 项学号/表头等非姓名内容');
    if (result.duplicates) notes.push('去掉了 ' + result.duplicates + ' 个重复名字');
    if (result.dropped.length) {
      notes.push('跳过 ' + result.dropped.length + ' 项看起来不是姓名的内容（如 ' +
        result.dropped.slice(0, 5).map(esc).join('、') + '）');
    }
    if (options && options.addedCount) notes.push('新增 ' + options.addedCount + ' 人');
    return notes;
  }

  function addFromText(text, replace) {
    var parsed = Roster.parseNames(text);
    if (!parsed.names.length) {
      if (parsed.dropped.length) toast('没有识别出姓名，请检查内容（每行一个名字最稳妥）', true);
      else toast('没有可添加的新名字', true);
      return;
    }
    var added;
    if (replace) {
      Roster.setNames(parsed.names, { save: false });
      added = parsed.names.length;
    } else {
      added = Roster.addNames(parsed.names, { save: false }).added.length;
    }
    var notes = reportParse(parsed, { addedCount: added });
    Roster.save();
    var message = (replace ? '已用新名单替换：' : '已添加：') + added + ' 人';
    toast(notes.length ? message + '（' + notes.join('；') + '）' : message);
  }

  function addSingleName() {
    var input = $('#rollNameInput');
    var text = Roster.trim(input.value);
    if (!text) { input.focus(); return; }
    var parsed = Roster.parseNames(text);
    if (!parsed.names.length) {
      toast('「' + text + '」看起来不是姓名，请检查一下', true);
      return;
    }
    var result = Roster.addNames(parsed.names, { save: false });
    Roster.save();
    input.value = '';
    input.focus();
    if (!result.added.length) toast('「' + parsed.names.join('、') + '」已经在名单里了', true);
    else toast('已添加：' + result.added.join('、') + (result.duplicates.length ? '（' + result.duplicates.length + ' 个已在名单里）' : ''));
  }

  /* --------------------------------------------------------------- 抽取 */

  function stopRolling() {
    if (rollTimer) { clearInterval(rollTimer); rollTimer = null; }
    if (rollStopTimer) { clearTimeout(rollStopTimer); rollStopTimer = null; }
    ui.animating = false;
  }

  function finishDraw(want) {
    var result = Roster.draw(want, { save: false });
    ui.picked = result.picked;
    Roster.save();
    if (!result.picked.length) return;

    var messages = ['抽到 ' + result.picked.length + ' 人：' + result.picked.join('、')];
    if (result.shortage > 0) messages.push('候选只剩 ' + result.poolSize + ' 人，少抽了 ' + result.shortage + ' 个');
    if (result.drained && Roster.state.settings.avoidRepeat) messages.push('本轮所有人都抽过了，可点「重置本轮」重新开始');
    toast(messages.join('；'), result.shortage > 0);
  }

  function startDraw() {
    if (ui.animating) return;
    var names = Roster.state.names;
    if (!names.length) { toast('请先添加待点名名单', true); return; }

    var avoid = settings().avoidRepeat;
    var pool = Roster.candidates();
    if (!pool.length) {
      toast('本轮所有人都抽过了，已为你重置本轮', false);
      Roster.clearDrawn();
      pool = Roster.candidates();
    }

    var want = countOf($('#rollCountInput').value);
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!settings().animate || reduceMotion) { finishDraw(want); return; }

    var slots = Math.min(want, pool.length);
    ui.animating = true;
    renderControls();
    rollTimer = setInterval(function () {
      ui.picked = Roster.sample(pool, slots);
      renderResult();
    }, ROLL_TICK);
    rollStopTimer = setTimeout(function () {
      stopRolling();
      finishDraw(want);
    }, ROLL_MS);
  }

  /* ----------------------------------------------------------- 复制 / 导出 */

  function copyText(text, message) {
    function fallback() {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); } catch (err) { /* 忽略 */ }
      area.remove();
      toast(message);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(message); }).catch(fallback);
    } else {
      fallback();
    }
  }

  function downloadText(filename, text) {
    var blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function stamp() {
    var d = new Date();
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  /* --------------------------------------------------- 从花名册文件导入 */

  function openImportDialog(wb, fileName) {
    var dialog = {
      sheet: wb.SheetNames[0],
      column: -1,
      merge: 'append',
      names: [],
      result: null,
      analyzed: false
    };

    openModal(
      '<div class="modal-head"><div><h2>从花名册导入名单</h2><p>' + esc(fileName) + '</p></div>' +
        '<button type="button" class="icon-btn" data-close>×</button></div>' +
      '<div class="modal-body">' +
        (wb.SheetNames.length > 1
          ? '<div class="option-row"><span class="option-label">工作表</span>' +
            '<select class="input" id="rosSheet">' + wb.SheetNames.map(function (name) {
              return '<option value="' + esc(name) + '">' + esc(name) + '</option>';
            }).join('') + '</select></div>'
          : '') +
        '<div class="option-row"><span class="option-label">姓名所在列</span>' +
          '<select class="input" id="rosColumn" style="flex:1 1 260px"></select></div>' +
        '<div class="option-row"><span class="option-label">导入方式</span>' +
          '<div class="radio-group" id="rosMerge">' +
            '<label data-merge="append" class="is-active"><input type="radio" name="rosMerge" value="append" checked>追加到现有名单</label>' +
            '<label data-merge="replace"><input type="radio" name="rosMerge" value="replace">替换现有名单</label>' +
          '</div></div>' +
        '<div id="rosResult"></div>' +
      '</div>' +
      '<div class="modal-foot"><span class="spacer"></span>' +
        '<button type="button" class="btn" data-close>取消</button>' +
        '<button type="button" class="btn primary" id="rosConfirm">导入</button>' +
      '</div>'
    );

    var modal = $('#modal');
    var confirmBtn = $('#rosConfirm');

    function buildColumnOptions(analysis) {
      var select = $('#rosColumn');
      var options = ['<option value="-1">整张表：取出所有列里像姓名的内容</option>'];
      analysis.columns.forEach(function (column) {
        if (!column.valid) return;
        var label = '第 ' + (column.index + 1) + ' 列' +
          (column.header ? '「' + column.header + '」' : '') +
          '：' + column.valid + ' 个姓名' +
          (column.samples.length ? '（如 ' + column.samples.slice(0, 3).join('、') + '）' : '');
        options.push('<option value="' + column.index + '">' + esc(label) + '</option>');
      });
      select.innerHTML = options.join('');
      return select;
    }

    function rows() {
      return Sheet.worksheetToAoa(wb.Sheets[dialog.sheet]);
    }

    function refresh(keepColumn) {
      var sheetRows = rows();
      var analysis = Roster.analyzeRows(sheetRows);
      var select = buildColumnOptions(analysis);
      var wanted = keepColumn && dialog.column >= 0 ? String(dialog.column) : String(analysis.best >= 0 ? analysis.best : -1);
      select.value = select.querySelector('option[value="' + wanted + '"]') ? wanted : '-1';
      dialog.column = parseInt(select.value, 10);
      dialog.result = Roster.extractNames(sheetRows, dialog.column);
      dialog.names = dialog.result.names;
      renderPreview(analysis, sheetRows);
    }

    function renderPreview(analysis, sheetRows) {
      var html = [];
      if (!analysis.columns.some(function (column) { return column.valid; })) {
        html.push('<div class="notice error">这张表里没有找到像姓名的内容，可以换一个工作表，或者改用「批量添加」把名字粘贴进来。</div>');
      } else {
        var columnText = dialog.column >= 0 ? '第 ' + (dialog.column + 1) + ' 列' : '整张表';
        html.push('<div class="notice">从' + columnText + '里识别出 <b>' + dialog.names.length + '</b> 个姓名' +
          (analysis.headerRow >= 0 ? '（第 ' + (analysis.headerRow + 1) + ' 行是表头）' : '') + '。</div>');
      }

      var notes = reportParse(dialog.result);
      var inList = dialog.result.names.filter(function (name) { return Roster.hasName(name); });
      if (!dialog.merge || dialog.merge === 'append') {
        if (inList.length) notes.push('其中 ' + inList.length + ' 人已经在名单里');
      }
      if (notes.length) {
        html.push('<div class="notice warn"><ul>' + notes.map(function (note) {
          return '<li>' + note + '</li>';
        }).join('') + '</ul></div>');
      }

      if (dialog.names.length) {
        var shown = dialog.names.slice(0, PREVIEW_LIMIT);
        html.push('<div class="name-preview">' + shown.map(function (name) {
          return '<span class="name-chip is-plain">' + esc(name) + '</span>';
        }).join('') + '</div>');
        if (dialog.names.length > shown.length) {
          html.push('<p class="hint">仅预览前 ' + shown.length + ' 个，共 ' + dialog.names.length + ' 个。</p>');
        }
      }

      var preview = sheetRows.filter(function (row) { return row.some(function (cell) { return Roster.trim(cell); }); }).slice(0, 6);
      if (preview.length) {
        html.push('<details style="margin-top:12px"><summary style="cursor:pointer;color:var(--text-soft);font-size:12.5px">查看这张表的前几行</summary>' +
          '<div class="preview-wrap" style="margin-top:8px"><table class="preview-table"><tbody>' +
          preview.map(function (row, r) {
            return '<tr>' + row.map(function (cell, c) {
              var isPicked = analysis.headerRow !== r && (dialog.column < 0 || dialog.column === c) && Roster.isNameLike(Roster.normalizeName(cell));
              return '<td' + (Roster.trim(cell) ? (isPicked ? ' class="is-picked"' : '') : ' class="is-empty"') + '>' + esc(cell) + '</td>';
            }).join('') + '</tr>';
          }).join('') + '</tbody></table></div></details>');
      }

      $('#rosResult').innerHTML = html.join('');
      confirmBtn.disabled = !dialog.names.length;
    }

    function doImport() {
      if (!dialog.names.length) return;
      var message;
      if (dialog.merge === 'replace') {
        Roster.setNames(dialog.names, { save: false });
        Roster.clearDrawn({ save: false });
        message = '已用花名册替换名单：' + dialog.names.length + ' 人';
      } else {
        var result = Roster.addNames(dialog.names, { save: false });
        message = '已从花名册添加 ' + result.added.length + ' 人' +
          (result.duplicates.length ? '（' + result.duplicates.length + ' 人已在名单里）' : '');
      }
      Roster.save();
      closeModal();
      toast(message);
    }

    modal.addEventListener('change', function (event) {
      var target = event.target;
      if (target.id === 'rosSheet') {
        dialog.sheet = target.value;
        dialog.column = -1;
        refresh(false);
        return;
      }
      if (target.id === 'rosColumn') {
        var pickedRows = rows();
        dialog.column = parseInt(target.value, 10);
        dialog.result = Roster.extractNames(pickedRows, dialog.column);
        dialog.names = dialog.result.names;
        renderPreview(Roster.analyzeRows(pickedRows), pickedRows);
        return;
      }
      if (target.name === 'rosMerge') {
        dialog.merge = target.value;
        $$('#rosMerge label').forEach(function (label) {
          label.classList.toggle('is-active', label.dataset.merge === dialog.merge);
        });
        var mergeRows = rows();
        renderPreview(Roster.analyzeRows(mergeRows), mergeRows);
      }
    });

    modal.addEventListener('click', function (event) {
      if (event.target.closest('#rosConfirm')) { doImport(); return; }
      if (event.target.closest('[data-close]')) closeModal();
    });

    refresh(false);
  }

  function handleRosterFile(file) {
    if (!file) return;
    toast('正在解析「' + file.name + '」…');
    Sheet.readWorkbook(file).then(function (wb) {
      if (!wb.SheetNames.length) throw new Error('文件里没有工作表');
      openImportDialog(wb, file.name);
    }).catch(function (err) {
      toast('导入失败：' + (err && err.message ? err.message : err), true);
    });
  }

  /* ---------------------------------------------------------------- 弹窗 */

  function openModal(html) {
    $('#modal').innerHTML = html;
    $('#modalMask').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    $('#modalMask').hidden = true;
    $('#modal').innerHTML = '';
    document.body.style.overflow = '';
  }

  /* ------------------------------------------------------------ 事件绑定 */

  function bindEvents() {
    $('#rollAddBtn').addEventListener('click', addSingleName);
    $('#rollNameInput').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); addSingleName(); }
    });

    $('#rollBulkAdd').addEventListener('click', function () {
      addFromText($('#rollBulk').value, false);
    });
    $('#rollBulkReplace').addEventListener('click', function () {
      var text = $('#rollBulk').value;
      if (!Roster.trim(text)) { toast('请先把名单粘贴到上面的输入框里', true); return; }
      var parsed = Roster.parseNames(text);
      if (!parsed.names.length) { toast('没有识别出姓名，请检查内容', true); return; }
      confirmDialog('替换整个名单', '将用输入框里的 ' + parsed.names.length + ' 个名字替换当前名单（当前 ' +
        Roster.state.names.length + ' 人），并清空本轮已抽记录。确定继续吗？', '替换').then(function (ok) {
        if (!ok) return;
        Roster.setNames(parsed.names, { save: false });
        Roster.clearDrawn({ save: false });
        Roster.save();
        toast('已替换名单：' + parsed.names.length + ' 人');
      });
    });

    var importFile = function () { $('#fileRoster').click(); };
    $('#btnImport').addEventListener('click', importFile);
    $('#rollImport2').addEventListener('click', importFile);
    $('#fileRoster').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = '';
      handleRosterFile(file);
    });

    /* 名单里的名字：点击切换「本轮已抽」，点 × 删除 */
    $('#rollNames').addEventListener('click', function (event) {
      var chip = event.target.closest('.name-chip[data-name]');
      if (!chip) return;
      var name = chip.dataset.name;
      var button = event.target.closest('button[data-act]');
      if (!button) return;
      if (button.dataset.act === 'remove') {
        Roster.removeName(name);
        toast('已从名单里删除「' + name + '」');
        return;
      }
      Roster.toggleDrawn(name);
    });

    /* 抽取人数 */
    $('#rollCountInput').addEventListener('change', function (event) {
      Roster.setSettings({ count: countOf(event.target.value) });
    });
    $('#rollMinus').addEventListener('click', function () {
      Roster.setSettings({ count: Math.max(1, settings().count - 1) });
    });
    $('#rollPlus').addEventListener('click', function () {
      Roster.setSettings({ count: settings().count + 1 });
    });
    $('#rollQuick').addEventListener('click', function (event) {
      var button = event.target.closest('button[data-count]');
      if (!button) return;
      if (button.dataset.count === 'all') {
        var pool = settings().avoidRepeat ? Roster.candidates().length : Roster.state.names.length;
        if (!pool) { toast('名单是空的', true); return; }
        Roster.setSettings({ count: pool });
        toast('已设为剩余全部：' + pool + ' 人');
        return;
      }
      Roster.setSettings({ count: parseInt(button.dataset.count, 10) });
    });

    $('#rollAvoid').addEventListener('change', function (event) {
      Roster.setSettings({ avoidRepeat: event.target.checked });
      if (!event.target.checked) toast('已关闭「本轮不重复」：同一个人可能被重复抽到');
    });
    $('#rollAnimate').addEventListener('change', function (event) {
      Roster.setSettings({ animate: event.target.checked });
    });

    $('#rollStart').addEventListener('click', startDraw);

    $('#rollCopy').addEventListener('click', function () {
      if (!ui.picked.length) { toast('还没有抽取结果', true); return; }
      copyText(ui.picked.join('、'), '已复制 ' + ui.picked.length + ' 个名字');
    });

    $('#rollReset').addEventListener('click', function () {
      Roster.clearDrawn();
      toast('已重置本轮，所有人重新参与抽取');
    });

    $('#rollHistory').addEventListener('click', function (event) {
      var button = event.target.closest('button[data-history]');
      if (!button) return;
      var entry = Roster.state.history[parseInt(button.dataset.history, 10)];
      if (!entry) return;
      copyText(entry.names.join('、'), '已复制这条记录');
    });

    /* 更多菜单 */
    var moreMenu = $('#moreMenu');
    $('#btnMore').addEventListener('click', function (event) {
      event.stopPropagation();
      moreMenu.hidden = !moreMenu.hidden;
      $('#btnMore').setAttribute('aria-expanded', String(!moreMenu.hidden));
    });
    document.addEventListener('click', function (event) {
      if (!moreMenu.hidden && !event.target.closest('.dropdown')) {
        moreMenu.hidden = true;
        $('#btnMore').setAttribute('aria-expanded', 'false');
      }
    });
    moreMenu.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-act]');
      if (!button) return;
      var act = button.dataset.act;
      moreMenu.hidden = true;

      if (act === 'export-names') {
        if (!Roster.state.names.length) { toast('名单是空的', true); return; }
        downloadText('点名名单-' + stamp() + '.txt', Roster.state.names.join('\r\n'));
        toast('已导出名单（txt）');
        return;
      }
      if (act === 'export-history') {
        if (!Roster.state.history.length) { toast('还没有抽取记录', true); return; }
        downloadText('点名记录-' + stamp() + '.txt', Roster.historyText());
        toast('已导出抽取记录（txt）');
        return;
      }
      if (act === 'reset-round') {
        Roster.clearDrawn();
        toast('已重置本轮，所有人重新参与抽取');
        return;
      }
      if (act === 'clear-history') {
        confirmDialog('清空抽取记录', '将删除全部 ' + Roster.state.history.length + ' 条抽取记录，名单不受影响。', '清空记录').then(function (ok) {
          if (!ok) return;
          Roster.clearHistory();
          toast('已清空抽取记录');
        });
        return;
      }
      if (act === 'clear-names') {
        confirmDialog('清空整个名单', '将删除名单里的 ' + Roster.state.names.length + ' 人，并清空本轮已抽记录（抽取记录会保留）。', '清空名单', true).then(function (ok) {
          if (!ok) return;
          /* 先清掉界面上显示的结果，再清名单（清名单会立刻触发一次渲染） */
          ui.picked = [];
          Roster.clearNames();
          toast('已清空名单');
        });
      }
    });

    /* 弹窗遮罩与键盘 */
    $('#modalMask').addEventListener('click', function (event) {
      if (event.target === $('#modalMask')) closeModal();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (!$('#modalMask').hidden) { closeModal(); return; }
      if (!moreMenu.hidden) {
        moreMenu.hidden = true;
        $('#btnMore').setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------------------------------------------------------------- 启动 */

  function init() {
    Roster.load();
    Roster.onChange(function () { render(); });
    bindEvents();
    render();
  }

  function confirmDialog(title, message, okText, danger) {
    return new Promise(function (resolve) {
      openModal(
        '<div class="modal-head"><div><h2>' + esc(title) + '</h2></div></div>' +
        '<div class="modal-body"><p style="margin:0;color:var(--text-soft)">' + esc(message).replace(/\n/g, '<br>') + '</p></div>' +
        '<div class="modal-foot"><span class="spacer"></span>' +
          '<button type="button" class="btn" data-role="cancel">取消</button>' +
          '<button type="button" class="btn ' + (danger ? 'danger' : 'primary') + '" data-role="ok">' + esc(okText || '确定') + '</button>' +
        '</div>'
      );
      var modal = $('#modal');
      function done(value) {
        modal.removeEventListener('click', handler);
        closeModal();
        resolve(value);
      }
      function handler(event) {
        var role = event.target.dataset.role;
        if (role === 'ok') done(true);
        else if (role === 'cancel' || event.target.closest('[data-close]')) done(false);
      }
      modal.addEventListener('click', handler);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
