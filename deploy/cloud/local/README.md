# 本地容器部署验证

浏览器入口为 **http://localhost:5182**。Nginx 提供 `--target web` 的生产静态构建，并将 `/api/*`、`/artifacts/*`、`/frames/*`、`/health`、`/ready`、`/version` 同源转发给 cloud。cloud 与独立 renderer 使用 `deploy/cloud/Dockerfile` 的两个 target；业务数据库使用本地 PostgreSQL。登录、Workspace、额度和 runtime 继续调用现有云端 AMR。

这是部署演练配置；源码开发的生命周期仍使用 `tools-dev cloud`。本配置不启动 Next 开发服务器，不部署 EKS，不改动 `apps/daemon` 或原 POC 容器与数据卷。Nginx 模拟 Cloudflare 的静态托管、SPA 回退、缓存与 API 映射，不模拟 Cloudflare Access、WAF、全球 CDN 或公网 TLS。

```text
浏览器 http://localhost:5182
  └─ Nginx：Web 静态产物 + 同源代理（SSE 不缓冲）
       └─ cloud:19000：HTTP + 单活动 run worker
            ├─ postgres:5432：本地业务 DB
            ├─ 云端 AMR：账号 / 空间 / 额度 / runtime
            └─ renderer.cloud-local.svc:19001：隔离渲染
```

| 组件 | 本地配置 |
| --- | --- |
| 浏览器入口 | `127.0.0.1:5182` → Nginx 8080；使用 `http://localhost:5182` 访问 |
| cloud / renderer | 仅 Docker 内网 19000 / 19001，不发布宿主机端口 |
| 数据库 | PostgreSQL 18.4；`127.0.0.1:15432` → 5432；库 `open_design_cloud_local`，用户 `cloud_local` |
| 持久化卷 | `open-design-cloud-local_database`；停止和重建容器保留数据 |
| 云端账号与登录页 | `https://odcloud-amr.inner.nexu.space` / `/cloud` |
| 云端 runtime | `https://amr-edge-nnrdrrtrab.cn-shanghai.fcapp.run`；ID `amr-4114` |

renderer 只接入 Docker `internal` 网络，没有业务密钥、DB、资源挂载或外网出口；cloud 同时接入业务网络和渲染网络。三个应用容器均使用非 root 用户、只读根文件系统和临时目录。数据库沿用 POC 的固定镜像摘要及 `linux/amd64`，Apple Silicon 通过 Docker 平台模拟；应用镜像本地按宿主架构构建，EKS 发布时应按目标节点架构另行构建和发布。

## 私有配置

命令均从 cloud-poc worktree 仓库根目录执行。`.env.cloud-local.local` 保存私有连接串、稳定 keyring、云端地址和本机路径，已被 Git 忽略。数据库密码另存 `OD_CLOUD_LOCAL_DB_PASSWORD_FILE` 指定文件，两个文件权限均为 0600；不要提交或打印内容。

其他机器首次使用时复制本目录 `.env.example`，设置随机数据库密码及匹配的两条 URL、32 字节随机 keyring和绝对路径：

- `OD_CLOUD_DATABASE_URL` 供宿主机工具使用，主机为 `127.0.0.1:15432`。
- `OD_CLOUD_CONTAINER_DATABASE_URL` 供容器使用，相同账号/密码/数据库，主机为 `postgres:5432`。
- `OD_CLOUD_RESOURCE_DIR` 指向下一节生成的真实资源 bundle。
- `OD_CLOUD_LOCAL_WEB_DIR` 指向仓库下 `.tmp/web-targets/web/build/project/out` 的绝对路径。
- `OD_CLOUD_WEB_URL=http://localhost:5182` 必须等于浏览器 Origin。更改端口时同步修改 `OD_CLOUD_LOCAL_WEB_PORT`；不能混用 localhost 和 127.0.0.1。
- 宿主机 Chromium/FFmpeg 路径只供 `tools-dev` 使用；容器 renderer 使用镜像内 `/usr/bin/chromium` 和 `/usr/bin/ffmpeg`。

keyring 必须跨重启保持稳定，不能在每次启动时重新生成；它是本地凭据加密密钥，并非云端 control key。登录使用自己的云端账号。提交真实任务会使用对应云端账号额度。

## 首次构建和启动

先准备静态产物与本地资源（Node 24、Corepack pnpm 10.33.2）：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @open-design/cloud... --workspace-concurrency=1 -r build
NEXT_PUBLIC_OD_CLOUD_AUTH_BASE_URL=https://odcloud-amr.inner.nexu.space/cloud \
  OD_WEB_OUTPUT_MODE=export corepack pnpm --filter @open-design/web build --target web

# 目标目录必须新建或为空；保留全部资源及其问题标记，不伪造缺失内容。
OD_CLOUD_RESOURCE_SOURCE="$PWD" OD_CLOUD_RESOURCE_REVISION="$(git rev-parse HEAD)" \
  node --env-file=.env.cloud-local.local apps/cloud/dist/scripts/resources/prepare-local.js
