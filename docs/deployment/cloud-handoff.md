# Open Design 云端部署交接

更新时间：2026-10-28。面向接手前后端云端部署、镜像发布和 EKS 工作负载操作的同学。

本分支已将 POC 使用的后端能力迁入主仓库，并完成本地容器部署验证。交接目标是：Web 静态产物部署到 Cloudflare，cloud 与独立 renderer 部署到 EKS，连接业务 PostgreSQL 和现有云端 AMR。**当前没有执行 EKS 部署、镜像推送或 Filesys 发布；正式资源验收、边缘代理和部分发布流水线仍需完成。**

## 1. 接手版本与上下文

| 项目 | 位置 / 状态 |
| --- | --- |
| 主仓库 | `nexu-io/open-design`，remote `git@github.com:nexu-io/open-design.git` |
| **交接分支** | **`feature/cloud-poc`**；会话中说的“cloud-poc”是 worktree 名称，不是实际 Git 分支名 |
| 原开发机 worktree | `/Users/bingcola/.codex/worktrees/cloud-poc/open-design` |
| 本次迁移前已有 HEAD | `743fb6cf7cf742b0d0e41b53e649312d98afed9f`；这是历史基线，**不包含本次全部迁移改动** |
| 交接代码 | 本文与前后端迁移、依赖层、部署配置一起提交到上述分支；接手时记录拉取后的完整 HEAD SHA，构建和发布均固定该 SHA |
| 原 POC 参考 | 原开发机 `/Users/bingcola/Documents/research/open-design-cloud-poc/open-design-daemon-poc`，用于核对历史协议和部署配置；新应用不依赖其源码路径 |
| 当前本地入口 | `http://localhost:5182`，操作见[本地容器说明](../../deploy/cloud/local/README.md) |

在干净 checkout 中获取交接版本；已有同名分支时使用正常 fetch/fast-forward，不覆盖未提交改动：

```sh
git fetch origin feature/cloud-poc
git switch --track origin/feature/cloud-poc  # 首次创建本地分支时
# 已有本地分支：git switch feature/cloud-poc && git pull --ff-only
RELEASE_SHA=$(git rev-parse HEAD)
git status --short
```

接手时同时保存前端 artifact revision、两份镜像 digest、资源源 SHA、部署 values 版本、数据库迁移版本。不要仅记录可移动的分支名或 `:local` 标签。本地已运行镜像来自提交前同一工作目录；云端发布必须从提交后的固定源码重新构建，不能把历史基线 SHA 当作新镜像的完整来源。

设计依据：根 [AGENTS.md](../../AGENTS.md)、[迁移方案与历史验收](../../specs/current/cloud-backend-boundaries.md)、[cloud 说明](../../apps/cloud/README.md)、[Web 目标约定](../../apps/web/AGENTS.md)、[Kubernetes 配置](../../deploy/cloud/README.md)、[CI 接口](cloud-ci.md)。

## 2. 已确认的架构与边界

```text
浏览器
  └─ Cloudflare：Web 静态文件、深链接回退、同源 API 代理
       └─ EKS Ingress / 既有入口 → open-design-cloud:19000
            ├─ HTTP routes → facades → biz
            ├─ 一个活动 run worker：任务调度 / 续租 / 订阅
            ├─ bridge.db → adapters/db → 业务 PostgreSQL
            ├─ bridge.auth/runtime/file → adapters → dependencies/amr
            ├─ facades → dependencies/amr：空间、账单、远端项目/会话
            ├─ 只读资源 artifact：catalog + metadata + 资源字节
            └─ bridge.render → HTTP adapter
                 └─ open-design-cloud-renderer:19001（私网独立进程）
                      └─ bridge.render → adapters/render/engine
                           └─ Chromium / FFmpeg
```

| 路径 | 职责与部署含义 |
| --- | --- |
| `apps/web` | 同一源码按 `--target web` / `desktop` 构建；云端只部署 Web 静态产物，不运行 Next server |
| `apps/cloud/src/routes`、`http` | HTTP 解析、Cookie、错误响应、SSE、下载 |
| `apps/cloud/src/facades` | 按业务组织；选择环境数据源、组装事实、执行 biz 决定的外部动作 |
| 根 `biz/` | 单个包；权限、项目/会话、任务/消息、额度解释、文件/导出、事务、幂等、恢复 |
| `packages/bridge` | 能力契约和按进程注册；公开能力为 db/file/proc/auth/runtime/render |
| 根 `adapters/` | 单个包；实现 bridge 能力，公开接口改动必须与 bridge 一一对应 |
| `packages/dependencies/src/amr` | AMR/Vela 已统一为一个 provider；账号 API、登录页、runtime URL 仍分别配置；control key 与 runtime grant 不混用 |
| `apps/cloud/src/jobs` | 调度、并发、领取、续租、订阅、启停；业务重试、状态转换和恢复由 biz 决定 |
| `apps/daemon` | 本次保持原样；新 cloud 不导入其私有实现，也不由它提供云端 API |

