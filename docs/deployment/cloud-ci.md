# Cloud CI/CD

完整上下文、交接分支、EKS/Cloudflare 操作顺序及待补齐事项见[云端部署交接](cloud-handoff.md)。

入口为 `.github/workflows/cloud-release.yml`（Actions → Cloud release → Run workflow）。
目前仅手动触发，`target` 可选 `web` / `backend` / `resources` / `all`，
`publish` 默认 `false`。所有组件使用触发运行的同一 Git SHA。
正式写入仅允许默认分支，通过所选 GitHub Environment 管理配置与凭据。

## 三条产物链路

| 目标 | 构建结果 | 发布行为 |
| --- | --- | --- |
| web | `apps/web` 静态导出，artifact `cloud-web-<sha>` 内含 `site/` 与 SHA-256 文件清单 `release.json` | Cloudflare **占位**，尚未执行远程部署 |
| backend | `deploy/cloud/Dockerfile` 构建 `apps/cloud`，仅包含后端及生产依赖 | 推送独立镜像，输出 digest，不修改集群 |
| resources | `apps/cloud` 生成资源包及映射，artifact `cloud-resources-<sha>` | 先上传、校验静态资源，再发布映射文件到 Filesys |

前端运行时只有静态文件，不需要 Next.js server 或 daemon。浏览器 sourcemap
在 artifact 暂存时排除，原始构建输出保持不变。前端发布目录是 `site/`，
外层 `release.json` 是 CI 追溯信息，不应发布为站点文件。

web job 显式执行 `pnpm --filter @open-design/web build --target web`，
从 `.tmp/web-targets/web/build/project/out/` 收集静态文件。
桌面产物保留在 `apps/web/out/`；即使两份产物同时存在，云端暂存也只读取 web 目标。
双端业务模块按 `apps/web/AGENTS.md` 的目录约定在构建时注入。

`apps/cloud` 已提供 build/start、独立 renderer、数据库迁移与资源命令；工作区 lockfile 已更新。构建/启动配置和聚焦验证见 [cloud README](../../apps/cloud/README.md)。当前完整资源链路仍被源快照中 15 个缺失示例/craft 引用阻塞，详见[迁移记录](../../specs/current/cloud-backend-boundaries.md#资源验收阻塞)；禁止将该状态报告为已可发布。

## Cloudflare 占位

后续确定使用 Pages 还是 Workers 后，在 web artifact 下游接部署 job，配置
Cloudflare account、project/worker 名称和发布 token。此次不预设账号、域名或 token，
`publish=true` 且目标含 web 时会在预检阶段失败，其他组件也不会开始发布。

接通时需同时配置同源 `/api/*`、`/artifacts/*`、`/frames/*` 到 cloud 后端的路由、
SSE 流式代理、前端深链接回退和静态缓存策略。授权服务地址等部署配置仍需按环境设置；
业务实现由构建命令的 web 目标选择，不能通过部署后的环境变量切换。

## apps/cloud 构建接口

`apps/cloud/package.json` 必须提供 `build` 和 `start`。
Docker 从仓库根目录构建，仅安装 `@open-design/cloud...` 的工作区依赖，显式构建它们，
通过 `pnpm deploy --legacy --prod` 导出运行包。`start` 必须只依赖生产依赖，
不能依赖 tsx 等开发工具。由 app 的 `files` 字段包含编译产物、迁移及必要运行资源。
镜像使用 Node 24、pnpm 10.33.2，以非 root 用户运行。

cloud/renderer 的 Kubernetes 探针、直接 Node 入口、75 秒退出宽限和迁移切换配置已落在 [deploy/cloud](../../deploy/cloud/README.md)。当前 backend CI 仍只产出 runtime 镜像；renderer 镜像需要以同一 Dockerfile 的 renderer target 单独构建。此 chart 不触发 CI 部署，也不接管既有 PostgreSQL/PVC/Secret。涉及现有 daemon 的数据路径规则，
参见根目录 [AGENTS.md 的 Daemon data directory contract](../../AGENTS.md#daemon-data-directory-contract)。

镜像构建/推送复用 `.github/workflows/docker-image.yml` 的 cloud 分支，
现有 desktop/stable 分支默认行为不变。每次运行使用
`sha-<commit>-<run_id>-<attempt>` 标签，部署平台应使用日志中的 `image@sha256:...`。
当前平台为 `linux/amd64`。`publish=false` 只验证构建，BuildKit 结果留在构建缓存。

## apps/cloud 资源发布接口

资源格式和依赖展开由 `apps/cloud` 的资源命令拥有，Filesys 外部协议由 `packages/dependencies/filesys` 拥有，CI 不复制另一套实现。
app 接入时提供以下 package scripts：

| 命令 | 必须满足的行为 |
| --- | --- |
| `resources:prepare` | 从指定仓库快照生成全部静态资源和 `official-resource-meta.json` 等映射；检查依赖、内容摘要及未拉取的 LFS 指针；不访问线上服务 |
| `resources:publish:assets` | 从已下载的资源包上传静态资源；按内容摘要去重；验证远端回执及所有映射引用；任何缺失或冲突返回非零 |
| `resources:publish:metadata` | 仅在 assets 成功后发布同包中的映射文件；使用 Filesys 的版本/并发控制协议；输出可追溯版本回执 |

三个命令均从 `apps/cloud` 目录执行，读取以下环境变量：

- `OD_CLOUD_RESOURCE_SOURCE`：本次 checkout 的绝对路径。
- `OD_CLOUD_RESOURCE_REVISION`：完整 Git SHA。
- `OD_CLOUD_RESOURCE_DIR`：资源包绝对路径。prepare 接收新建空目录并写入它；publish 只读取同次运行下载的包，不重新生成。
- `FILESYS_PUBLISH_URL`、`FILESYS_PUBLISH_TOKEN`：只在发布步骤注入。

CI 在资源包中写入保留文件 `ci-source.json` 并在发布前核对 SHA。
app 命令不可覆盖该文件，也不能把 token、用户数据或运行环境配置写进 artifact。
映射发布失败不回滚已上传的内容寻址资源；使用相同源版本重试，publisher 必须幂等。
环境级 concurrency 避免同一流程同时改指针，但外部发布者的竞争仍由 Filesys 的
条件写入协议解决。接口已实现并通过本地协议测试；真实 Filesys 集成验收和部署仍需在资源源数据修复后执行。

## GitHub 配置

默认 Environment 名为 `cloud-staging`，可在 dispatch 时选择其他已有 Environment。

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Environment variable | `CLOUD_REGISTRY` | 镜像 registry host，可带端口，不含协议 |
| Environment variable | `CLOUD_BACKEND_IMAGE` | 完整镜像名，以 `CLOUD_REGISTRY/` 开头，不含 tag/digest |
| Environment secret | `CLOUD_REGISTRY_USERNAME` / `CLOUD_REGISTRY_PASSWORD` | 镜像推送凭据 |
| Environment variable | `FILESYS_PUBLISH_URL` | HTTPS Filesys origin，不含路径、查询或用户名密码 |
| Environment secret | `FILESYS_PUBLISH_TOKEN` | Filesys operator 发布凭据 |
| Repository variable | `CLOUD_PUBLISH_RUNNER` | 可选，能访问私网 Filesys 的 runner label；默认 `ubuntu-24.04` |

不配置发布凭据也能运行构建。此工作流不创建账户、集群或 Cloudflare 配置，
不触发迁移或重启服务。开启自动发布触发器前，应先完成 frontend/cloud 协议联调、
后端镜像启动验证、Filesys 发布及重试验证，再接入所需分支/环境策略。
