/*!
 * tools/test-roster.js — 无浏览器环境下验证 js/roster.js（点名名单、姓名解析、随机抽取）
 * 运行：node tools/test-roster.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

global.window = global;
global.XLSX = require('../vendor/xlsx.full.min.js');
global.localStorage = {
  _data: {},
  getItem(key) { return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null; },
  setItem(key, value) { this._data[key] = String(value); },
  removeItem(key) { delete this._data[key]; }
};

require('../js/sheet.js');
require('../js/roster.js');

const Sheet = global.Sheet;
const Roster = global.Roster;

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log('  ok  ' + label);
  } else {
    failed++;
    console.log('  FAIL ' + label + '\n        期望: ' + JSON.stringify(expected) + '\n        实际: ' + JSON.stringify(actual));
  }
}

function section(title) {
  console.log('\n== ' + title + ' ==');
}

/* ------------------------------------------------------------ 姓名清洗 */

section('姓名清洗（normalizeName）');
check('普通姓名', Roster.normalizeName('张三'), '张三');
check('去掉首尾空白', Roster.normalizeName('  李四 '), '李四');
check('去掉序号 1.', Roster.normalizeName('1. 张三'), '张三');
check('去掉序号 1、', Roster.normalizeName('1、张三'), '张三');
check('去掉序号 1 空格', Roster.normalizeName('3 王五'), '王五');
check('去掉学号', Roster.normalizeName('2026001 张三'), '张三');
check('去掉「第2号」', Roster.normalizeName('第2号 刘洋'), '刘洋');
check('去掉「同学」后缀', Roster.normalizeName('张三同学'), '张三');
check('去掉括号', Roster.normalizeName('（赵敏）'), '赵敏');
check('两位姓名不会被当成序号', Roster.normalizeName('2'), '2');
check('全角空格', Roster.normalizeName('周\u3000涛'), '周 涛');

section('姓名判断（isNameLike）');
check('两字姓名', Roster.isNameLike('张三'), true);
check('四字姓名', Roster.isNameLike('欧阳娜娜'), true);
check('少数民族姓名', Roster.isNameLike('阿依古丽·买买提'), true);
check('英文姓名', Roster.isNameLike('Linda'), true);
check('英文全名', Roster.isNameLike('Zhang San'), true);
check('单个字不算姓名', Roster.isNameLike('张'), false);
check('学号不算姓名', Roster.isNameLike('2026001'), false);
check('含数字不算姓名', Roster.isNameLike('张三2'), false);
check('性别不算姓名', Roster.isNameLike('男'), false);
check('表头不算姓名', Roster.isNameLike('姓名'), false);
check('备注不算姓名', Roster.isNameLike('备注'), false);
check('统计行不算姓名', Roster.isNameLike('平均分'), false);
check('班级不算姓名', Roster.isNameLike('计算机1班'), false);
check('表头判断：姓名', Roster.isNameHeader('姓名'), true);
check('表头判断：姓名（带空格）', Roster.isNameHeader(' 姓 名 '), true);
check('表头判断：Name', Roster.isNameHeader('name'), true);
check('表头判断：学号', Roster.isNameHeader('学号'), false);

section('粘贴文本解析（parseNames）');
const pasted = Roster.parseNames([
  '张三',
  '李四、王五',
  '赵敏 孙丽',
  '2026001 周涛',
  '学号,姓名',
  '备注',
  '6',
  '吴倩',
  '张三'
].join('\n'));
check('解析出的姓名（按顺序、去重）', pasted.names, ['张三', '李四', '王五', '赵敏', '孙丽', '周涛', '吴倩']);
check('忽略的学号 / 表头 / 性别等项数', pasted.skipped, 5);
check('输入里重复的名字数', pasted.duplicates, 1);
check('没有识别失败的残留内容', pasted.dropped, []);

const messy = Roster.parseNames('张三\n这是一句说明不是名字\n李四');
check('看不懂的内容会被列出来', messy.dropped, ['这是一句说明不是名字']);
check('逗号分隔的一行', Roster.parseNames('张三,李四，王五、赵敏 孙丽').names, ['张三', '李四', '王五', '赵敏', '孙丽']);

/* ------------------------------------------------------- 从表格里找姓名列 */

function readSample(file, sheetName) {
  const buffer = fs.readFileSync(path.join(__dirname, '..', 'samples', file));
  if (/\.csv$/i.test(file)) {
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return Sheet.worksheetToAoa(XLSX.read(text, { type: 'string', raw: true }).Sheets[sheetName]);
  }
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return Sheet.worksheetToAoa(wb.Sheets[sheetName || wb.SheetNames[0]]);
}

