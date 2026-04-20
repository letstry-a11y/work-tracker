# 畅视OKR管理系统 — 部署Skill记忆点

## 1. 项目架构
- **前端**: 纯静态文件（index.html, js/*.js），无构建步骤
- **后端**: Node.js 18 (Express)，入口 `server/app.js`，端口 3000
- **数据库**: SQLite，文件路径 `/app/server/db-data/work-tracker.db`（容器内）
- **本地数据目录**: `docker-data/db/` 和 `docker-data/uploads/`

## 2. Docker 环境
- **Docker 二进制路径**: `/Applications/Docker.app/Contents/Resources/bin/docker`
- **PATH 设置**（每次执行 docker 命令前需要）:
  ```bash
  export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
  ```
- **Compose 文件**: `docker-compose.yml`（根目录）
- **Dockerfile**: 基于 `node:18-alpine`，`COPY . .` 将代码打包进镜像

## 3. 关键机制：代码不是挂载的
- 代码在 `docker build` 阶段通过 `COPY . .` 复制进镜像
- **只有两个 volume 挂载**:
  - `./docker-data/db` → `/app/server/db-data`（数据库持久化）
  - `./docker-data/uploads` → `/app/server/uploads`（上传文件）
- **修改任何 JS/HTML/服务端代码后，必须重建镜像才能生效**

## 4. 部署流程（每次代码修改后执行）

### 步骤1: 停止旧容器
```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
docker compose -f /Users/chenwanyan/Documents/GitHub/work-tracker/docker-compose.yml down
```

### 步骤2: 重建并启动
```bash
docker compose -f /Users/chenwanyan/Documents/GitHub/work-tracker/docker-compose.yml up -d --build
```

### 步骤3: 验证容器状态
```bash
docker ps --format '{{.Names}} {{.Status}} {{.Ports}}' | grep work-tracker
```
- 期望看到: `work-tracker-work-tracker-1 Up ... 0.0.0.0:3000->3000/tcp`

### 步骤4: 提醒用户
- 强制刷新浏览器 `Cmd+Shift+R` 清除缓存

## 5. 常见问题排查

| 问题 | 原因 | 解决 |
|------|------|------|
| 端口 3000 被占用 | 旧容器未完全停止 | `docker stop <容器名> && docker rm <容器名>` |
| 存在独立容器 `work-tracker` | 之前手动 `docker run` 创建的，非 compose 管理 | `docker stop work-tracker && docker rm work-tracker` |
| 代码改了但没生效 | 没有重建镜像 | 必须 `--build` 重建 |
| docker 命令找不到 | PATH 未设置 | 加上 `export PATH=...` 前缀 |

## 6. 教训

2026-04-13 修改了 `js/dailyLogs.js` 修复编辑时KR不显示的bug，但因为容器内运行的是旧代码，导致修复看似未生效，排查花了额外时间。

**规则：每次修改代码后，必须主动执行完整部署流程（停止→重建→验证→提醒刷新），不能只改文件就认为生效了。**
