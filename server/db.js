const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'work-tracker.db');
let db = null;
let saveTimer = null;

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT DEFAULT '',
      group_name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS objectives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER,
      title TEXT NOT NULL,
      weight REAL DEFAULT 0,
      scope TEXT DEFAULT 'personal',
      approval_status TEXT DEFAULT 'approved',
      approved_by INTEGER,
      approved_at TEXT DEFAULT '',
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    )
  `);

  // Migration: rebuild objectives table if employee_id is NOT NULL (old schema)
  try {
    const objSql = get("SELECT sql FROM sqlite_master WHERE type='table' AND name='objectives'");
    if (objSql && objSql.sql && objSql.sql.includes('employee_id INTEGER NOT NULL')) {
      db.run(`CREATE TABLE objectives_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER,
        title TEXT NOT NULL,
        weight REAL DEFAULT 0,
        scope TEXT DEFAULT 'personal',
        approval_status TEXT DEFAULT 'approved',
        approved_by INTEGER,
        approved_at TEXT DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      )`);
      db.run("INSERT INTO objectives_new (id, employee_id, title, weight, created_at) SELECT id, employee_id, title, weight, created_at FROM objectives");
      db.run("DROP TABLE objectives");
      db.run("ALTER TABLE objectives_new RENAME TO objectives");
      saveDbSync();
    } else if (objSql && objSql.sql && !objSql.sql.includes('scope')) {
      // Table exists with nullable employee_id but missing new columns
      const objCols = all("PRAGMA table_info(objectives)");
      const colNames = objCols.map(c => c.name);
      if (!colNames.includes('scope')) db.run("ALTER TABLE objectives ADD COLUMN scope TEXT DEFAULT 'personal'");
      if (!colNames.includes('approval_status')) db.run("ALTER TABLE objectives ADD COLUMN approval_status TEXT DEFAULT 'approved'");
      if (!colNames.includes('approved_by')) db.run("ALTER TABLE objectives ADD COLUMN approved_by INTEGER DEFAULT NULL");
      if (!colNames.includes('approved_at')) db.run("ALTER TABLE objectives ADD COLUMN approved_at TEXT DEFAULT ''");
      if (!colNames.includes('created_by')) db.run("ALTER TABLE objectives ADD COLUMN created_by INTEGER DEFAULT NULL");
      saveDbSync();
    }
  } catch (e) { /* migration already done */ }

  // Migration: add parent_objective_id column
  try {
    const objCols2 = all("PRAGMA table_info(objectives)");
    if (!objCols2.some(c => c.name === 'parent_objective_id')) {
      db.run("ALTER TABLE objectives ADD COLUMN parent_objective_id INTEGER DEFAULT NULL");
      saveDbSync();
    }
    if (!objCols2.some(c => c.name === 'parent_kr_id')) {
      db.run("ALTER TABLE objectives ADD COLUMN parent_kr_id INTEGER DEFAULT NULL");
      saveDbSync();
    }
  } catch (e) { /* migration already done */ }

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      objective_id INTEGER,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      assignee_id INTEGER,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','overdue')),
      priority TEXT DEFAULT 'P2' CHECK(priority IN ('P0','P1','P2','P3')),
      difficulty INTEGER DEFAULT 3 CHECK(difficulty BETWEEN 1 AND 5),
      estimated_hours REAL DEFAULT 0,
      deadline TEXT,
      source TEXT DEFAULT 'manual',
      confirm_status TEXT DEFAULT 'none' CHECK(confirm_status IN ('none','pending','confirmed','rejected')),
      confirm_note TEXT DEFAULT '',
      confirmed_by INTEGER,
      confirmed_at TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      completed_at TEXT,
      FOREIGN KEY (assignee_id) REFERENCES employees(id) ON DELETE SET NULL,
      FOREIGN KEY (objective_id) REFERENCES objectives(id) ON DELETE SET NULL
    )
  `);

  // Migration: add columns if not exist
  try {
    const cols = all("PRAGMA table_info(tasks)");
    const addCol = (name, type, defaultVal) => {
      if (!cols.some(c => c.name === name)) {
        db.run(`ALTER TABLE tasks ADD COLUMN ${name} ${type} DEFAULT '${defaultVal}'`);
      }
    };
    addCol('objective_id', 'INTEGER', null);
    addCol('source', 'TEXT', 'manual');
    addCol('confirm_status', 'TEXT', 'none');
    addCol('confirm_note', 'TEXT', '');
    addCol('confirmed_by', 'INTEGER', null);
    addCol('confirmed_at', 'TEXT', '');
    const hasSource = cols.some(c => c.name === 'source');
    if (!hasSource) {
      db.run("UPDATE tasks SET source = 'okr'");
    }
    saveDbSync();
  } catch (e) { /* migration already done */ }

  // Migration: ensure daily_logs has all expected columns
  try {
    const cols = all("PRAGMA table_info(daily_logs)");
    const colNames = cols.map(c => c.name);
    const addCol = (name, type, defaultVal) => {
      if (!colNames.includes(name)) {
        db.run(`ALTER TABLE daily_logs ADD COLUMN ${name} ${type} DEFAULT '${defaultVal}'`);
      }
    };
    addCol('progress_percent', 'INTEGER', '0');
    addCol('priority', 'TEXT', 'P2');
    addCol('blocker', 'TEXT', '');
    addCol('dependency_note', 'TEXT', '');
    addCol('tomorrow_plan', 'TEXT', '');
    saveDbSync();
  } catch (e) { /* migration already done */ }

  // Migration: add deliverable_path column to tasks if not exist
  try {
    const taskCols = all("PRAGMA table_info(tasks)");
    const addTaskCol = (name, type, defaultVal) => {
      if (!taskCols.some(c => c.name === name)) {
        db.run(`ALTER TABLE tasks ADD COLUMN ${name} ${type} DEFAULT '${defaultVal}'`);
      }
    };
    addTaskCol('deliverable_type', 'TEXT', '');
    addTaskCol('deliverable_note', 'TEXT', '');
    saveDbSync();
  } catch (e) { /* migration already done */ }

  db.run(`
    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id INTEGER NOT NULL,
      depends_on_task_id INTEGER NOT NULL,
      PRIMARY KEY (task_id, depends_on_task_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      task_id INTEGER,
      work_content TEXT DEFAULT '',
      hours REAL DEFAULT 0,
      progress_percent INTEGER DEFAULT 0 CHECK(progress_percent BETWEEN 0 AND 100),
      priority TEXT DEFAULT 'P2',
      blocker TEXT DEFAULT '',
      dependency_note TEXT DEFAULT '',
      tomorrow_plan TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
    )
  `);

  // 交付物表
  db.run(`
    CREATE TABLE IF NOT EXISTS deliverables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      employee_id INTEGER,
      title TEXT NOT NULL,
      file_name TEXT DEFAULT '',
      file_path TEXT DEFAULT '',
      file_type TEXT DEFAULT '',
      file_size INTEGER DEFAULT 0,
      description TEXT DEFAULT '',
      confirm_status TEXT DEFAULT 'none' CHECK(confirm_status IN ('none','pending','confirmed','rejected')),
      confirm_note TEXT DEFAULT '',
      confirmed_by INTEGER,
      confirmed_at TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
    )
  `);

  // 交付物文件存放目录
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Departments table
  db.run(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      leader_employee_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (leader_employee_id) REFERENCES employees(id) ON DELETE SET NULL
    )
  `);

  // Migration: add department_id to employees
  try {
    const empCols = all("PRAGMA table_info(employees)");
    if (!empCols.some(c => c.name === 'department_id')) {
      db.run("ALTER TABLE employees ADD COLUMN department_id INTEGER DEFAULT NULL");
      db.run("CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id)");
    }
    if (!empCols.some(c => c.name === 'email')) {
      db.run("ALTER TABLE employees ADD COLUMN email TEXT DEFAULT ''");
    }
    saveDbSync();
  } catch (e) { /* migration already done */ }

  // Users table - check if we need to rebuild for dept_leader role support
  const usersExists = get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
  if (usersExists) {
    // Check current CHECK constraint by trying to see if dept_leader is valid
    const usersSql = get("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
    if (usersSql && usersSql.sql && !usersSql.sql.includes('dept_leader')) {
      // Rebuild users table to support dept_leader role
      db.run(`CREATE TABLE IF NOT EXISTS users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'employee' CHECK(role IN ('admin','employee','dept_leader')),
        employee_id INTEGER,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
      )`);
      db.run("INSERT INTO users_new SELECT * FROM users");
      db.run("DROP TABLE users");
      db.run("ALTER TABLE users_new RENAME TO users");
      db.run("CREATE INDEX IF NOT EXISTS idx_users_employee ON users(employee_id)");
      saveDbSync();
    }
  } else {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'employee' CHECK(role IN ('admin','employee','dept_leader')),
        employee_id INTEGER,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
      )
    `);
  }

  // Migration: auto-migrate group_name -> departments
  try {
    const groups = all("SELECT DISTINCT group_name FROM employees WHERE group_name IS NOT NULL AND group_name != ''");
    for (const g of groups) {
      const existing = get("SELECT id FROM departments WHERE name = ?", [g.group_name]);
      if (!existing) {
        run("INSERT INTO departments (name) VALUES (?)", [g.group_name]);
      }
    }
    // Link employees to departments by group_name
    const depts = all("SELECT id, name FROM departments");
    for (const dept of depts) {
      db.run("UPDATE employees SET department_id = ? WHERE group_name = ? AND (department_id IS NULL OR department_id = 0)", [dept.id, dept.name]);
    }
    saveDbSync();
  } catch (e) { /* migration already done */ }

  // Migration: add specialty and description to users
  try {
    const userCols = all("PRAGMA table_info(users)").map(c => c.name);
    if (!userCols.includes('specialty')) db.run("ALTER TABLE users ADD COLUMN specialty TEXT DEFAULT ''");
    if (!userCols.includes('description')) db.run("ALTER TABLE users ADD COLUMN description TEXT DEFAULT ''");
    saveDbSync();
  } catch (e) { /* migration already done */ }

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS weekly_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      completion_rate_score REAL DEFAULT 0,
      ontime_rate_score REAL DEFAULT 0,
      workload_score REAL DEFAULT 0,
      total_score REAL DEFAULT 0,
      auto_comment TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    )
  `);

  // Migration: add confirm fields to deliverables
  try {
    const cols = all("PRAGMA table_info(deliverables)");
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('confirm_status')) {
      db.run("ALTER TABLE deliverables ADD COLUMN confirm_status TEXT DEFAULT 'none'");
    }
    if (!colNames.includes('confirm_note')) {
      db.run("ALTER TABLE deliverables ADD COLUMN confirm_note TEXT DEFAULT ''");
    }
    if (!colNames.includes('confirmed_by')) {
      db.run("ALTER TABLE deliverables ADD COLUMN confirmed_by INTEGER DEFAULT NULL");
    }
    if (!colNames.includes('confirmed_at')) {
      db.run("ALTER TABLE deliverables ADD COLUMN confirmed_at TEXT DEFAULT ''");
    }
    saveDbSync();
  } catch (e) { /* migration already done */ }

  // One-time fix: backfill leader_employee_id from existing dept_leader users
  try {
    db.run(`UPDATE departments SET leader_employee_id = (
      SELECT u.employee_id FROM users u
      JOIN employees e ON u.employee_id = e.id
      WHERE e.department_id = departments.id AND u.role = 'dept_leader'
      LIMIT 1
    ) WHERE leader_employee_id IS NULL`);
    saveDbSync();
  } catch (e) { /* backfill already done or no data */ }

  // Project Management module tables
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      start_date TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS project_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      parent_task_id INTEGER DEFAULT NULL,
      order_index INTEGER DEFAULT 0,
      title TEXT NOT NULL,
      duration_days REAL DEFAULT 1,
      is_estimated INTEGER DEFAULT 0,
      start_date TEXT,
      finish_date TEXT,
      predecessor_ids TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_task_id) REFERENCES project_tasks(id) ON DELETE CASCADE
    )
  `);
  // Migration: add objective_id / kr_id to project_tasks
  try {
    const ptCols = all("PRAGMA table_info(project_tasks)");
    if (!ptCols.some(c => c.name === 'objective_id')) {
      db.run("ALTER TABLE project_tasks ADD COLUMN objective_id INTEGER DEFAULT NULL");
    }
    if (!ptCols.some(c => c.name === 'kr_id')) {
      db.run("ALTER TABLE project_tasks ADD COLUMN kr_id INTEGER DEFAULT NULL");
    }
    saveDbSync();
  } catch (e) { /* migration already done */ }

  db.run(`
    CREATE TABLE IF NOT EXISTS project_task_resources (
      task_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      PRIMARY KEY (task_id, employee_id),
      FOREIGN KEY (task_id) REFERENCES project_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS project_task_deps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      predecessor_id INTEGER NOT NULL,
      dep_type TEXT DEFAULT 'FS' CHECK(dep_type IN ('FS','SS','FF','SF')),
      lag_days REAL DEFAULT 0,
      UNIQUE(task_id, predecessor_id),
      FOREIGN KEY (task_id) REFERENCES project_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (predecessor_id) REFERENCES project_tasks(id) ON DELETE CASCADE
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS project_baselines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      saved_at TEXT DEFAULT (datetime('now','localtime')),
      saved_by INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS project_baseline_tasks (
      baseline_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      start_date TEXT,
      finish_date TEXT,
      duration_days REAL,
      PRIMARY KEY (baseline_id, task_id),
      FOREIGN KEY (baseline_id) REFERENCES project_baselines(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES project_tasks(id) ON DELETE CASCADE
    )
  `);
  saveDbSync();

  // One-time migration: convert predecessor_ids CSV to project_task_deps rows
  try {
    const depsCount = get("SELECT COUNT(*) as c FROM project_task_deps");
    const csvTasks = all("SELECT id, predecessor_ids FROM project_tasks WHERE predecessor_ids IS NOT NULL AND predecessor_ids != ''");
    if ((!depsCount || depsCount.c === 0) && csvTasks.length > 0) {
      for (const t of csvTasks) {
        for (const pid of String(t.predecessor_ids).split(',').map(s => Number(s.trim())).filter(Boolean)) {
          try {
            db.run("INSERT INTO project_task_deps (task_id, predecessor_id, dep_type, lag_days) VALUES (?, ?, 'FS', 0)", [t.id, pid]);
          } catch (e) { /* dup skip */ }
        }
      }
      saveDbSync();
    }
  } catch (e) { /* migration already done */ }

  // Phase 3.1: Add database indexes for performance
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_objective ON tasks(objective_id)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_confirm_status ON tasks(confirm_status)',
    'CREATE INDEX IF NOT EXISTS idx_daily_logs_employee_date ON daily_logs(employee_id, date)',
    'CREATE INDEX IF NOT EXISTS idx_daily_logs_task ON daily_logs(task_id)',
    'CREATE INDEX IF NOT EXISTS idx_deliverables_task ON deliverables(task_id)',
    'CREATE INDEX IF NOT EXISTS idx_deliverables_employee ON deliverables(employee_id)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_objectives_employee ON objectives(employee_id)',
    'CREATE INDEX IF NOT EXISTS idx_objectives_scope ON objectives(scope)',
    'CREATE INDEX IF NOT EXISTS idx_objectives_approval ON objectives(approval_status)',
    'CREATE INDEX IF NOT EXISTS idx_objectives_parent ON objectives(parent_objective_id)',
    'CREATE INDEX IF NOT EXISTS idx_objectives_parent_kr ON objectives(parent_kr_id)',
    'CREATE INDEX IF NOT EXISTS idx_weekly_scores_employee_week ON weekly_scores(employee_id, week_start)',
    'CREATE INDEX IF NOT EXISTS idx_users_employee ON users(employee_id)',
    'CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id)',
    'CREATE INDEX IF NOT EXISTS idx_departments_leader ON departments(leader_employee_id)',
    'CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_project_tasks_parent ON project_tasks(parent_task_id)',
    'CREATE INDEX IF NOT EXISTS idx_ptr_task ON project_task_resources(task_id)',
    'CREATE INDEX IF NOT EXISTS idx_ptd_task ON project_task_deps(task_id)',
    'CREATE INDEX IF NOT EXISTS idx_ptd_pred ON project_task_deps(predecessor_id)',
    'CREATE INDEX IF NOT EXISTS idx_project_baselines_project ON project_baselines(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_pbt_baseline ON project_baseline_tasks(baseline_id)',
  ];
  for (const idx of indexes) {
    try { db.run(idx); } catch (e) { /* index already exists */ }
  }

  saveDbSync();
  return db;
}

