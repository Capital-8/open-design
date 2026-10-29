# Cloud / renderer 进程守护

本目录的 chart 从 POC 仓库 `deploy/chart` 迁入应用 Deployment、Service、探针、Ingress 和 renderer NetworkPolicy，适配主仓库 `apps/cloud` 的两个入口。它只提供可审核的工作负载配置，当前未部署；实际环境参数和发布仍由既有基础设施仓库维护。

本机验证使用独立业务数据库容器，runtime 连接云端，见 [local 配置](local/README.md)。

## 运行模型

| 进程 | Kubernetes 配置 | 就绪 / 存活 | 退出与恢复 |
| --- | --- | --- | --- |
| cloud：HTTP + 一个 run worker | 单副本 Deployment，Recreate，restartPolicy Always；直接执行 `node dist/server.js` | `/ready` 检查 DB/schema/worker；`/health` 只检查 HTTP | 丢失持锁连接后停止领取与订阅，清理后 exit 1，最多等 60 秒；重建进程后依持久化记录恢复 |
| renderer：同步导出 | 独立单副本 Deployment，Recreate；执行 `node dist/renderer-server.js` | `/ready` 用于 startup/readiness/liveness，检查本地引擎启动状态，无 DB/AMR 依赖 | 单独重启；中断的导出请求失败，不自动重放或恢复 |

两个 Pod 都配置 75 秒退出宽限期，覆盖应用的 60 秒排空上限；SIGTERM 正常清理完成以 0 退出，排空超时或失败以 1 退出。startupProbe 允许约 150 秒启动。worker 丢锁属于需要退出的所有权失败；普通轮询错误保留技术退避，数据库暂时不可用会让 readiness 失败。renderer 故障不让主进程 readiness 连带失败。

readiness 控制流量，liveness/startup 与退出后的 restartPolicy 控制重启。参见 [Kubernetes probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/) 和 [Pod lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)。本地 `tools-dev cloud start` 仅管理后台生命周期，不提供 Kubernetes 式崩溃自动重启；丢锁同样退出，需再次 start/restart。

## 配置来源与 POC 对应关系

chart 保留 `target: spark-amr` 与 `od-amr-4114` namespace 校验；这不能验证当前 kube-context。实际部署前仍由现有发布流程核对集群。固定工作负载名为 `open-design-cloud` / `open-design-cloud-renderer`，同一 namespace 只安装一份。

| POC 配置 | 主仓库配置 | 使用者 |
| --- | --- | --- |
| `image.repository/digest` | 同名；必须指定 digest，构建 Docker target `runtime` | cloud |
| `renderer.image.repository/digest` | 同名；必须指定 digest，构建 target `renderer` | renderer |
| `amr.api/web/runtime/id` | 同名，映射 `OD_CLOUD_VELA_API_URL/VELA_WEB_URL/AMR_URL/RUNTIME_ID` | cloud |
| 业务 DB 连接串 | 既有 Secret 中的 `OD_CLOUD_DATABASE_URL`；旧 `DATABASE_URL` 值可复用，key 需要适配 | cloud、独立 migration Job |
| 登录凭据持久化配置 | application Secret 的 `OD_CLOUD_CREDENTIAL_KEYS`、`OD_CLOUD_CREDENTIAL_KEY_ID` | 仅 cloud；跨重启保持稳定，轮换时保留旧解密 key |
| POC renderer 内部 HTTP | `http://open-design-cloud-renderer.<namespace>.svc:19001`，显式开启 `OD_CLOUD_RENDERER_ALLOW_PRIVATE_HTTP` | 仅 cloud；该开关只允许 renderer 的 Service DNS，其他上游仍要求 HTTPS |
| 内置资源包 | `resources.existingClaim/subPath/revision`；完整 artifact 以只读卷挂入，revision 为完整源 SHA | 仅 cloud |
| Ingress host/TLS | `ingress.host/tlsSecret`，默认不创建；浏览器 Origin 单独使用 `webUrl` | API 路由；renderer 没有公网路由 |

