/*!
 * sheet.js — 表格文件读取（Excel / CSV → 二维数组）
 * 把上传的文件读成二维数组，处理合并单元格和 CSV 编码。
 * 无构建依赖，直接以普通 script 加载，暴露全局 Sheet。
 * 依赖 vendor/xlsx.full.min.js（SheetJS，本地内置，离线可用）。
 */
(function (global) {
  'use strict';

  var XLSX = global.XLSX;

  function trim(value) {
    return String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  }

  function decodeText(buffer, encoding) {
    try {
      return new TextDecoder(encoding, { fatal: false }).decode(buffer);
    } catch (err) {
      return '';
    }
  }

  /** CSV 常常是 GBK 编码（Excel 另存为 CSV 的默认行为），这里先按 UTF-8 试，失败再按 GBK 解 */
  function readCsvText(buffer) {
    var utf8 = decodeText(buffer, 'utf-8');
    if (utf8 && utf8.indexOf('\ufffd') === -1) return utf8;
    var gbk = decodeText(buffer, 'gbk');
    return gbk || utf8;
  }

  /** 读取上传的文件，返回 SheetJS 的 workbook（Promise） */
  function readWorkbook(file) {
    return new Promise(function (resolve, reject) {
      if (!XLSX) { reject(new Error('Excel 解析库未加载（vendor/xlsx.full.min.js）')); return; }
      var isCsv = /\.(csv|txt)$/i.test(file.name || '') || /text\/(csv|plain)/i.test(file.type || '');
      var reader = new FileReader();
      reader.onload = function (event) {
        try {
          var wb;
          if (isCsv) {
            var text = readCsvText(event.target.result);
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            /* raw:true 关掉 SheetJS 对纯文本的自动类型猜测，
               否则「5-6」这种节次会被当成日期 5月6日 */
            wb = XLSX.read(text, { type: 'string', raw: true });
          } else {
            wb = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
          }
          resolve(wb);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = function () { reject(reader.error || new Error('读取文件失败')); };
      reader.readAsArrayBuffer(file);
    });
  }

  /** 工作表 → 二维数组；合并单元格的值回填到整个合并区域，每行补齐到相同列数 */
  function worksheetToAoa(ws) {
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true, raw: false });
    var rows = aoa.map(function (row) {
      return (row || []).map(function (cell) {
        return trim(cell == null ? '' : String(cell));
      });
    });

    var merges = ws['!merges'] || [];
    merges.forEach(function (m) {
      var value = rows[m.s.r] ? trim(rows[m.s.r][m.s.c]) : '';
      if (!value) return;
      for (var r = m.s.r; r <= m.e.r; r++) {
        if (!rows[r]) rows[r] = [];
        for (var c = m.s.c; c <= m.e.c; c++) {
          if (r === m.s.r && c === m.s.c) continue;
          if (!trim(rows[r][c])) rows[r][c] = value;
        }
      }
    });

    var width = 0;
    rows.forEach(function (row) { width = Math.max(width, row.length); });
    rows.forEach(function (row) {
      while (row.length < width) row.push('');
    });
    return rows;
  }

  global.Sheet = {
    readWorkbook: readWorkbook,
    worksheetToAoa: worksheetToAoa
  };
})(window);
