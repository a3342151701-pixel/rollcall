/*!
 * tools/gen-samples.js — 生成示例花名册文件（用于测试导入功能，也可给用户参考格式）
 * 运行：node tools/gen-samples.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');

const outDir = path.join(__dirname, '..', 'samples');
fs.mkdirSync(outDir, { recursive: true });

function buildSheet(aoa, options) {
  const opts = options || {};
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (opts.merges && opts.merges.length) ws['!merges'] = opts.merges;
  const width = aoa.reduce((max, row) => Math.max(max, row.length), 0);
  ws['!cols'] = Array.from({ length: width }, (_, i) => ({ wch: i === 0 ? 9 : (i === 1 ? 13 : 20) }));
  ws['!rows'] = aoa.map((_, i) => ({ hpt: i === 0 ? 20 : (opts.rowHeight || 22) }));
  return ws;
}

function save(filename, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(([name, ws]) => XLSX.utils.book_append_sheet(wb, ws, name));
  const target = path.join(outDir, filename);
  /* 注意：本地内置的社区版 SheetJS 在浏览器里用 XLSX.writeFile 下载，
     Node 下它拿不到 fs，所以这里用 XLSX.write 生成 Buffer 再自己写文件。 */
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer', compression: true });
  fs.writeFileSync(target, buffer);
  console.log('已生成', path.relative(path.join(__dirname, '..'), target));
}

/* ------------------------------------------------------------------
   示例：花名册（给「随机点名」页导入用）
   - 第 1 张表是常见的班级花名册：序号 / 学号 / 姓名 / 性别
   - 第 2 张表只有一列姓名
   - 另外生成一份 CSV 花名册（学号在姓名左边，用来测试自动找姓名列）
   ------------------------------------------------------------------ */
const ROSTER_NAMES = [
  ['张伟', '男'], ['李娜', '女'], ['王强', '男'], ['刘洋', '男'], ['陈刚', '男'],
  ['赵敏', '女'], ['孙丽', '女'], ['周涛', '男'], ['吴倩', '女'], ['郑凯', '男'],
  ['冯雪', '女'], ['林浩', '男'], ['黄婷', '女'], ['徐鹏', '男'], ['马颖', '女'],
  ['朱磊', '男'], ['胡静', '女'], ['郭扬', '男'], ['何薇', '女'], ['高翔', '男']
];

(function sampleRoster() {
  const classSheet = [['2026 级计算机科学与技术 1 班 花名册', '', '', ''], ['序号', '学号', '姓名', '性别']];
  ROSTER_NAMES.forEach(([name, sex], index) => {
    classSheet.push([index + 1, '2026' + String(index + 1).padStart(4, '0'), name, sex]);
  });

  const simpleSheet = [['姓名']].concat(ROSTER_NAMES.map(([name]) => [name]));

  save('示例-花名册.xlsx', [
    ['班级花名册', buildSheet(classSheet, { rowHeight: 20 })],
    ['只有姓名', buildSheet(simpleSheet, { rowHeight: 20 })]
  ]);

  const lines = ['学号,姓名,性别'].concat(
    ROSTER_NAMES.map(([name, sex], index) => '2026' + String(index + 1).padStart(4, '0') + ',' + name + ',' + sex)
  );
  const target = path.join(outDir, '示例-花名册.csv');
  fs.writeFileSync(target, '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
  console.log('已生成', path.relative(path.join(__dirname, '..'), target));
})();
