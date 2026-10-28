# @open-design/cloud

云端后端包含两个进程：主进程处理 HTTP、facades 和一个活动 run worker；独立 renderer 处理同步导出。主进程注册 db/auth/runtime/file/render，renderer 只注册 render。`apps/daemon` 保持原样。

分层和迁移记录见 [迁移方案](../../specs/current/cloud-backend-boundaries.md)，CI 接口见 [Cloud CI/CD](../../docs/deployment/cloud-ci.md)。

## 构建和数据库

```sh
corepack pnpm install
corepack pnpm --filter @open-design/cloud... --workspace-concurrency=1 -r build
corepack pnpm --filter @open-design/cloud db:migrate
```

`db:migrate` 只读取 `OD_CLOUD_DATABASE_URL`。服务启动不执行迁移；schema/checksum 不匹配会启动失败。001–006 保持 POC 原始字节；007 增加认证和任务恢复字段，008 保存浏览器 Cookie 映射，009 区分显式退出和上游凭据失效。业务数据库不能与 Vela 认证数据库混用。

## 配置

主进程必需配置：

| 变量 | 内容 |
| --- | --- |
| `OD_CLOUD_PROFILE` | `test` 或 `prod`；同时固定任务的环境绑定 |
| `OD_CLOUD_DATABASE_URL` | 业务 PostgreSQL 连接串 |
| `OD_CLOUD_CREDENTIAL_KEYS` | JSON 对象：key ID 到 32 字节密钥的标准 Base64；由密钥管理系统注入 |
| `OD_CLOUD_CREDENTIAL_KEY_ID` | 当前写入密钥的 ID |
| `OD_CLOUD_RESOURCE_DIR` | resources:prepare 生成的资源包绝对目录；包含 resources/、catalog.sqlite、official-resource-meta.json |
| `OD_CLOUD_WEB_URL` | 唯一允许的浏览器 Origin；HTTPS 自动使用 Secure Cookie |
| `OD_CLOUD_VELA_API_URL` / `OD_CLOUD_VELA_WEB_URL` | Vela API 与登录页面地址 |
| `OD_CLOUD_AMR_URL` | AMR API 地址 |
| `OD_CLOUD_RENDERER_URL` | 隔离 renderer 的地址 |

可选 `OD_CLOUD_HOST`（默认 127.0.0.1）、`OD_CLOUD_PORT`（19000）、`OD_CLOUD_MODEL_ID`、`OD_CLOUD_RUNTIME_ID`（amr）。只有部署确认上游支持 recover 时才设 `OD_CLOUD_RUNTIME_RECOVERY=true`，默认 false。服务 URL 要求 HTTPS；loopback 允许 HTTP。显式设置 `OD_CLOUD_RENDERER_ALLOW_PRIVATE_HTTP=true` 后，仅 renderer 额外允许 `<service>.<namespace>.svc` 或 `.svc.cluster.local` 的 HTTP 地址，供隔离的 Kubernetes Service 使用。

renderer 只读取 `OD_CLOUD_CHROMIUM_PATH`、`OD_CLOUD_FFMPEG_PATH`（绝对可执行路径），以及可选 `OD_CLOUD_RENDERER_HOST`（127.0.0.1）、`OD_CLOUD_RENDERER_PORT`（19001）。renderer 不需要数据库、Vela 或用户凭据；部署时应位于受控私网或由受控代理提供 TLS，不能公开匿名渲染接口。

AMR/Vela 的外部协议已合并到 `@open-design/dependencies/amr`。bootstrap 及其装配的 adapters 按需构造 auth/authorization/workspaces/billing/projects/runtime/files/resources 客户端；登录页仍用 `webUrl`，账号 API 用 `apiUrl`，执行 API 用 `runtimeUrl`。上述环境变量名保持兼容：`OD_CLOUD_VELA_API_URL`、`OD_CLOUD_VELA_WEB_URL` 和 `OD_CLOUD_AMR_URL` 分别映射三个地址；现有 POC 配置无需因本次目录合并而改名。adapter 的公开工厂和 bridge 对外接口保持原样。

密钥必须跨重启保存。轮换时保留旧 ID 的解密密钥，切换 active ID 后只影响新写入；删除旧密钥会使对应登录态需要重新授权。不要把密钥放进 Git、日志或资源包。

## 本地生命周期

本地验证可将 cloud、renderer、PostgreSQL 容器化，并由 Nginx 提供 Web 静态构建和同源代理，同时直连现有云端 AMR。配置、持久化卷、迁移与启停命令见 [本地容器验证说明](../../deploy/cloud/local/README.md)。

先准备配置、资源和数据库，再执行：

