# Blissful Faraday

自托管的**极简高动态平铺图片集播放系统**——把一个装满照片/视频的目录变成一面自动轮播的照片墙。专为万级目录规模设计，零数据库、单进程、开箱即用。

## 功能特性

- **文件夹即图集**：扫描目录下每个子文件夹就是一个图集，自动以 CSS Grid 平铺满整个视口，支持自动布局与手动网格两种模式
- **窗口协调轮播**：所有图集独立或同步轮播，速度可调（0.5–5s）；桌面端多窗口布局，移动端专属同步轮播卡片
- **为 10,000+ 目录优化**：持久磁盘缓存索引（首次扫描后写入 `.collection-cache.json`），服务重启后秒级恢复；目录只读时自动回退内存缓存
- **安全的媒体管理**：单张图片 / 单个视频独立删除，UndoToast 防误触撤销；图集整册删除需二次确认
- **认证与安全中心**：bcrypt 密码哈希登录、HttpOnly 会话 Cookie、会话列表管理与吊销、访问日志审计
- **Instagram 浏览同步**（油猴脚本）：正常刷 IG 时自动把已加载的图片/视频回传到本地画廊，请求节奏与真人浏览一致，详见 [`userscripts/README.md`](userscripts/README.md)

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + Vite 5，lucide-react 图标 |
| 后端 | Node.js 原生 `http` 模块（无框架），与 Vite dev/preview 共享同一套 API 中间件 |
| 存储 | 纯文件系统 + JSON 缓存文件，无数据库 |
| 认证 | bcryptjs 密码哈希 + 服务端会话令牌 |

## 快速开始

要求 Node.js ≥ 18。

```bash
npm install

# 开发模式（http://localhost:3000）
npm run dev

# 生产构建 + 独立服务器
npm run build
node server/index.js          # 默认 3000 端口
PORT=4000 node server/index.js  # 自定义端口
```

启动后打开页面，在设置里指定**扫描目录**（默认 `./resources/`）——里面每个子文件夹都会变成一面轮播窗口。

## 配置文件

全部运行时配置不进版本库（已列入 `.gitignore`）：

| 文件 | 作用 |
|---|---|
| `.auth-config.json` | 认证配置：密码哈希、会话令牌、访问日志（首次登录时自动生成，模板见 `.auth-config.json.example`） |
| `.scan-directory.json` | 当前扫描目录 |
| `.collection-cache.json` | 目录索引缓存，直接写在扫描目录内，可随时删除重建 |
| `resources/` | 媒体文件本体 |

## API 概览

所有 `/api/*` 路由（除登录/状态外）均需会话认证：

- 认证：`/api/auth/status` · `login` · `logout` · `admin/config` · `admin/update` · `admin/revoke-session` · `admin/clear-logs`
- 内容：`/api/collections` · `/api/collection/images` · `/api/collection/info` · `/api/collection/delete` · `/api/image`
- 维护：`/api/settings` · `/api/cache/info` · `/api/cache/clear`
- 脚本回传：`/api/instagram/harvest` · `/api/instagram/harvest-blob`
- 油猴脚本托管：`/userscripts/blissful-harvest.user.js`（浏览器直接打开即可安装，内置自动更新）

## 目录结构

```
├── server/            # 生产服务器 + API 中间件（认证/扫描/缓存/回传）
├── src/
│   ├── components/    # 布局、轮播、登录、安全中心、UndoToast 等
│   ├── hooks/         # 删除撤销、图片预加载、轮播播放、拖拽
│   └── ...
├── userscripts/       # Instagram 浏览同步油猴脚本（含独立文档）
├── vite.config.js     # 开发/预览服务器 + API 中间件挂载
└── index.html
```

## 安全说明

- 服务器监听 `0.0.0.0`，公网部署请务必置于反向代理（HTTPS）之后，并设置强密码
- 会话令牌仅以 HttpOnly + SameSite=Strict Cookie 下发，日志中只保留 SHA-256 摘要
- 静态文件服务做了路径穿越防护，API 回传端点校验媒体来源域名
- 仅限个人自用；批量自动化采集违反 Instagram 服务条款，请勿用于其他用途