Secret 只引用必要 key，不在 chart 存储明文，不由 Helm 随机生成。renderer 无 Secret、DB、AMR 变量或业务资源卷；其 NetworkPolicy 只允许同 namespace、同 release 的 cloud Pod 访问 19001，并禁止出网。需要 CNI 实际执行 NetworkPolicy；本地模板测试不验证集群网络隔离。

POC 原 PostgreSQL 策略只允许旧应用标签。`postgresAccess` 默认增加一条独立、窄范围的 ingress 许可，让同 release 的 cloud 和 migration Pod 访问已有 POC PostgreSQL 的 5432；不改旧策略、不重建 DB。使用外部 DB 时关闭该项，由其基础设施配置访问。服务账号 token 不挂载，容器使用 UID 1000、只读根文件系统和独立临时卷。

## 迁移与发布顺序

1. 在既有基础设施配置中准备两个不可变镜像 digest。当前 cloud-release 的 backend 链路只产出 runtime 镜像；renderer 必须用同一源码的 `deploy/cloud/Dockerfile --target renderer` 单独构建并进入既有镜像发布流程，不能拿 runtime 镜像代替。本地 runtime/renderer 镜像已构建并运行；尚未推送云端 registry，EKS 仍需按目标架构构建并记录 digest。
2. 准备完整资源 artifact、只读 PVC/subPath、固定凭据 keyring、业务 DB Secret 与 migration Secret。资源必须预先由现有流程写入；应用启动不生成资源，不执行 DDL。当前分支仍有 15 个资源引用缺失，完整 prepare 尚未通过，见[迁移记录](../../specs/current/cloud-backend-boundaries.md#资源验收阻塞)。
3. 安排维护窗口，备份业务库，停止旧 POC worker，确认没有旧实例继续领取任务。更新业务 DB 访问许可后，单独执行同镜像的 migration Job 并确认成功。Job 默认关闭、backoffLimit=0、无 Helm hook；使用显式 `migration.runId`，启动失败不自动重试 DDL。
4. 启动 renderer 与 cloud，确认各自 ready，核对业务 DB、旧 Cookie/密钥兼容性、原任务状态和上游幂等键。cloud 启动仍要求全局 worker 锁；不增加 HPA 或 cloud 副本数。
5. 在现有入口配置中将 API 流量切到新 Service；避免同 host/path 的旧、新 Ingress 同时争抢。只有明确由此 chart 管理入口时才启用 ingress。保持 nginx SSE buffering off，上传大小为 25 MiB，与 app 上传上限一致。
6. 后续回滚只切换镜像/入口和匹配资源快照，先检查 schema 兼容性；不能自动反向执行数据库迁移或重新提交未知结果的任务。Secret 内容轮换后也要通过既有发布流程重启进程，应用读取的是启动时配置。

**不能将此精简 chart 直接用于升级 POC 原来的混合 Helm release。** 旧 chart 同时声明 PostgreSQL StatefulSet/PVC；替换后 Helm 可能删除旧 release 中消失的资源。应在现有基础设施仓库保留其 DB/PVC/Secret 所有权，只迁移应用工作负载，或为新名称使用独立应用 release，并单独完成流量交接。此 chart 不创建/删除数据库、PVC、业务 Secret，也不接管旧 release。

## 只做本地验证

需要实际启动 cloud/renderer、独立 PostgreSQL 和静态 Web 同源代理时，使用[本地容器部署说明](local/README.md)。该配置不访问 EKS，不发布镜像；部署 chart 的完整资源验收要求不变。

以下命令只渲染本地模板，不访问集群。fixture 使用 `.invalid` 地址和虚构 digest/Secret，不可用于部署：

```sh
helm lint deploy/cloud/chart --strict --namespace od-amr-4114 -f deploy/cloud/fixtures/review-values.yaml
helm template cloud-review deploy/cloud/chart --namespace od-amr-4114 -f deploy/cloud/fixtures/review-values.yaml > /tmp/cloud-review.yaml
HELM_BIN=helm corepack pnpm --filter @open-design/e2e exec vitest run tests/cloud/chart.test.ts
```

如需预览 migration/Ingress，给 template 加 `--set migration.enabled=true,migration.runId=review,ingress.enabled=true`。数据库访问许可需要先于单独执行的 Job 生效；模板顺序不代表执行顺序。真实值来自既有环境，不从测试 fixture 推导。此次不执行 Helm install/upgrade、kubectl apply、数据库迁移、镜像推送或集群故障演练。


## OD test namespace

### Static Web artifact carrier

Build with `OD_WEB_OUTPUT_MODE=export`, `--target web`, and
`NEXT_PUBLIC_OD_CLOUD_AUTH_BASE_URL=https://od-e2e-amr.powerformer.net/cloud`.
Run the existing `prepare-web` command with the verified full source SHA to
produce `.tmp/cloud-web/{site,release.json}`; it rejects symlinks and omits
sourcemaps. Copy `deploy/cloud/nginx.conf` beside those files, then build
`deploy/cloud/Web.Dockerfile` with `.tmp/cloud-web` as its **only** context.
Apply the source revision OCI label and record the resulting linux/amd64 digest.
The pinned nginx base is the existing OD test carrier's base, not a new
unverified release. The carrier runs as nginx on 8080 with only `/tmp` writable.

The existing Ingress proxies cloud paths; nginx serves the static frontend and
client-side project routes. Misrouted API/artifact/frame/health requests return
404 rather than an HTML success. Verify the artifact's release.json, private
image pull, native-cluster health/static/cache/deep-link behavior, and clean up
the disposable probe before replacing the current Web deployment.

The additional supported target/namespace pair is `od-e2e` / `od-test`.
The default `spark-amr` / `od-amr-4114` pair remains available. These are render
constraints; operators must separately verify their kube context and resource
ownership. The application chart still does not create its DB, Secrets or PVC.

`environments/od-e2e.yaml` records the current lane's private Service URLs,
public login origin, existing Secret/PVC names and default-node placement.
Supply image digests, the validated full resource revision and a matching
immutable `resources.subPath` from the release receipt. The file alone cannot
render without those required values. It leaves ingress disabled because the
existing operator release owns `od-e2e.powerformer.net`.

Its opt-in `networkPolicy.enabled` supports only `od-e2e/od-test` with the
existing `od-test-postgres` selector. New rules allow cloud to API/Harness,
renderer and PostgreSQL; migration only to PostgreSQL; existing nginx
controllers/static Web to cloud; and the corresponding AMR peer ingress.
Namespace-local selectors never imply another namespace. The existing renderer
policy already permits only cloud ingress and no general egress; the
foundation's shared DNS allowance remains additive. Cloud/renderer do not carry
the legacy broad `delivery` label. These are rendered policy contracts, not
proof of live enforcement: validate allowed/denied connections after rollout.

`amr.privateHttp=true` enables cloud's account API and Harness backchannel only
for Kubernetes Service roots in the release namespace (`service.namespace.svc`
or `service.namespace.svc.cluster.local`). It sets
`OD_CLOUD_AMR_ALLOW_PRIVATE_HTTP=true` and `OD_CLOUD_AMR_PRIVATE_NAMESPACE`.
The direct process configuration defaults to HTTPS and rejects a missing/invalid
private namespace, external/lookalike hosts, credentials and non-root internal
paths. Browser `webUrl` and `amr.web` retain HTTPS. Renderer keeps its separate
existing private-Service setting.

Optional ingress covers `/api`, `/artifacts`, `/frames` as prefixes and
`/version`, `/health`, `/ready` as exact routes. When the environment already
owns an ingress for the same host, keep chart ingress disabled and update that
owner rather than create a second route owner. Migration remains a separate
explicit step before enabling cloud workloads; no automatic DDL is added.
