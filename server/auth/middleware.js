const { get } = require('../db');

/**
 * 登录校验中间件
 * 从 Authorization: Bearer <token> 头读取 token
 * 验证 session 有效性，将用户信息注入 req.user
 */
function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }
  const token = header.slice(7);
  const session = get(
    "SELECT s.*, u.id as user_id, u.username, u.role, u.employee_id FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime('now')",
    [token]
  );
  if (!session) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
  req.user = {
    id: session.user_id,
    username: session.username,
    role: session.role,
    employee_id: session.employee_id,
  };
  next();
}

/**
 * 管理员权限中间件（必须在 auth 之后使用）
 */
function adminOnly(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: '权限不足，需要管理员身份' });
  }
}

module.exports = { auth, adminOnly };