两个进程分别注册 bridge：cloud 注册 db/auth/runtime/file/render；renderer 只注册本地 render。不能让 renderer 指向自身的 HTTP adapter，也不能向 renderer 注入 DB、用户凭据或 AMR 配置。proc 无当前消费者，无需补空实现。

任务、原始用户消息、active-run、outbox、事件在同一业务事务写入；外部调用在事务外。未知提交结果不能当作失败直接重发；恢复保留原身份、环境、空间绑定和幂等键。

## 3. 当前功能与真实依赖

已迁入 POC 使用的登录/会话、空间目录/成员/邀请/账单读取、项目/会话、任务/消息/SSE、文件/附件/条件编辑、资源目录/预览、导出和诊断。未迁入完整自动化、MCP、其他 agent CLI、长期记忆、多活动 worker 或持久化渲染队列。memory、云端素材库/Figma 原件及不支持的写入保留明确不可用响应。

**billing 与权限使用真实上游：**余额/套餐/额度通过 AMR billing snapshot、balance、preflight、summary 获取；身份、成员关系、角色与 runtime grant 来自云端。本地 biz 另外检查项目/会话归属和固定空间，当前共享项目/共享资源管理能力仍关闭。

**结算未形成闭环：**本地提交前查询 preflight，主要校验身份/空间匹配与时效；不冻结余额、不记实际扣款/结算账本，返回 `settlement.status=unavailable`、`reason=runtime_usage_not_integrated`。不能据此宣称额度不足拦截、扣费、退款、对账已经完整验收。真实任务可能产生上游用量，是否正确扣费需要与 AMR 同学核验。

本地容器实际配置（沿用 POC，接手者需确认目标环境是否仍使用同一套）：

| 配置 | 当前值 |
| --- | --- |
| profile | `test`，不是 mock 开关；环境改变会影响任务与凭据绑定 |
| 账号 / 空间 / 账单 API | `https://odcloud-amr.inner.nexu.space` |
| 登录页 | `https://odcloud-amr.inner.nexu.space/cloud` |
| runtime API | `https://amr-edge-nnrdrrtrab.cn-shanghai.fcapp.run` |
| runtime ID | `amr-4114` |
| runtime recover | `false`；仅在上游确认支持后开启 |

## 4. 产物与构建

Node `~24`、Corepack `pnpm@10.33.2`。从主仓库根目录构建；固定源码、lockfile 和目标架构。本机已验证的应用镜像是 Apple Silicon/Linux ARM64，不能直接认为适用于 EKS AMD64 节点；当前 backend CI 构建 `linux/amd64`，由实际节点架构决定发布平台。

### Web 静态产物

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter '@open-design/web^...' --workspace-concurrency=1 -r --if-present run build
# 该 URL 必须与本次环境真实登录页一致；生产改地址后要重新构建。
NEXT_PUBLIC_OD_CLOUD_AUTH_BASE_URL=https://odcloud-amr.inner.nexu.space/cloud \
  OD_WEB_OUTPUT_MODE=export corepack pnpm --filter @open-design/web build --target web
OD_WEB_VERIFY_BUILD=1 corepack pnpm --filter @open-design/web test --target web tests/build/production-artifact.test.ts
GITHUB_SHA="$RELEASE_SHA" node .github/scripts/cloud/release.ts prepare-web
```

输出 `.tmp/web-targets/web/build/project/out/`；发布暂存 `.tmp/cloud-web/site/`，外层 `release.json` 保存 SHA 与文件摘要。暂存目录必须不存在，重复构建使用干净 checkout/任务目录。仅发布 `site/`，不要上传 `.next/`、`node_modules`、私有配置或外层回执；暂存步骤排除 sourcemap。桌面 `apps/web/out/` 不是云端产物。目标选择固定在构建时，部署后改环境变量不能切换 desktop/web。

### cloud 与 renderer 镜像

统一使用根上下文的 `deploy/cloud/Dockerfile`：`runtime` 为 API+worker，`renderer` 包含 Chromium/FFmpeg/字体。按目标架构分别构建和推送到团队既有 registry；在已有发布流程完成登录与权限配置。

```sh
# CLOUD_IMAGE / RENDERER_IMAGE：各自完整 registry/repository；TARGET_PLATFORM：目标节点平台。
# 以下为交接者执行的发布步骤，本次未执行。
: "${CLOUD_IMAGE:?Set the backend image repository}"
: "${RENDERER_IMAGE:?Set the renderer image repository}"
: "${TARGET_PLATFORM:?Set the EKS node platform}"
docker buildx build --platform "$TARGET_PLATFORM" -f deploy/cloud/Dockerfile \
  --target runtime -t "$CLOUD_IMAGE:$RELEASE_SHA" --push .
