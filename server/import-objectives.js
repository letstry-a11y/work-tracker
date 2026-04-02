// 导入 OKR objectives + KRs 到数据库
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function main() {
  const SQL = await initSqlJs();
  const dbPath = path.join(__dirname, 'work-tracker.db');
  let buf;
  if (fs.existsSync(dbPath)) {
    buf = fs.readFileSync(dbPath);
  }
  const db = new SQL.Database(buf);
  db.run('PRAGMA foreign_keys = ON');

  // Ensure employees table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT DEFAULT '',
      group_name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Ensure objectives table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS objectives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      weight REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    )
  `);

  // Ensure tasks has objective_id column
  try {
    db.run("ALTER TABLE tasks ADD COLUMN objective_id INTEGER");
  } catch(e) {}
  try {
    db.run("ALTER TABLE tasks ADD COLUMN source TEXT DEFAULT 'manual'");
  } catch(e) {}
  try {
    db.run("ALTER TABLE tasks ADD COLUMN confirm_status TEXT DEFAULT 'none' CHECK(confirm_status IN ('none','pending','confirmed','rejected'))");
  } catch(e) {}
  try {
    db.run("ALTER TABLE tasks ADD COLUMN confirm_note TEXT DEFAULT ''");
  } catch(e) {}
  try {
    db.run("ALTER TABLE tasks ADD COLUMN confirmed_by INTEGER");
  } catch(e) {}
  try {
    db.run("ALTER TABLE tasks ADD COLUMN confirmed_at TEXT");
  } catch(e) {}

  function run(sql, params) {
    db.run(sql, params);
    return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0].values[0][0], changes: db.getRowsModified() };
  }
  function get(sql, params) {
    const r = db.exec(sql, params);
    if (!r.length) return null;
    const cols = r[0].columns;
    const vals = r[0].values[0];
    const o = {}; cols.forEach((c, i) => o[c] = vals[i]);
    return o;
  }
  function all(sql, params) {
    const r = db.exec(sql, params);
    if (!r.length) return [];
    const cols = r[0].columns;
    return r[0].values.map(row => {
      const o = {}; cols.forEach((c, i) => o[c] = row[i]); return o;
    });
  }

  const employees = {
    33: '李自汉',
    34: '吴井胜',
    35: '王明斗',
    36: '江洲',
    37: '李思平',
    38: '张苏鹏',
  };

  // 清空旧 OKR 任务和目标（保留 manual 任务和系统账号员工）
  db.run("DELETE FROM task_dependencies WHERE task_id IN (SELECT id FROM tasks WHERE source='okr')");
  db.run("DELETE FROM daily_logs WHERE task_id IN (SELECT id FROM tasks WHERE source='okr')");
  db.run("DELETE FROM tasks WHERE source='okr'");
  db.run("DELETE FROM objectives");

  function insertObjective(employeeId, title, weight) {
    const r = run('INSERT INTO objectives (employee_id, title, weight) VALUES (?, ?, ?)', [employeeId, title, weight || 0]);
    return r.lastInsertRowid;
  }

  function insertTask(title, employeeId, objectiveId, priority, difficulty, hours, deadline) {
    run(`INSERT INTO tasks (title, assignee_id, objective_id, status, priority, difficulty, estimated_hours, deadline, source, confirm_status)
        VALUES (?, ?, ?, 'in_progress', ?, ?, ?, ?, 'okr', 'none')`,
      [title, employeeId, objectiveId, priority || 'P2', difficulty || 3, hours || 8, deadline || null]);
    return db.exec("SELECT last_insert_rowid()")[0].values[0][0];
  }

  // =====================
  // 李自汉 (ID=33)
  // =====================
  const lzh_emp = 33;

  const lzh_obj1 = insertObjective(lzh_emp, '项目开发与优化', 0.4);
  insertTask('LEO_FDA性能迭代提升（截骨板优化）', lzh_emp, lzh_obj1, 'P0', 5, 80, '2026-12-31');
  insertTask('NMPA髋膝兼容商用落地--髋临床重点处理问题', lzh_emp, lzh_obj1, 'P0', 5, 60, '2026-12-31');
  insertTask('俄罗斯样机开发、型检与注册', lzh_emp, lzh_obj1, 'P1', 4, 40, '2026-12-31');
  insertTask('开放假体平台', lzh_emp, lzh_obj1, 'P1', 4, 30, '2026-09-30');
  insertTask('MDR髋膝兼容获证与海外推广', lzh_emp, lzh_obj1, 'P1', 4, 40, '2026-12-31');
  insertTask('LEO安规版本', lzh_emp, lzh_obj1, 'P1', 3, 20, '2026-06-30');

  const lzh_obj2 = insertObjective(lzh_emp, '产品开发与优化', 0.3);
  insertTask('牙科项目', lzh_emp, lzh_obj2, 'P2', 3, 30, '2026-12-31');
  insertTask('单髁或翻修启动', lzh_emp, lzh_obj2, 'P2', 4, 30, '2026-09-30');
  insertTask('远程手术', lzh_emp, lzh_obj2, 'P2', 4, 30, '2026-12-31');
  insertTask('预研技术储备', lzh_emp, lzh_obj2, 'P2', 3, 20, '2026-12-31');
  insertTask('工信部应用示范项目', lzh_emp, lzh_obj2, 'P2', 3, 20, '2026-12-31');
  insertTask('LEO NMPA/Libra缺陷解决', lzh_emp, lzh_obj2, 'P1', 4, 40, '2026-12-31');
  insertTask('后市场问题解决', lzh_emp, lzh_obj2, 'P1', 3, 30, '2026-12-31');

  const lzh_obj3 = insertObjective(lzh_emp, '职能领域内专业能力', 0.2);
  insertTask('医院关系拓展与支持', lzh_emp, lzh_obj3, 'P2', 2, 15, '2026-12-31');
  insertTask('基金到账', lzh_emp, lzh_obj3, 'P1', 3, 20, '2026-12-31');
  insertTask('专利撰写', lzh_emp, lzh_obj3, 'P2', 3, 15, '2026-12-31');
  insertTask('算法知识库与培训', lzh_emp, lzh_obj3, 'P2', 2, 15, '2026-12-31');
  insertTask('前沿技术探索—轻巧智慧手术工具设计', lzh_emp, lzh_obj3, 'P2', 3, 20, '2026-12-31');

  const lzh_obj4 = insertObjective(lzh_emp, '运营管控', 0.1);
  insertTask('预算范围内', lzh_emp, lzh_obj4, 'P2', 1, 5, '2026-12-31');
  insertTask('变更', lzh_emp, lzh_obj4, 'P2', 2, 10, '2026-12-31');
  insertTask('竞品跟踪（1~2页PPT/周）', lzh_emp, lzh_obj4, 'P3', 1, 10, '2026-12-31');
  insertTask('销售、招投标、来访接待', lzh_emp, lzh_obj4, 'P3', 2, 10, '2026-12-31');

  // =====================
  // 吴井胜 (ID=34)
  // =====================
  const wjs_emp = 34;

  const wjs_obj1 = insertObjective(wjs_emp, '鸿鹄研发', 0.4);
  insertTask('Leo全膝软件发布', wjs_emp, wjs_obj1, 'P0', 5, 80, '2026-12-31');
  insertTask('Libra髋膝兼容软件发布', wjs_emp, wjs_obj1, 'P0', 5, 60, '2026-09-30');
  insertTask('Libra全术式软件发布', wjs_emp, wjs_obj1, 'P1', 4, 40, '2026-12-31');

  const wjs_obj2 = insertObjective(wjs_emp, '自由现金管控', 0.3);
  insertTask('2025年畅行自由现金净流出≥0亿元', wjs_emp, wjs_obj2, 'P1', 3, 20, '2026-12-31');

  const wjs_obj3 = insertObjective(wjs_emp, '研发管理', 0.2);
  insertTask('畅行净亏损金额不超过0.5亿元', wjs_emp, wjs_obj3, 'P2', 2, 10, '2026-12-31');
  insertTask('畅行人效≥100万；元效≥2.6', wjs_emp, wjs_obj3, 'P2', 2, 10, '2026-12-31');
  insertTask('骨科软件平台设计', wjs_emp, wjs_obj3, 'P1', 4, 40, '2026-12-31');

  const wjs_obj4 = insertObjective(wjs_emp, '预算管理', 0.1);
  insertTask('预算范围内', wjs_emp, wjs_obj4, 'P2', 1, 5, '2026-12-31');

  // =====================
  // 王明斗 (ID=35)
  // =====================
  const wmd_emp = 35;

  const wmd_obj1 = insertObjective(wmd_emp, 'Libra商业化迭代', 0.6);
  insertTask('辅助磨骨鲁棒性优化', wmd_emp, wmd_obj1, 'P0', 5, 60, '2026-09-30');
  insertTask('运动学参数标定与工具运动学参数配置优化', wmd_emp, wmd_obj1, 'P1', 4, 40, '2026-09-30');
  insertTask('伺服定位与随动抖动优化', wmd_emp, wmd_obj1, 'P1', 4, 40, '2026-09-30');

  const wmd_obj2 = insertObjective(wmd_emp, '产品开发与优化', 0.3);
  insertTask('牙科、单髁、新一代机械臂项目', wmd_emp, wmd_obj2, 'P2', 4, 30, '2026-12-31');
  insertTask('Libra缺陷解决', wmd_emp, wmd_obj2, 'P1', 4, 30, '2026-12-31');
  insertTask('后市场问题解决', wmd_emp, wmd_obj2, 'P1', 3, 20, '2026-12-31');

  const wmd_obj3 = insertObjective(wmd_emp, '预算管理', 0.1);
  insertTask('预算范围内', wmd_emp, wmd_obj3, 'P2', 1, 5, '2026-12-31');

  // =====================
  // 江洲 (ID=36)
  // =====================
  const jz_emp = 36;

  const jz_obj1 = insertObjective(jz_emp, '产品注册', 0.4);
  insertTask('膝产品优化', jz_emp, jz_obj1, 'P0', 4, 40, '2026-12-31');
  insertTask('髋产品商用落地', jz_emp, jz_obj1, 'P1', 4, 30, '2026-12-31');
  insertTask('单髁获证', jz_emp, jz_obj1, 'P1', 4, 30, '2026-06-30');
  insertTask('开放平台优化定型', jz_emp, jz_obj1, 'P2', 3, 20, '2026-09-30');
  insertTask('一次性反光纸注册', jz_emp, jz_obj1, 'P2', 3, 20, '2026-09-30');
  insertTask('新版安规获批', jz_emp, jz_obj1, 'P1', 4, 30, '2026-12-31');
  insertTask('市销产品售后支持', jz_emp, jz_obj1, 'P2', 3, 20, '2026-12-31');

  const jz_obj2 = insertObjective(jz_emp, '产品预研', 0.3);
  insertTask('机械臂性能提升', jz_emp, jz_obj2, 'P2', 4, 30, '2026-12-31');
  insertTask('小型台车方案设计定型', jz_emp, jz_obj2, 'P2', 3, 20, '2026-09-30');
  insertTask('集成动力工具设计定型', jz_emp, jz_obj2, 'P2', 4, 30, '2026-09-30');
  insertTask('智能截骨工具研发样机试制', jz_emp, jz_obj2, 'P2', 4, 30, '2026-12-31');

  const jz_obj3 = insertObjective(jz_emp, '测试部门管理', 0.2);
  insertTask('人员招聘', jz_emp, jz_obj3, 'P2', 2, 15, '2026-12-31');
  insertTask('测试能力提升', jz_emp, jz_obj3, 'P2', 3, 20, '2026-12-31');
  insertTask('核心技术专利布局', jz_emp, jz_obj3, 'P2', 3, 20, '2026-12-31');

  const jz_obj4 = insertObjective(jz_emp, '畅行经营及效率', 0.1);
  insertTask('净亏损金额不超过0.5亿元', jz_emp, jz_obj4, 'P2', 2, 10, '2026-12-31');
  insertTask('人效≥100万；元效≥2.6', jz_emp, jz_obj4, 'P2', 2, 10, '2026-12-31');

  // =====================
  // 李思平 (ID=37)
  // =====================
  const lsp_emp = 37;

  const lsp_obj1 = insertObjective(lsp_emp, '产品开发与优化', 0.3);
  insertTask('膝产品规模化商用', lsp_emp, lsp_obj1, 'P1', 3, 30, '2026-12-31');
  insertTask('髋产品商用落地', lsp_emp, lsp_obj1, 'P1', 3, 30, '2026-12-31');
  insertTask('单髁或翻修启动', lsp_emp, lsp_obj1, 'P2', 3, 20, '2026-09-30');
  insertTask('牙科', lsp_emp, lsp_obj1, 'P2', 3, 20, '2026-12-31');

  const lsp_obj2 = insertObjective(lsp_emp, '产品预研', 0.2);
  insertTask('预研技术储备', lsp_emp, lsp_obj2, 'P2', 2, 15, '2026-12-31');
  insertTask('鸿鹄全球云服务', lsp_emp, lsp_obj2, 'P2', 3, 20, '2026-12-31');

  const lsp_obj3 = insertObjective(lsp_emp, '预算管理', 0.1);
  insertTask('预算范围内', lsp_emp, lsp_obj3, 'P2', 1, 5, '2026-12-31');

  // =====================
  // 张苏鹏 (ID=38)
  // =====================
  const zsp_emp = 38;

  const zsp_obj1 = insertObjective(zsp_emp, '产品开发与优化', 0.3);
  insertTask('膝产品规模化商用', zsp_emp, zsp_obj1, 'P1', 3, 30, '2026-12-31');
  insertTask('髋产品商用落地', zsp_emp, zsp_obj1, 'P1', 3, 30, '2026-12-31');
  insertTask('单髁或翻修启动', zsp_emp, zsp_obj1, 'P2', 3, 20, '2026-09-30');
  insertTask('牙科', zsp_emp, zsp_obj1, 'P2', 3, 20, '2026-12-31');

  const zsp_obj2 = insertObjective(zsp_emp, '产品预研', 0.2);
  insertTask('预研技术储备', zsp_emp, zsp_obj2, 'P2', 2, 15, '2026-12-31');
  insertTask('鸿鹄全球云服务', zsp_emp, zsp_obj2, 'P2', 3, 20, '2026-12-31');

  const zsp_obj3 = insertObjective(zsp_emp, '预算管理', 0.1);
  insertTask('预算范围内', zsp_emp, zsp_obj3, 'P2', 1, 5, '2026-12-31');

  // 保存
  const data = db.export();
  fs.writeFileSync(dbPath, data);
  console.log('OKR objectives + KRs imported successfully!');

  // 统计
  const objCount = db.exec('SELECT COUNT(*) FROM objectives')[0].values[0][0];
  const taskCount = db.exec("SELECT COUNT(*) FROM tasks WHERE source='okr'")[0].values[0][0];
  console.log(`Objectives: ${objCount}, Tasks: ${taskCount}`);
}

main().catch(console.error);
