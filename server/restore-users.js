// 从备份数据库中恢复员工和用户账号（不含目标和任务）
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const BACKUP_PATH = path.join(__dirname, 'work-tracker.db.backup.20260402_214309');
const MAIN_PATH = path.join(__dirname, 'work-tracker.db');

async function restore() {
  const SQL = await initSqlJs();

  // 读取备份数据库
  const backupBuf = fs.readFileSync(BACKUP_PATH);
  const backupDb = new SQL.Database(backupBuf);

  // 读取当前数据库
  const mainBuf = fs.readFileSync(MAIN_PATH);
  const mainDb = new SQL.Database(mainBuf);

  // 备份所有 sessions（用户登录状态会失效，需要重新登录）
  mainDb.run('DELETE FROM sessions');

  // 复制 employees 表
  const employees = backupDb.exec('SELECT * FROM employees');
  if (employees.length > 0) {
    const cols = employees[0].columns;
    console.log('备份中的员工列:', cols);
    console.log('备份中的员工数:', employees[0].values.length);

    for (const row of employees[0].values) {
      // 检查是否已存在同名员工
      const nameIdx = cols.indexOf('name');
      const name = row[nameIdx];
      const existing = mainDb.exec(`SELECT id FROM employees WHERE name = '${name.replace(/'/g, "''")}'`);
      if (existing.length > 0 && existing[0].values.length > 0) {
        console.log(`员工 "${name}" 已存在，跳过`);
        continue;
      }

      const roleIdx = cols.indexOf('role');
      const groupNameIdx = cols.indexOf('group_name');
      const createdAtIdx = cols.indexOf('created_at');

      const role = row[roleIdx] || '';
      const groupName = row[groupNameIdx] || '';
      const createdAt = row[createdAtIdx] || new Date().toISOString();

      mainDb.run(
        `INSERT INTO employees (name, role, group_name, created_at) VALUES (?, ?, ?, ?)`,
        [name, role, groupName, createdAt]
      );
      console.log(`添加员工: ${name}`);
    }
  }

  // 复制 users 表
  const users = backupDb.exec('SELECT * FROM users');
  if (users.length > 0) {
    const cols = users[0].columns;
    console.log('\n备份中的用户列:', cols);
    console.log('备份中的用户数:', users[0].values.length);

    for (const row of users[0].values) {
      const usernameIdx = cols.indexOf('username');
      const passwordHashIdx = cols.indexOf('password_hash');
      const roleIdx = cols.indexOf('role');
      const employeeIdIdx = cols.indexOf('employee_id');
      const createdAtIdx = cols.indexOf('created_at');

      const username = row[usernameIdx];
      const passwordHash = row[passwordHashIdx];
      const role = row[roleIdx] || 'employee';
      const employeeId = row[employeeIdIdx];
      const createdAt = row[createdAtIdx] || new Date().toISOString();

      // 检查用户是否已存在
      const existing = mainDb.exec(`SELECT id FROM users WHERE username = '${username.replace(/'/g, "''")}'`);
      if (existing.length > 0 && existing[0].values.length > 0) {
        console.log(`用户 "${username}" 已存在，跳过`);
        continue;
      }

      // 如果指定了 employee_id，检查该员工是否在当前数据库中存在
      let targetEmpId = null;
      if (employeeId) {
        // 从备份数据库中获取该用户的员工姓名
        const empResult = backupDb.exec(`SELECT name FROM employees WHERE id = ${employeeId}`);
        if (empResult.length > 0 && empResult[0].values.length > 0) {
          const empName = empResult[0].values[0][0];
          // 在当前数据库中查找同名员工
          const mainEmpResult = mainDb.exec(`SELECT id FROM employees WHERE name = '${empName.replace(/'/g, "''")}'`);
          if (mainEmpResult.length > 0 && mainEmpResult[0].values.length > 0) {
            targetEmpId = mainEmpResult[0].values[0][0];
          }
        }
      }

      mainDb.run(
        `INSERT INTO users (username, password_hash, role, employee_id, created_at) VALUES (?, ?, ?, ?, ?)`,
        [username, passwordHash, role, targetEmpId, createdAt]
      );
      console.log(`添加用户: ${username} (角色: ${role})`);
    }
  }

  // 保存
  const data = mainDb.export();
  fs.writeFileSync(MAIN_PATH, Buffer.from(data));

  console.log('\n恢复完成！请使用备份中的用户名和密码重新登录。');
}

restore().catch(console.error);