docker buildx build --platform "$TARGET_PLATFORM" -f deploy/cloud/Dockerfile \
  --target renderer -t "$RENDERER_IMAGE:$RELEASE_SHA" --push .
```

部署填两份独立 digest，而非上述标签。Dockerfile 已补齐顶层 biz/adapters，使用 `@open-design/cloud...` 构建依赖闭包；pnpm deploy 时禁用桌面 postinstall。只允许工作区清单及 cloud 所需源码进入上下文，`.env*`、`.tmp`、node_modules 和本机产物不会带入镜像。renderer 不能使用 runtime target 替代。

### 资源 artifact

运行目录包含 `resources/manifest.json` 与对应字节、`official-resource-meta.json`、`catalog.sqlite`；全套作为不可变 artifact 放入既有 PVC 的独立 subPath，仅 cloud 只读挂载。记录完整资源源 SHA，并检查 UID 1000 可读。

```sh
corepack pnpm --filter @open-design/cloud... --workspace-concurrency=1 -r build
# OD_CLOUD_RESOURCE_DIR 为新建空目录的绝对路径；正式资源必须通过此完整命令。
: "${OD_CLOUD_RESOURCE_DIR:?Set an absolute empty resource directory}"
export OD_CLOUD_RESOURCE_DIR
OD_CLOUD_RESOURCE_SOURCE="$PWD" OD_CLOUD_RESOURCE_REVISION="$RELEASE_SHA" \
  corepack pnpm --filter @open-design/cloud resources:prepare
