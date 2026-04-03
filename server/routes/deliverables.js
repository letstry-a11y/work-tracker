const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { all, get, run } = require('../db');
const { adminOnly, getDeptEmployeeIds } = require('../auth/middleware');

const router = express.Router();

// Dangerous file extensions blocklist
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.scr', '.pif',
  '.com', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.reg',
  '.cpl', '.inf', '.hta', '.lnk'
]);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Sanitize: remove path traversal characters, keep only basename
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]/g, '_');
    const ext = path.extname(safeName);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return cb(new Error('FORBIDDEN_FILE_TYPE'));
    }
    cb(null, true);
  }
});

// GET /api/deliverables - 获取交付物列表
router.get('/', (req, res) => {
  const { task_id, employee_id } = req.query;
  let sql = `
    SELECT d.*, e.name as employee_name, t.title as task_title
    FROM deliverables d
    LEFT JOIN employees e ON d.employee_id = e.id
    LEFT JOIN tasks t ON d.task_id = t.id
    WHERE 1=1
  `;
  const params = [];

  if (req.user.role === 'dept_leader' && req.user.department_id) {
    const deptEmpIds = getDeptEmployeeIds(req.user.department_id);
    if (deptEmpIds.length > 0) {
      sql += ` AND (d.employee_id IN (${deptEmpIds.map(() => '?').join(',')}) OR t.assignee_id IN (${deptEmpIds.map(() => '?').join(',')}))`;
      params.push(...deptEmpIds, ...deptEmpIds);
    } else {
      sql += ' AND 1=0';
    }
    if (task_id) { sql += ' AND d.task_id = ?'; params.push(Number(task_id)); }
    if (employee_id) { sql += ' AND d.employee_id = ?'; params.push(Number(employee_id)); }
  } else if (req.user.role !== 'admin') {
    if (req.user.employee_id) {
      sql += ' AND (d.employee_id = ? OR t.assignee_id = ?)';
      params.push(req.user.employee_id, req.user.employee_id);
    } else {
      sql += ' AND 1=0';
    }
  } else {
    if (task_id) { sql += ' AND d.task_id = ?'; params.push(Number(task_id)); }
    if (employee_id) { sql += ' AND d.employee_id = ?'; params.push(Number(employee_id)); }
  }
  sql += ' ORDER BY d.created_at DESC';

  const rows = all(sql, params);
  // 添加可访问的下载URL
  for (const row of rows) {
    if (row.file_path) {
      row.download_url = '/uploads/' + path.basename(row.file_path);
    }
  }
  res.json(rows);
});

// GET /api/deliverables/:id - 获取单个交付物详情
router.get('/:id', (req, res) => {
  const item = get(`
    SELECT d.*, e.name as employee_name, t.title as task_title
    FROM deliverables d
    LEFT JOIN employees e ON d.employee_id = e.id
    LEFT JOIN tasks t ON d.task_id = t.id
    WHERE d.id = ?
  `, [Number(req.params.id)]);

  if (!item) return res.status(404).json({ error: '交付物不存在' });

  if (item.file_path) {
    item.download_url = '/uploads/' + path.basename(item.file_path);
  }
  res.json(item);
});

// POST /api/deliverables/upload - 上传交付物（multipart/form-data）
router.post('/upload', upload.single('file'), (req, res) => {
  const { task_id, title, description } = req.body;
  const employee_id = req.user.employee_id || null;

  if (!title) return res.status(400).json({ error: '交付物名称不能为空' });

  let fileName = '';
  let filePath = '';
  let fileType = '';
  let fileSize = 0;

  if (req.file) {
    fileName = req.file.originalname;
    filePath = req.file.path;
    fileType = req.file.mimetype;
    fileSize = req.file.size;
  }

  const result = run(
    `INSERT INTO deliverables (task_id, employee_id, title, file_name, file_path, file_type, file_size, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task_id ? Number(task_id) : null,
      employee_id,
      title,
      fileName,
      filePath,
      fileType,
      fileSize,
      description || ''
    ]
  );

  res.json({ id: result.lastInsertRowid, fileName, download_url: filePath ? '/uploads/' + path.basename(filePath) : '' });
});

// POST /api/deliverables - 创建交付物记录（不包含文件）
router.post('/', (req, res) => {
  const { task_id, title, description } = req.body;
  const employee_id = req.user.employee_id || null;

  if (!title) return res.status(400).json({ error: '交付物名称不能为空' });

  const result = run(
    `INSERT INTO deliverables (task_id, employee_id, title, description) VALUES (?, ?, ?, ?)`,
    [task_id ? Number(task_id) : null, employee_id, title, description || '']
  );

  res.json({ id: result.lastInsertRowid });
});

// PUT /api/deliverables/:id - 更新交付物
router.put('/:id', (req, res) => {
  const { title, description, task_id } = req.body;
  const item = get('SELECT * FROM deliverables WHERE id = ?', [Number(req.params.id)]);
  if (!item) return res.status(404).json({ error: '交付物不存在' });

  run(
    `UPDATE deliverables SET title=?, description=?, task_id=? WHERE id=?`,
    [
      title || item.title,
      description !== undefined ? description : item.description,
      task_id !== undefined ? (task_id ? Number(task_id) : null) : item.task_id,
      Number(req.params.id)
    ]
  );
  res.json({ success: true });
});

// DELETE /api/deliverables/:id - 删除交付物及文件
router.delete('/:id', (req, res) => {
  const item = get('SELECT * FROM deliverables WHERE id = ?', [Number(req.params.id)]);
  if (!item) return res.status(404).json({ error: '交付物不存在' });

  if (req.user.role !== 'admin' && item.employee_id !== req.user.employee_id) {
    return res.status(403).json({ error: '只能删除自己的交付物' });
  }

  // 删除物理文件
  if (item.file_path && fs.existsSync(item.file_path)) {
    try {
      fs.unlinkSync(item.file_path);
    } catch (e) {
      console.error('删除文件失败:', e);
    }
  }

  run('DELETE FROM deliverables WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

// POST /api/deliverables/:id/apply-confirm - 员工申请交付物审核
router.post('/:id/apply-confirm', (req, res) => {
  const item = get('SELECT * FROM deliverables WHERE id = ?', [Number(req.params.id)]);
  if (!item) return res.status(404).json({ error: '交付物不存在' });

  if (req.user.role !== 'admin' && item.employee_id !== req.user.employee_id) {
    return res.status(403).json({ error: '只能操作自己的交付物' });
  }

  if (item.confirm_status !== 'none' && item.confirm_status !== 'rejected') {
    return res.status(400).json({ error: '该交付物已提交审核' });
  }

  const { confirm_note } = req.body;
  run(
    "UPDATE deliverables SET confirm_status='pending', confirm_note=?, confirmed_by=NULL, confirmed_at='' WHERE id=?",
    [confirm_note || '', Number(req.params.id)]
  );
  res.json({ success: true });
});

// GET /api/deliverables/:id/download - 下载文件
router.get('/:id/download', (req, res) => {
  const item = get('SELECT * FROM deliverables WHERE id = ?', [Number(req.params.id)]);
  if (!item) return res.status(404).json({ error: '交付物不存在' });
  if (!item.file_path || !fs.existsSync(item.file_path)) {
    return res.status(404).json({ error: '文件不存在' });
  }
  res.download(item.file_path, item.file_name);
});

module.exports = router;