section('示例-花名册.xlsx / 班级花名册（序号 / 学号 / 姓名 / 性别，上面还有一行标题）');
const classRows = readSample('示例-花名册.xlsx', '班级花名册');
const classTable = Roster.analyzeRows(classRows);
check('表头行', classTable.headerRow, 1);
check('自动选中的姓名列', classTable.best, 2);
check('列数', classTable.columns.length, 4);
check('姓名列识别出的人数', classTable.columns[2].names.length, 20);
check('名单前 3 个', classTable.columns[2].names.slice(0, 3), ['张伟', '李娜', '王强']);
check('姓名列的表头', classTable.columns[2].header, '姓名');
check('序号列不会被当成姓名', classTable.columns[0].valid, 0);
check('学号列不会被当成姓名', classTable.columns[1].valid, 0);
check('性别列不会被当成姓名', classTable.columns[3].valid, 0);
check('按选中的列取姓名', Roster.extractNames(classRows, 2).names.length, 20);
check('整张表取姓名（-1）', Roster.extractNames(classRows, -1).names.length, 20);

section('示例-花名册.xlsx / 只有姓名（单列，无学号）');
const onlyNameRows = readSample('示例-花名册.xlsx', '只有姓名');
const onlyNameTable = Roster.analyzeRows(onlyNameRows);
check('表头行', onlyNameTable.headerRow, 0);
check('自动选中的列', onlyNameTable.best, 0);
check('识别出的人数', onlyNameTable.columns[0].names.length, 20);

section('示例-花名册.csv（学号,姓名,性别）');
const csvRows = readSample('示例-花名册.csv', 'Sheet1');
const csvTable = Roster.analyzeRows(csvRows);
check('自动选中的姓名列', csvTable.best, 1);
check('识别出的人数', csvTable.columns[1].names.length, 20);
check('名单前 3 个', csvTable.columns[1].names.slice(0, 3), ['张伟', '李娜', '王强']);

section('没有表头的名单（多列并排，名字直接开始）');
const bareRows = [['张三', '李四'], ['王五', '赵敏'], ['孙丽', '周涛']];
const bareTable = Roster.analyzeRows(bareRows);
check('没有找到表头', bareTable.headerRow, -1);
check('整张表取姓名', Roster.extractNames(bareRows, -1).names, ['张三', '李四', '王五', '赵敏', '孙丽', '周涛']);
check('只取第一列', Roster.extractNames(bareRows, 0).names, ['张三', '王五', '孙丽']);

/* ------------------------------------------------------------- 抽取 */

const TWENTY = ['张伟', '李娜', '王强', '刘洋', '陈刚', '赵敏', '孙丽', '周涛', '吴倩', '郑凯'];

section('随机抽取');
Roster.setNames(TWENTY, { save: false });
Roster.clearDrawn({ save: false });
Roster.clearHistory({ save: false });
Roster.setSettings({ count: 3, avoidRepeat: true, animate: true }, { save: false });

check('名单人数', Roster.state.names.length, 10);
check('候选池初始', Roster.candidates().length, 10);

const first = Roster.draw(3, { save: false });
check('抽到 3 人', first.picked.length, 3);
check('一次抽取内不重复', new Set(first.picked).size, 3);
check('抽到的都在名单里', first.picked.every((name) => TWENTY.includes(name)), true);
check('没有少抽', first.shortage, 0);
check('抽完候选池剩 7 人', Roster.candidates().length, 7);
check('本轮已抽记录', Roster.state.drawn.slice().sort(), first.picked.slice().sort());
check('记录条数', Roster.state.history.length, 1);
check('记录里保存了候选池人数', Roster.state.history[0].pool, 10);

const second = Roster.draw(3, { save: false });
check('「本轮不重复」时不会再抽到已抽过的人', second.picked.every((name) => first.picked.indexOf(name) < 0), true);
check('候选池剩 4 人', Roster.candidates().length, 4);

const rest = Roster.draw(4, { save: false });
check('把剩下的都抽完', rest.picked.length, 4);
check('抽完时 drained', rest.drained, true);
check('候选池空了', Roster.candidates().length, 0);
const empty = Roster.draw(2, { save: false });
check('候选池空时抽不到人', empty.picked, []);
check('候选池空时记录缺少人数', empty.shortage, 2);

check('重置本轮', (Roster.clearDrawn({ save: false }), Roster.candidates().length), 10);

section('候选池不够时按实际人数抽');
const shortage = Roster.draw(20, { save: false });
check('只抽到 10 人', shortage.picked.length, 10);
check('少抽了 10 个', shortage.shortage, 10);
check('名单里去重', new Set(shortage.picked).size, 10);