```

资源源需为干净的固定 Git HEAD；修改资源后必须提交新 SHA 再构建。Filesys 发布顺序为 assets → 校验回执 → metadata 条件发布；详见 [CI 协议](cloud-ci.md)。**发布到 Filesys 不等于资源已经写进 EKS PVC**，artifact 分发/挂载需由既有基础设施流程完成。

历史基线资源共 6,888 个文件、902 个条目；15 个条目缺少示例文件或 planned craft 引用，完整 prepare 仍失败，清单见[资源阻塞](../../specs/current/cloud-backend-boundaries.md#资源验收阻塞)。本地 `resources:prepare:local` 保留完整目录及问题标记、选用时拒绝，仅支持本地验证，不能替代正式发布验收。不要以空 catalog、删除问题条目或虚构资源方式跳过校验。

## 5. Cloudflare 与入口映射

Pages/Workers 的具体载体、账号、项目名、域名与发布凭据尚待部署同学在既有基础设施中确定。先接通“静态 Web + 同源后端代理”，不要求照搬本地 Nginx 容器到生产。

| 浏览器路径 / 行为 | 目标与约束 |
| --- | --- |
| `/api/*`、`/artifacts/*`、`/frames/*` | 代理到 cloud；保留路径、query、Cookie/Set-Cookie、Origin、Content-Type、Last-Event-ID、工作空间请求头和下载响应头；绕过静态缓存 |
| `/version`、`/health`、`/ready` | 如对浏览器/运维开放，明确代理到 cloud；不要返回 SPA HTML |
| SSE | 流式转发，关闭缓冲和缓存，允许长连接；核验 Cloudflare、负载均衡和 Ingress 的实际超时，不以 Nginx 3600 秒配置推断整条链路有效 |
| `/projects/...`、`/onboarding` | 刷新与直接访问回退到 `index.html`；API 和缺失静态文件不能回退 SPA |
| `/_next/static/*` | 内容指纹文件可长期 immutable 缓存；HTML 使用 no-store 或等效发布更新策略 |
| 上传 / 下载 | 当前入口 25 MiB 请求限制；JSON 更小，具体以 app 校验为准；保留文件 MIME 和 Content-Disposition |
| 浏览器 Origin | `OD_CLOUD_WEB_URL` 等于最终 HTTPS 站点 Origin；写请求 Origin 不匹配会被拒绝；不要写成 API 内部 Service 地址 |
| renderer | 仅 cloud 私网可访问，不配置公网 Ingress、不做浏览器直接调用 |

可对照 [本地 nginx.conf](../../deploy/cloud/local/nginx.conf)。**现有 chart 可选 Ingress 只声明 `/api`、`/health`、`/ready`，没有 `/artifacts`、`/frames`、`/version`。**接手者必须在实际采用的入口补齐所需路径并验证，或由外部既有入口统一转发。避免旧/新 Ingress 同时接管同一 host/path。当前 chart 注解针对 Nginx Ingress；若 EKS 使用 ALB/其他控制器，需用对应配置，不假定注解有效。

## 6. EKS 配置与密钥

chart 在 [deploy/cloud/chart](../../deploy/cloud/chart)。它当前限制 `target=spark-amr`、namespace=`od-amr-4114`；这只验证模板参数，不能证明 kube-context 指向正确 EKS。**实际 AWS 账号、region、集群名/ARN、kube-context、节点架构及入口控制器仍需接手同学核对。**如目标 namespace/集群边界不同，先调整并验证 chart，不能把 fixture 当成生产 values。

固定 Deployment/Service 名为 `open-design-cloud`、`open-design-cloud-renderer`；同一 namespace 只部署一份，不因换 Helm release 名获得隔离。两个 Deployment 均单副本 Recreate，无 HPA；cloud 含单活动 worker，不能同时启动多副本或与旧 worker 并行工作。

| 输入 | values / 环境变量 | 要求 |
| --- | --- | --- |
| 浏览器域名 | `webUrl` → `OD_CLOUD_WEB_URL` | 最终 HTTPS Origin |
| 上游及环境 | `profile`、`amr.api/web/runtime/id/supportsRecovery` | 对应第 3 节；迁移原任务时保持环境/身份/空间绑定 |
| 业务 DB | `secrets.application` 中 `OD_CLOUD_DATABASE_URL` | 独立业务库，不是 AMR 账号库；使用应用账号 |
| 凭据加密 | 同 Secret 的 `OD_CLOUD_CREDENTIAL_KEYS`、`OD_CLOUD_CREDENTIAL_KEY_ID` | JSON keyring，值为随机 32 字节标准 Base64；active ID 存在；跨重启稳定 |
| DDL 账号 | `secrets.migration` 中 `OD_CLOUD_DATABASE_URL` | 单独授权迁移账号，Job 只读这一项 |
| 资源 | `resources.existingClaim/subPath/revision` | 已存在 PVC、完整只读 artifact、完整源 SHA；revision 变化触发滚动配置更新 |
| 镜像 | `image.repository/digest`、`renderer.image.repository/digest` | 同源码、匹配平台的独立不可变镜像；按需 imagePullSecrets |
| DB 网络 | `postgresAccess.enabled/podSelector` | 现有 POC DB 可加窄范围许可；外部 DB 则关闭并配置对应网络/TLS/权限 |
| renderer 网络 | 自动 Service URL 与允许私网 HTTP 开关 | 仅此 renderer Service HTTP 被允许；NetworkPolicy 只收同 release cloud 流量、禁止出网；确认 CNI 实际执行 |
| ingress | `ingress.enabled/className/host/tlsSecret` | 默认关闭；明确入口归属后才开启，补齐第 5 节路径 |

cloud 还需出网访问 AMR 账号/runtime，以及业务使用的固定 GitHub 公共接口；renderer 不需 DB、AMR、用户凭据、资源 PVC 或外网。平台侧限制云端 API 的访问路径，保留应用身份/Origin 校验。

配置和 Secret 来自既有基础设施/密钥管理，不在代码、values、日志或本文粘贴真实连接串/key。开发机 `.env.cloud-local.local`、密码文件、运行数据、前端构建目录都不随 Git 交付；不要直接用开发机 keyring 作为新环境密钥。迁移已有密文凭据时，必须保留对应旧解密 key，不能随机替换；旧 POC 登录态/Cookie 格式若不兼容，应安排重新登录。

## 7. 数据库、发布与切换顺序

1. **固定源码及目标环境。**接收此分支提交，确认上述环境信息与域名；完成资源修复/完整 prepare、Web 构建、两份目标平台镜像、回执和 digest。先在目标测试环境验证。
2. **准备外部基础设施。**保留 DB/PVC/Secret 的原管理权，准备资源只读卷、稳定 keyring、应用/迁移账号、镜像拉取权限、网络许可和入口/TLS。备份业务数据库并确认恢复路径。
3. **停止旧 worker 接单。**安排维护窗口，排空/记录运行任务，确认旧 POC worker 已停止后再迁移同一业务库。旧/新系统可能使用不同锁机制，不能指望新锁自动阻止旧 worker。
4. **独立迁移。**001–006 保留 POC 原字节；007–009 增加认证、恢复和 Cookie/撤销状态。用同一 runtime 镜像的 `node dist/scripts/migrate.js` 执行。Job 默认关闭，无 Helm hook，`backoffLimit=0`；显式给 `migration.runId`，先建立 DB 网络许可，成功后再启新 cloud。不要一次 apply 全部模板来赌 Job 与 Deployment 顺序，也不要改旧迁移的校验和。
5. **启动两个应用。**先确认 renderer ready，再启 cloud；启动只检查 schema，不自动 DDL。检查资源 revision、DB/schema、worker 锁、日志和探针。Secret 是启动时读取，修改后需通过既有发布流程重启。
6. **配置并切换入口。**安装匹配 Web artifact，同源代理指向新 Service；先测试后切流，保留旧 Web/镜像/资源版本。不同进程就绪不等于登录、计费、任务和导出均验收通过。
7. **完成验收与记录。**按第 9 节执行，记录发布回执、已知问题和回滚基线，再交付实际环境地址。

**不要用这个精简应用 chart 直接 upgrade 原 POC 混合 Helm release。**旧 chart 可能同时管理 PostgreSQL StatefulSet/PVC，替换会让旧 release 中消失的资源被删除。应由基础设施仓库继续保留数据库资源，仅迁应用工作负载；如用独立应用 release，还要处理固定名称与入口归属。

本地模板审查不访问集群：

```sh
helm lint deploy/cloud/chart --strict --namespace od-amr-4114 -f deploy/cloud/fixtures/review-values.yaml
helm template cloud-review deploy/cloud/chart --namespace od-amr-4114 \
  -f deploy/cloud/fixtures/review-values.yaml > /tmp/cloud-review.yaml
```

fixture 使用 `.invalid` 地址和虚构 digest/Secret，仅用于离线审查。正式 values 在既有基础设施仓库维护，先渲染并审查资源 diff，再用明确 kube-context 的现有发布流程分别执行网络、迁移、应用、入口步骤。

## 8. 进程守护、恢复与回滚

- cloud：`/health` 仅 HTTP 存活；`/ready` 检查 DB/schema/worker 所有权。worker 持锁连接丢失后停止领取/订阅、最多 60 秒排空并 exit 1，由 Kubernetes 重启；已有任务按持久状态恢复，不清空 claim、不盲目重提。
- renderer：独立 `/ready` 检查引擎；失败不让 cloud readiness 连带失败，但导出会失败。同步导出没有持久队列，重启中断的导出由用户明确重试。
- Pod 退出宽限 75 秒；startupProbe 约 150 秒；cloud liveness 使用 `/health`，renderer 使用 `/ready`。就绪失败摘流与进程重启是不同机制。
- renderer 临时空间在 chart 中为 256 MiB，本地容器为 512 MiB；上线需用最大预期 PPTX/MP4 样例验证临时空间、内存和执行时长，按实际负载调整。
- 已完成登录依赖持久化 Cookie 映射和稳定 keyring 恢复；未完成设备登录需重新开始。临时上游故障不等于退出登录；取消请求被接受不等于远端任务已经终止。
- 回滚先停止新 worker，再切回经过 schema 兼容检查的应用镜像、匹配资源与 Web artifact/入口。当前没有自动 down migration；不要删除数据库/PVC、回退迁移记录、删除旧解密 key 或重新提交未知结果任务。数据库恢复可能丢失切换后的写入，必须按实际备份恢复方案处理。

## 9. 验收与现有证据

本地已验证：四个容器 healthy；本地业务 DB 001–009；Web 生产构建、生产产物目标隔离、API/静态 404 分流、onboarding/项目地址刷新、SSE、401/Origin 拒绝、cloud → renderer 真实 PDF；renderer 外网连接失败且无 DB/keyring。云端账号 API 无凭据返回 401、runtime 根路径返回 404，证明连通性，不证明扣费或全部业务成功。

历史聚焦测试已覆盖真实临时 PostgreSQL 事务/锁丢失恢复、登录持久化、任务恢复、不重复提交、真实 Chromium/FFmpeg 导出，以及 bridge/adapter/dependency 和 Helm 模板边界。上游在这些自动化集成测试中使用本地协议服务，不能代替线上验收。此前同代码全仓 typecheck/guard 已通过；没有运行完整 daemon/web 套件。详细证据与次数见[迁移记录](../../specs/current/cloud-backend-boundaries.md)和[本地验证记录](../../deploy/cloud/local/README.md#本机验证记录2026-10-28)。

本次交接提交前另外验证 Web 业务入口/宿主边界 19 项通过、1 项跳过，cloud 发布协议与工作流拓扑 94 项通过、1 项跳过；这些检查未启动或修改云端服务。

接手者在云端测试环境完成以下验收并保存脱敏结果：

| 验收 | 预期 |
| --- | --- |
| Web 打开、深链接刷新、静态缓存与 API 错误 | 使用 Web 目标产物；路由无 HTML/JSON 混淆 |
| 真实登录、退出、重启后登录态 | 云端身份可信；退出/撤销生效；凭据和 Cookie 不进入日志 |
| 空间切换、跨用户项目、只读/禁用成员 | 真实权限生效，不能仅靠客户端请求头获得访问 |
| 余额/preflight、缺余额或无可用额度 | 核对云端真实返回及实际拦截行为；单独记录当前结算缺口 |
| 创建项目/会话、正常任务、SSE 重连 | 原幂等键、消息完整、无重复任务；确认上游写入语义 |
| 上传/读取/条件保存/预览 | 路由、权限、大小限制和版本冲突正确 |
| PDF、PNG、PDF-image、可编辑 PPTX、MP4、ZIP | MIME/下载正确；renderer 不出网、不接触 DB；大文件不耗尽临时空间 |
| cloud/renderer 重启与 worker 丢锁 | 在隔离测试环境演练；恢复持久状态，不重发未知提交 |
| 资源发布/读取 | 完整 prepare 成功、artifact/PVC revision 匹配、Filesys 回执及重试验证 |
| 切换/回滚 | 旧 worker 停止、入口唯一、DB/Secret 保持、版本可追溯 |

## 10. 发布流水线缺口与接手清单

| 项目 | 当前状态 / 接手动作 |
| --- | --- |
| 源资源缺失 | 15 条；修复并提交后完整 prepare；不能使用 local 入口冒充正式发布 |
| Cloudflare | workflow 只产出 `site/`；接入实际 Pages/Workers 发布、域名、同源代理、登录构建配置 |
| Web 登录地址注入 | 本地构建显式设置 `NEXT_PUBLIC_OD_CLOUD_AUTH_BASE_URL`；当前 web job 未显式注入，部署前按环境补齐 |
| renderer 镜像 | backend CI 只构建 runtime；给 renderer target 增加同 SHA、同架构的发布及 digest 回执 |
| resources CI 依赖筛选 | `.github/workflows/cloud-release.yml` 两处仍用 `./apps/cloud...`；Docker 已改为 `@open-design/cloud...`。资源 job 需同步正确闭包选择并在干净 runner 验证，避免漏构建依赖 |
| 入口规则 | chart 的可选 Ingress 未覆盖全部代理路径；按第 5 节落实实际入口 |
| EKS 参数 | 当前 chart 有旧目标/namespace 限定；核对实际 EKS 账号/集群、控制器、CNI、PVC 和节点平台 |
| 数据迁移与登录 | 明确复用旧业务库或新建库；同库停旧 worker、保持迁移校验和，确认旧 Cookie/凭据兼容，不承诺自动无感迁移 |
| 真实计费 | 权限与额度读取已接真实 AMR；结算闭环未接，上游实际消耗/拒绝需联合验收 |
| CI 发布分支 | `publish=true` 仅允许默认分支；本 feature 分支用于交接/构建。`web/all` 的 publish 还被占位预检明确拒绝；推送分支不等于发布，不直接绕过门槛 |

接手后优先顺序：**固定交接 SHA → 确认 EKS/域名/数据库方案 → 修复资源并补齐发布链路 → 构建三类产物 → 测试环境迁移/启动/入口联调 → 验收 → 按团队流程正式切换。**

发布完成后在基础设施发布记录中填写：源码 SHA、Web artifact/部署版本、cloud/renderer digest、资源 SHA/subPath、schema 版本、Secret/key ID（不含值）、AWS 账号/集群/namespace、入口 URL、验收结论与可回退版本。
