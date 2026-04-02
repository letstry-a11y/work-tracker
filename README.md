# 工作追踪与评分系统

员工工作追踪与自动评分系统，基于 Node.js + SQLite + 原生 HTML/CSS/JS 构建。

## 功能特性

- **用户系统**：注册/登录，支持普通员工和管理员两种角色
- **仪表盘**：统计数据、本周活动网格、目标完成情况、延期预警
- **目标管理 (OKR)**：创建目标 (O) 和关键结果 (KR)，支持权重配置
- **任务管理**：创建/编辑/删除任务，关联目标和负责人，支持优先级 (P0-P3) 和难度评分
- **每日填报**：员工每日填写工作日志，记录工时和内容
- **交付物管理**：上传文件交付物，关联任务，管理员审核
- **审核记录**：统一管理任务和交付物的审核流程，支持通过/打回
- **员工管理**：员工档案管理 + 用户账号管理
- **自动评分**：根据任务完成情况、工时投入、难度系数自动计算周评分
- **主题切换**：支持浅色/深色主题

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | 原生 HTML5 + CSS3 + JavaScript ES6+ (无框架) |
| 后端 | Node.js + Express |
| 数据库 | SQLite (sql.js) |
| 认证 | Cookie + Session |
| 安全 | bcryptjs 密码加密、express-rate-limit 限流 |

## 项目结构

```
work-tracker/
├── index.html          # 前端入口页面
├── css/
│   └── styles.css      # 样式文件
├── js/
│   └── app.js          # 前端逻辑
└── server/
    ├── app.js          # Express 服务入口
    ├── db.js           # SQLite 数据库初始化
    ├── auth/
    │   └── middleware.js   # 认证中间件
    ├── routes/             # API 路由
    │   ├── auth.js
    │   ├── employees.js
    │   ├── tasks.js
    │   ├── dailyLogs.js
    │   ├── objectives.js
    │   ├── deliverables.js
    │   ├── reviews.js
    │   ├── dashboard.js
    │   └── weeklyScores.js
    ├── uploads/           # 上传的交付物文件
    └── node_modules/
```

## 快速启动

```bash
cd server
npm install
node app.js
```

服务启动后访问 http://localhost:3000

## 默认账号

首次启动后需手动注册账号，第一个注册的用户默认为 **管理员** 角色。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/register | 注册 |
| POST | /api/auth/login | 登录 |
| GET/POST | /api/employees | 员工管理 |
| GET/POST | /api/tasks | 任务管理 |
| GET/POST | /api/daily-logs | 每日日志 |
| GET/POST | /api/objectives | 目标 (OKR) |
| GET/POST | /api/deliverables | 交付物 |
| GET/POST | /api/reviews | 审核记录 |
| GET | /api/dashboard | 仪表盘数据 |
| GET | /api/weekly-scores | 周评分数据 |

## 评分规则

周评分由以下维度自动计算：
- **目标完成率**：KR 完成数 / 总 KR 数
- **任务完成率**：已完成任务 / 总任务数
- **延期惩罚**：延期任务数越多分数越低
- **工时效率**：实际工时 / 预估工时 (合理区间加分)
- **难度加权**：高难度任务完成权重更高