section('关闭「本轮不重复」时可以重复抽到同一个人');
Roster.setSettings({ avoidRepeat: false }, { save: false });
Roster.clearDrawn({ save: false });
const a = Roster.draw(4, { save: false });
const b = Roster.draw(4, { save: false });
check('候选池是全部 10 人', Roster.candidates().length, 10);
check('一次抽取内仍然不重复', [new Set(a.picked).size, new Set(b.picked).size], [4, 4]);
check('不会产生「已抽」记录', Roster.state.drawn.length, 0);
check('多次抽取会重复抽到人', (function () {
  const seen = {};
  let repeated = false;
  for (let i = 0; i < 40; i++) {
    const one = Roster.draw(1, { save: false }).picked[0];
    if (seen[one]) repeated = true;
    seen[one] = 1;
  }
  return repeated;
})(), true);
check('每个人都有可能被抽到', (function () {
  const seen = {};
  for (let i = 0; i < 400; i++) seen[Roster.draw(1, { save: false }).picked[0]] = 1;
  return Object.keys(seen).length;
})(), 10);

section('手动调整「本轮已抽」标记');
Roster.setSettings({ avoidRepeat: true }, { save: false });
Roster.clearDrawn({ save: false });
check('标记某人已抽', (Roster.toggleDrawn('张伟', { save: false }), Roster.isDrawn('张伟')), true);
check('候选池少一人', Roster.candidates().length, 9);
check('取消标记', (Roster.toggleDrawn('张伟', { save: false }), Roster.isDrawn('张伟')), false);
check('名单外的人不能标记', Roster.toggleDrawn('查无此人', { save: false }), false);

section('名单增删改');
check('追加姓名', Roster.addNames(['新同学', '张伟'], { save: false }), { added: ['新同学'], duplicates: ['张伟'] });
check('删除姓名', (Roster.removeName('新同学', { save: false }), Roster.state.names.indexOf('新同学')), -1);
Roster.draw(2, { save: false });
const drawnNames = Roster.state.drawn.slice();
Roster.removeName(drawnNames[0], { save: false });
check('删除某人时也会清掉他的已抽标记', Roster.state.drawn.indexOf(drawnNames[0]), -1);
Roster.clearDrawn({ save: false });
Roster.toggleDrawn('王强', { save: false });
Roster.toggleDrawn('刘洋', { save: false });
check('替换名单会同步清理已抽标记', (function () {
  Roster.setNames(['张伟', '李娜'], { save: false });
  return [Roster.state.names.length, Roster.state.drawn.length];
})(), [2, 0]);
Roster.setNames(TWENTY, { save: false });
check('用新名单替换时会返回变化', Roster.setNames(['张三', '李四'], { save: false }), { added: ['张三', '李四'], removed: TWENTY });
Roster.setNames(TWENTY, { save: false });

section('抽取记录');
Roster.clearHistory({ save: false });
Roster.setSettings({ avoidRepeat: false }, { save: false });
Roster.draw(2, { save: false });
Roster.draw(1, { save: false });
check('记录条数', Roster.state.history.length, 2);
check('最新的记录在最前面', Roster.state.history[0].names.length, 1);
check('记录里保存了名字', Roster.state.history[1].names.length, 2);
check('记录时间格式', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(Roster.formatTime(Roster.state.history[0].at)), true);
check('记录导出文本的行数', Roster.historyText().split('\n').length, 2);
check('记录导出文本以制表符分隔', Roster.historyText().split('\n')[0].indexOf('\t') > 0, true);
Roster.clearHistory({ save: false });
check('清空记录', Roster.state.history.length, 0);

section('本地保存与读取');
Roster.setNames(TWENTY, { save: false });
Roster.setSettings({ count: 4, avoidRepeat: true, animate: false }, { save: false });
Roster.draw(2, { save: false });
Roster.save();
const savedDrawn = Roster.state.drawn.slice();
Roster.state.names.push('临时乱改的名字');
Roster.state.drawn.push('临时乱改的名字');
Roster.load();
check('读取后名单恢复', Roster.state.names.length, 10);
check('读取后已抽记录恢复', Roster.state.drawn, savedDrawn);
check('读取后设置恢复', Roster.state.settings, { count: 4, avoidRepeat: true, animate: false });
check('名单导出为每行一个名字', Roster.toText().split('\n').length, 10);

console.log('\n通过 ' + passed + ' 项，失败 ' + failed + ' 项');
process.exit(failed ? 1 : 0);