```

登录地址是前端构建输入；修改云端登录域名后需要重新 build。资源命令只复制固定 HEAD 中干净的受控资源文件，校验摘要、模式和 LFS，并构建 catalog；不执行资源脚本。

下面的 shell 函数只缩写 Compose 参数。Docker Desktop context 使用 `desktop-linux`，其他环境请显式选择对应本地 context：

```sh
cloud_local() {
  docker --context desktop-linux compose --env-file .env.cloud-local.local \
    -f deploy/cloud/local/compose.yaml -f deploy/cloud/local/compose.app.yaml "$@"
}

cloud_local build cloud renderer
cloud_local up -d --wait postgres
# 服务启动不执行 DDL；此命令只迁移上述本地业务数据库。
cloud_local run --rm --no-deps cloud node dist/scripts/migrate.js
cloud_local up -d --wait --wait-timeout 180
cloud_local ps
curl --fail http://localhost:5182/ready
```

`compose.yaml` 仍可单独用于数据库；`compose.app.yaml` 才增加应用服务，避免仅使用数据库时被要求提供应用变量。数据库密码通过 Compose secret 文件注入，数据卷挂到 PostgreSQL 18 的 `/var/lib/postgresql`。已有卷初始化后，修改密码文件不会自动修改数据库密码；不要删除卷来处理普通连接问题。

## 验证与日常控制

登录后可验证当前已迁入 POC 的项目/会话、Workspace、额度读取、任务/SSE、文件读写、附件和导出。全部产品功能并未都迁入：本地 CLI、自动化、MCP 等仍不在本轮范围；memory、云端素材库/Figma 原件等保留明确的不支持响应。

```sh
cloud_local ps
cloud_local logs --tail 100 cloud renderer web
cloud_local stop                 # 停止本次四个服务，保留数据
cloud_local up -d --wait         # 恢复
cloud_local restart cloud        # 修改后端私有配置时改用 up -d 重新创建

# 重新构建后端或前端后更新服务
cloud_local build cloud renderer
cloud_local up -d --wait cloud renderer
# 前端目录是只读 bind mount，重新 build 后生效；验证期间避免与浏览器测试并行构建。

# SQL 调试走容器 socket，不把密码写进命令行。
cloud_local exec postgres psql -U cloud_local -d open_design_cloud_local
```

`restart: unless-stopped` 在进程异常退出后重启容器，也会随 Docker 恢复运行（手动停止的除外）。worker 丢锁会排空并非零退出，从 DB 中恢复调度；Compose 的 healthcheck 只标记健康状态，不会因单纯 unhealthy 自动重启。EKS 的 startup/readiness/liveness 和部署守护见[上层部署说明](../README.md)。不执行 `down -v`，以免删除本次测试数据。

## 资源与验收边界

本地 `resources:prepare:local` 生成真实 runtime bundle，允许目录中保留已标记的不完整条目；选择这些条目时仍由 biz 拒绝，不会发送不完整资源到 AMR。正式 `resources:prepare` 和 publish 命令仍对全部资源打包/校验并在缺失时失败，不能把本地 runtime bundle 当作发布验收通过。

本次固定资源源 SHA `743fb6cf7cf742b0d0e41b53e649312d98afed9f`：6,888 个文件、902 个资源条目；15 个条目存在示例/craft 缺失。列表记录于私有资源目录的 `resource-validation.json`，源问题详见[迁移记录](../../../specs/current/cloud-backend-boundaries.md#资源验收阻塞)。源资源及 `apps/daemon` 均保持不变。


## 本机验证记录（2026-10-28）

- cloud、renderer、PostgreSQL、Nginx 四个容器均 healthy，浏览器入口已打开；原 POC 容器继续保持原运行时间。
- 本地容器迁移校验通过；健康、配置、渲染能力等 9 个 GET 入口返回 200；未登录项目访问返回 401，无 Origin 的写请求返回 403。
- Web 静态 JS 与 immutable 缓存、页面 no-store、onboarding/项目地址刷新、API/静态文件 404 分流及 SSE 转发通过。
- cloud 通过内部服务名调用 renderer，真实生成 29,172 字节 PDF；renderer 外网 TCP 返回 ENETUNREACH，环境中没有业务数据库 URL 或 credential keyring。
- cloud 容器无凭据访问云端账号 API 返回 401，runtime 根路径返回 404，证明 HTTPS 可达；代理未提交真实云端任务，登录后的完整业务流程由用户验收。
- 2 个资源回归用例、1 个 Web 生产产物用例、全仓 typecheck、guard 和差异检查通过；apps/daemon 1,862 个文件及 bridge 23 个文件摘要未变。未运行完整 daemon/web 测试套件。