```sh
corepack pnpm --filter @open-design/tools-dev build
corepack pnpm tools-dev cloud start --namespace cloud-poc --env-file <local-env-file>
corepack pnpm tools-dev cloud status --namespace cloud-poc --json
corepack pnpm tools-dev cloud logs --namespace cloud-poc
corepack pnpm tools-dev cloud stop --namespace cloud-poc
```

`cloud run` 在前台等待，`cloud restart` 重启两进程。它们通过现有 sidecar 生命周期原语工作，先启动 renderer，再启动主进程；不启动 daemon。`--daemon-port` 覆盖云端 API 端口，renderer 使用 `OD_CLOUD_RENDERER_PORT`。namespace 隔离进程身份与日志，数据库隔离必须配置独立 `OD_CLOUD_DATABASE_URL`。

部署平台使用包内 `start` / `start:renderer` 命令；容器直接执行对应 Node 入口以接收 SIGTERM。Kubernetes 的 Deployment、探针、私网访问与迁移顺序见 [进程守护配置](../../deploy/cloud/README.md)。镜像位于 `deploy/cloud/Dockerfile`：默认 target 为 API，`--target renderer` 包含 Chromium/FFmpeg。API 镜像使用独立资源 artifact；以只读方式挂载并配置 `OD_CLOUD_RESOURCE_DIR`。镜像构建不发布资源，不执行迁移或集群更新。

## 恢复和当前限制

- worker 的持锁连接断开后立即停止领取和订阅，报告一次 `worker_ownership_lost`，主进程清理后以 1 退出，最长等待 60 秒；独立 renderer 不受影响。新进程重建调度和订阅，保留未知结果和原幂等键。
- `/health` 检查 HTTP，主进程 `/ready` 检查数据库 schema 和 worker 所有权。renderer 故障仅影响导出；`/api/version` 报告实时渲染能力。
- 登录成功后才持久化关联并设置 Cookie。Cookie、内部 sessionRef、credentialRef 不混用；provider key 以 AES-GCM 密文存储。
- run、用户消息、active-run、outbox、事件同事务提交。原始用户消息与冻结后的 model input 分开保存。
- 未知提交先按稳定 key 查找，不盲目重发；取消响应不代表远端任务已终止。单 worker 的租约/claim/version 阻止迟到结果确认。
- 已完成登录与任务可跨主进程重启恢复；未完成设备登录需要重新开始。失效授权进入 waiting，重新登录后按原身份、原环境和原空间权限恢复；显式退出及取消任务不会自动重绑。
- 资源目录只读；未支持的插件写入、memory、云端素材库/Figma 原件明确返回不可用。额度读自 Vela，未接入真实结算，不模拟扣费。
- 导出保持同步语义；renderer 并发槽为 1，无持久化导出队列。停止会先停接入、排空任务，超时不自动重放。

## 资源构建和发布

`resources:prepare` 读取 `OD_CLOUD_RESOURCE_SOURCE`、完整 SHA `OD_CLOUD_RESOURCE_REVISION`、新建空目录 `OD_CLOUD_RESOURCE_DIR`。只复制受控 Git 资源，校验摘要、LFS、路径、依赖和 Filesys 大小限制；不执行资源脚本，不写入 `ci-source.json`。

`resources:prepare:local` 使用同一快照、摘要及 catalog 构建流程，为本地容器生成 runtime bundle；保留不完整资源的问题标记，并在使用时拒绝这些条目。它不执行全量发布打包、不发布资源，也不代表 release 验收通过。

`resources:publish:assets` 与 `resources:publish:metadata` 读取同一 artifact 和显式 Filesys 配置。assets 验证回执和不可变版本；metadata 核验同包回执并再次验证映射，再通过条件版本发布。资源发布不由服务启动触发。

**当前源数据阻塞**：分支资源快照有 15 个条目的示例/craft 引用缺失，完整 prepare 会失败。详见迁移文档“资源验收阻塞”。本次未改资源内容、未在线发布；修复源内容后从新的完整 SHA 重新 prepare。

## 聚焦验证

```sh
corepack pnpm --filter @open-design/bridge --filter @open-design/dependencies --filter @open-design/adapters --filter @open-design/biz --filter @open-design/cloud -r test
corepack pnpm --filter @open-design/e2e exec vitest run tests/cloud
corepack pnpm --filter @open-design/tools-dev exec node --import tsx --test tests/cloud.test.ts tests/cli-args.test.ts
corepack pnpm guard
corepack pnpm typecheck
```

真实渲染验收需要 Chromium/FFmpeg；测试可通过 `OD_CLOUD_CHROMIUM_PATH` 指定 Chromium。跨进程测试使用真实临时 PostgreSQL、本地 Vela/AMR 协议服务及独立 renderer，覆盖 Cookie 恢复、任务恢复、不重复提交、导出和 tools-dev 启停；它不替代真实 Vela/AMR/Filesys 的部署联调。