// Synchronous save (used during init/migration and shutdown)
function saveDbSync() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// Phase 3.7: Debounced save - coalesces writes within 1 second
function saveDb() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveDbSync();
    saveTimer = null;
  }, 1000);
}

// Ensure data is saved on process exit
function flushDb() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveDbSync();
}

process.on('SIGINT', () => { flushDb(); process.exit(0); });
process.on('SIGTERM', () => { flushDb(); process.exit(0); });
process.on('beforeExit', flushDb);
process.on('exit', () => {
  // exit event is synchronous-only, so saveDbSync is safe here
  if (db) {
    try { saveDbSync(); } catch (e) { /* ignore errors on exit */ }
  }
});

function getDb() {
  return db;
}

// Helper: run query and return array of row objects
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper: run query and return first row object or null
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Helper: run INSERT/UPDATE/DELETE, return { changes, lastInsertRowid }
function run(sql, params = []) {
  db.run(sql, params);
  const changes = db.getRowsModified();
  const lastRow = get('SELECT last_insert_rowid() as id');
  const info = {
    changes,
    lastInsertRowid: lastRow ? lastRow.id : 0
  };
  saveDb();
  return info;
}

// Phase 6.3: Transaction helper
function transaction(fn) {
  db.run('BEGIN TRANSACTION');
  try {
    const result = fn();
    db.run('COMMIT');
    saveDb();
    return result;
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
}

module.exports = { initDb, getDb, saveDb, saveDbSync, flushDb, all, get, run, transaction };
