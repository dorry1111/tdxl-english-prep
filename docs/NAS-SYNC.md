# NAS 同步方案（飞牛 fnOS 192.168.31.239）

> 凭据存于 `config/sync.nas.local.json`（本地文件，勿提交/勿分享）。

## 已验证能力（2026-10-24 实测）

| 能力 | 结果 |
|---|---|
| WebDAV 服务 | 已开启：5005 (HTTP) / 5006 (HTTPS 自签) |
| 认证 | Basic，dorry 账户有效 |
| 列目录 | PROPFIND 207 ✓ |
| 写入 | 共享目录内 PUT 201 ✓（根目录 405 只读） |
| 读取/删除 | GET 200 / DELETE 204 ✓ |
| ETag / If-Match | **不支持**（服务端不下发 ETag，If-Match 不校验） |
| CORS | **无 CORS 头**，浏览器不可跨域直连 |
| 其他服务 | SSH 22、SMB 445、NFS 2049、fnOS Web UI 5666/80/443 |

## 同步策略：per-device LWW（最后写入者胜出）

因服务端无 ETag，无法做乐观并发控制，采用经典多端无冲突方案：

1. **每设备写独立文件**：`wordStates.{deviceId}.json`、`reviewLogs.{deviceId}.{月}.json`、`notebook.{deviceId}.json` —— 写入永不冲突
2. **读取时合并**：启动/同步时拉取全部设备文件，按记录级 `updatedAt` LWW 合并到本地；wordStates 主键为 `stateKey`（fnv1a(norm)，跨设备天然对齐）
3. **meta.json** 登记设备清单与各设备最后同步时间
4. 同步目录：`/业务/tdxl-sync/`

## 部署架构（解决 CORS）

```
iPhone / iPad / PC 浏览器
        │  同源请求（无 CORS）
        ▼
NAS Docker nginx（新容器，如 :8100）
   ├─ /            → PWA 静态产物（dist/）
   └─ /dav/        → 反代 http://nas:5005/业务/tdxl-sync/
```

- iPhone 通过 Safari「添加到主屏幕」安装 PWA，局域网直达 `http://192.168.31.239:8100`
- 外网访问预留：fnOS 自带远程访问，或复用已有腾讯云 SCF 代理链路

## 部署记录（2026-10-24 实际完成）

| 项 | 值 |
|---|---|
| PWA 地址 | http://192.168.31.239:8100（Safari 添加到主屏幕） |
| 容器 | `tdxl-pwa`（nginx:alpine，`--restart unless-stopped`，8100→80） |
| 静态目录 | `/vol3/1000/业务/tdxl-pwa/html/`（fnOS 用户共享真实路径 = `/vol{v}/{uid}/<共享名>`） |
| 反代 | `/dav/` → `http://192.168.31.239:5005/业务/tdxl-sync/`（实测 207 认证 / 401 无认证） |
| 缓存策略 | sw.js 与 index.html no-cache；/assets/* 一年 immutable；gzip on |
| 上传通道 | WebDAV PUT（`deploy/upload_webdav.sh`，逐文件校验 2xx + 3 次重试） |

### 部署要点（后来者避坑）
1. fnOS 管理接口（appcgi.dockermgr）经 CLI 创建**带 bind mount 的容器一律被拒**（errno 52428803），最小化创建却放行——绕过方式：SSH 直驱 `docker run`（fnOS 的 SSH 默认 22 开放，dorry 可用，sudo 免密）。
2. fnOS 用户共享的文件系统真实路径是 `/vol{卷}/{uid}/<共享名>`（uid 1000 = dorry），不是 `/vol{卷}/<共享名>`。
3. 共享内目录默认 `drwx------`，容器内 nginx 用户读不到 → `sudo chmod -R a+rX <html目录>` 修复。
4. WebDAV 对 `/业务/` 顶层禁建目录（MKCOL 405），共享内部的子目录可建；`/Docker/` 共享 WebDAV 只读（403）。
5. `业务` 共享一度从 WebDAV 404（用户侧恢复）——共享可用性要作为部署前置检查。

### App 内同步配置（iPhone 首次设置）
设置页 → 同步：
- `webdavUrl`: `http://192.168.31.239:5005/业务/tdxl-sync/`（仅用于路径拼接）
- `useProxy`: 开，`proxyUrl`: `/dav/`（同源相对路径，engine.resolveBaseUrl 拼成 `http://192.168.31.239:8100/dav/`）
- `webdavUser`: dorry，密码存 secrets 表
