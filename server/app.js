const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { initDb, all, run } = require('./db');
const { auth } = require('./auth/middleware');

async function start() {
  await initDb();

  const app = express();

  // CORS - restrict origin
  app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true
  }));

  app.use(express.json());

  // Global API rate limit: 100 requests per minute
  const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '请求过于频繁，请稍后再试' }
  });
  app.use('/api', globalLimiter);

  // Auth endpoints rate limit: 10 requests per 2 minutes
  const authLimiter = rateLimit({
    windowMs: 2 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '登录尝试过多，请2分钟后再试' }
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);

  // Serve static frontend files
  app.use(express.static(path.join(__dirname, '..')));
  // Serve uploaded files
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  // Auth routes (public - no auth middleware)
  app.use('/api/auth', require('./routes/auth'));

  // API routes (protected - require auth)
  app.use('/api/employees',     auth, require('./routes/employees'));
  app.use('/api/tasks',        auth, require('./routes/tasks'));
  app.use('/api/daily-logs',   auth, require('./routes/dailyLogs'));
  app.use('/api/dashboard',    auth, require('./routes/dashboard'));
  app.use('/api/objectives',    auth, require('./routes/objectives'));
  app.use('/api/deliverables',  auth, require('./routes/deliverables'));
  app.use('/api/weekly-scores',  auth, require('./routes/weeklyScores'));
  app.use('/api/reviews',        auth, require('./routes/reviews'));

  // Fallback to index.html
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
  });

  // Global error handling middleware
  app.use((err, req, res, next) => {
    // Handle multer errors
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: '文件大小超过限制（最大100MB）' });
    }
    if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: '不允许的文件字段' });
    }
    if (err && err.name === 'MulterError') {
      return res.status(400).json({ error: '文件上传失败: ' + err.message });
    }
    if (err && err.message === 'FORBIDDEN_FILE_TYPE') {
      return res.status(400).json({ error: '不允许上传此类型文件' });
    }
    console.error('未处理的错误:', err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  // Periodic session cleanup: every hour, remove expired sessions
  setInterval(() => {
    try {
      const result = run("DELETE FROM sessions WHERE expires_at < datetime('now')");
      if (result.changes > 0) {
        console.log(`已清理 ${result.changes} 个过期 session`);
      }
    } catch (e) {
      console.error('Session 清理失败:', e);
    }
  }, 60 * 60 * 1000);

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`工作追踪系统已启动: http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
