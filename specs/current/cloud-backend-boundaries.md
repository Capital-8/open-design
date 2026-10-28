# Cloud 后端渐进式迁移方案

确认日期：2026-10-27。目标分支：`feature/cloud-poc`。POC 源码路径在本文中均相对于 `open-design-daemon-poc` 仓库根目录。

本文是本次迁移的架构、目录、源码对应关系和迁移顺序的事实来源。根 AGENTS 只记录跨仓库边界，目录级实施规则见 [cloud](../../apps/cloud/AGENTS.md)、[biz](../../biz/AGENTS.md)、[bridge](../../packages/bridge/AGENTS.md)、[adapters](../../adapters/AGENTS.md)、[dependencies](../../packages/dependencies/AGENTS.md)。

## 范围与当前状态

本次目标是将 POC 已使用的云端后端迁回主仓库。`apps/daemon` 的源码、运行方式和调用链保持不变；不从其他 app 私有源码跨目录导入实现。不顺带迁移 POC 未使用的完整长期记忆、MCP、自动化、其他 agent runtime 或客户端 CLI 集成。

阶段 1–7 的实现已接入，阶段 8 的兼容接口、资源构建/发布协议、部署入口与 tools-dev 两进程生命周期已实现。本次未修改 apps/daemon，也未在线部署或发布资源。业务实现位于根 biz，基础能力位于根 adapters，协议位于 packages/dependencies。

| 区域 | 当前实现 | 剩余验收限制 |
| --- | --- | --- |
| bridge / adapters | 按进程注册；PostgreSQL 事务/claim、只读 catalog、持久化 auth、AMR runtime/file、本地与 HTTP render | proc 无消费者，不强制注册 |
| apps/cloud / biz | 身份/空间/账单、项目/会话、输入/附件、任务/journal/outbox、资源/预览、同步导出与恢复 | 不宣称多副本调度或已接入真实结算 |
| dependencies | 统一 AMR/Vela（amr）、renderer、固定匿名 GitHub、Filesys | 本地协议测试不等于在线服务联调 |
| 资源 | 指定 Git SHA 的离线快照、catalog、依赖图、条件发布/回执 | 当前源快照 15 个不完整条目阻止完整资源发布，见末尾 |
| 两进程 | 主进程与 renderer 独立注册、tools-dev cloud 启停；真实 PostgreSQL 重启恢复已验证 | 尚未进行集群/镜像部署与真实 upstream 验收 |


## 六项已确认决策

| 问题 | 决策 |
| --- | --- |
| 1. facades 与 biz | facades 获取、转换、组装数据并衔接调用；业务规则、权限、状态转换、事务与持久化决策归 biz。facades 按用例组织，不与 routes 一一对应。 |
| 2. dependencies 与 adapters | 已有基础能力走 bridge -> adapter；其他外部协议可由 facade 调 dependencies。供应商名称不成为 bridge 能力。 |
| 3. db 与事务 | biz 定义原子边界，bridge 定义事务契约，adapter 执行物理事务。任务、消息、项目状态、outbox、事件共同提交。 |
| 4. jobs | jobs 管调度、并发、租约、订阅和生命周期；biz 管执行决策、重试、恢复和结果；facades 衔接依赖。 |
| 5. 进程注册 | 应用按启用模块声明进程需求，每个进程注册一次；renderer 只注册 render。接口完整性、支持范围、资源就绪分别校验。 |
| 6. 重启恢复 | 持久化应用会话、密文凭据、任务授权关联和执行进度；grant 按需重建，凭据失效不等于远程任务失败。 |

## 多进程部署与注册

一个 `apps/cloud` 包提供两个入口：

```text
浏览器 -> Cloud 主进程（HTTP + facades + biz + run jobs）
               |-> PostgreSQL：业务数据、会话、密文凭据、授权关联
               |-> AMR / Vela：通过相应 adapter 或 dependencies
               |-> bridge.render -> HTTP render adapter
                                         |
                                         v
                               独立 renderer 进程
                               routes -> jobs/render
                                      -> bridge.render -> 本地引擎
```

- 主进程承载一个活动 run worker；renderer 不领取 run outbox，不持有用户凭据，不访问业务数据库。本次不单独拆 run-worker 服务，也不宣称多副本安全。
- 主进程按启用模块注册，完整 POC 通常需要 db/auth/runtime/file/render；没有 proc 消费者时无需注册 proc。renderer 只注册 render 的本地实现，不能注册指向自身的 HTTP adapter。
- bridge 绑定在进程内存中，不跨进程共享。主进程内 API 与 jobs 共用一次注册；独立 renderer 自行注册。各进程复用相同契约，不复用另一个进程的内存对象。
- `register(bindings, { required })` 已实现。required 来自启用消费者，不能从已提供 bindings 的键反推。已提供能力必须完整；缺必需项、未知能力名、缺方法时原子失败；所有转发入口显式检查未初始化或能力缺失。
- 注册只验证结构。应用另行验证支持的功能与资源就绪。当前 runtime.getCapabilities 是配置声明，不能当作网络健康检查；不得为探测而创建真实项目或任务。
- main/renderer 分别解析配置、构造依赖并清理启动失败资源。renderer 不能被公共配置要求提供数据库 URL 或 Vela 凭据，也不能通过 eager import 初始化不使用的 adapter。
- 瞬时依赖故障的 readiness 策略属于 app；单个用户需重新授权不阻止全服务就绪。不得以空实现、取消注册或运行时切换 bindings 隐藏失败。

## 第一阶段入口与使用限制

- `@open-design/cloud/server` 导出 `startMain`：启用模块声明 name/required/start，启动时汇总需求，再构造资源。主进程至少启用一个模块；不预置尚未迁入的业务模块。
- `@open-design/cloud/renderer-server` 导出 `startRenderer`：仅声明 render，由 app 装配本地实现；额外能力会被拒绝。本地引擎通过 renderer-server 装配，部署命令为包内 start:renderer。
- 资源工厂显式提供 bindings、checkSupport、checkReadiness 和 close。结构注册、支持检查、就绪检查全部通过后才调用模块 start。每个 start 返回清理函数；停止和失败按逆序清理，清理错误保留原始失败。
- 工厂或模块在返回前失败，必须自行清理其部分分配的资源。一次进程只允许一次启动尝试，包括并发调用和停止后；注册后失败必须结束该进程，不通过重新绑定或 reset 重试。
- 第一阶段入口是可调用的装配边界，导入无监听端口、后台任务、环境读取或真实上游请求。具体模块/config 和 tools-dev 生命周期现已接入；不新增根 start/dev 别名。
- 构建与校验见 [apps/cloud/README.md](../../apps/cloud/README.md)。biz 仅消费 bridge/contracts；dependencies 由 facades/adapters 消费。具体配置和命令以 apps/cloud/README.md 为准。

## 第二阶段协议提取

| 原实现 | 协议归属 | adapter 保留 |
| --- | --- | --- |
| adapters/auth 中的 Vela URL、请求/响应 schema | dependencies/amr：device authorization、token、profile、activation URL 校验 | 尝试/会话状态、轮询节奏、取消、身份归一化、私有凭据解析 |
| runtime/authorization 中的 grant HTTP | dependencies/amr：harness authorization 请求和 grant DTO | 作用域匹配、凭据版本、有效期、撤销检查、grant 缓存 |
| runtime 中的 AMR HTTP、DTO、SSE framing | dependencies/amr：既有 run/session/stream 协议 | bridge 输入与引用匹配、能力声明、状态/快照/事件归一化、订阅关闭和单次消费 |
| render 中的 HTTP、wire schema、输出校验 | dependencies/renderer：ready、render-export、超时/大小限制/MIME 与字节验证 | bridge 格式能力过滤、不可用状态和错误转换 |
| adapters/internal/http | dependencies/internal/http、error；adapter 侧仅保留 internal/errors 映射 | BridgeError 及 HTTP status 的兼容形态 |

dependencies 的根入口仅导出错误类型，协议通过 amr/renderer/github/filesys 子路径按需加载，不读取环境、cookie 或应用凭据。所有网络调用使用注入 fetch。它不依赖 bridge、adapters、biz 或 app 源码。

本阶段不修改 bridge 接口、注册或转发源码；保持请求 payload、超时、响应限制、错误 code/uncertain/requestId/status，以及 AMR 首次明确 401 后仅一次授权刷新重放。缓存、撤销竞态、一次性 device token 保存与订阅生命周期仍由 adapters 管理。阶段 4–8 已随消费者加入项目/会话、工作空间、账单、GitHub 与 Filesys 协议，保持本节边界。

## 第三阶段数据库

- bridge.db 提供 read() 与 transaction()，按账号、项目、会话、任务、消息、事件、outbox、会话/凭据密文、附件和草稿分组；不暴露 SQL 或 pg。事务结束后句柄失效，嵌套事务与未 await 操作显式失败。
- adapters/db/postgres 执行同连接事务、只读记录访问、项目/会话/任务加锁与 revision 条件更新；outbox 按 token、version、未过期租约共同确认。正常轮询不自动增加业务失败次数。
- 原始 001–006 迁移保持逐字节一致；007 增加持久化认证与恢复字段，008 保存 Cookie 映射，009 标记显式退出以关闭退出后崩溃的重绑窗口。启动核对全部迁移编号及摘要，迁移和业务访问拒绝 Vela 认证数据库。
- apps/cloud 的 db:migrate 命令单独执行部署迁移；服务 readiness 只检查 schema，不自动执行 DDL。
- 真实临时 PostgreSQL 已验证五个写入点故障全部回滚、唯一请求、并发领取、过期及重新入队后的旧确认、迁移摘要、认证库隔离、单 worker 所有权；协议级测试覆盖 COMMIT 响应丢失和已确认拒绝。阶段四已接入登录持久化。

## 各层职责和调用边界

| 层 | 职责 | 不应承担 |
| --- | --- | --- |
| apps/cloud/routes、http | 请求解析、HTTP 校验、cookie、错误码、SSE、下载响应 | SQL、任务状态转换、额度准入 |
| apps/cloud/facades | 选择当前端的数据来源，规范化和组装事实；执行 biz 决定的外部动作并交回结果 | 权限决策、重试策略、补偿、业务事务 |
| biz | 账号、工作空间、项目/会话、任务/消息、资源、提示词、文件、导出等业务；事务、幂等、恢复 | Express、供应商协议、端差异分支、具体数据库驱动 |
| packages/bridge | 操作、参数、事实、错误和事务契约；启动注册与转发 | 真实 I/O、供应商实现、进程角色枚举 |
| adapters | 实现同一能力目标的环境兼容；数据库/文件/执行/认证/渲染机制 | 项目创建流程、业务权限、额度规则、任务重试决策 |
| packages/dependencies | 外部供应商/服务协议（AMR/Vela 统一 amr，另有 renderer、GitHub、Filesys）、DTO、请求响应校验与传输错误 | biz、bridge、adapters 或 app 私有源码依赖；全局当前用户 |
| apps/cloud/jobs | 轮询、执行槽、领取/续租、订阅、启停和资源限制 | 自行修改业务状态、重新创建任务、解释账单 |

业务层可以使用已注册 bridge，但不直接调用 dependencies。facades 和 adapters 可以使用 dependencies；后者通过适配归一化结果，前者将事实交给 biz。dependencies 不反向导入这些层。

| 操作 | 调用路径 |
| --- | --- |
| 登录事实和协议 | facade -> bridge.auth -> auth adapter -> Vela protocol |
| run 提交/查询/取消/恢复/快照/事件 | facade -> bridge.runtime -> runtime adapter -> AMR protocol |
| 文件读写/列表/条件保存 | facade 或对应 biz 用例 -> bridge.file -> file adapter |
| 渲染 | facade -> bridge.render -> HTTP adapter -> renderer -> 本地 render adapter |
| 数据库业务读写 | biz -> bridge.db -> db adapter |
| AMR 远端项目/会话创建 | biz 准备动作 -> facade -> dependencies/amr -> biz 保存结果与映射 |
| Vela 工作空间、成员/邀请、账单/额度读取 | facade -> dependencies/amr -> biz 解释事实；变更动作须先由 biz 授权 |
| AMR 官方资源、GitHub 公共信息 | facade -> 对应 dependencies -> biz |
| 领取/续租 | jobs -> bridge.db；业务结果与 outbox 确认仍在 biz 事务中 |

已有能力覆盖的操作不能绕开 bridge；bridge 失败也不能自动回退到 dependencies。AMR 创建项目/会话是外部协议操作，完整创建流程始终属于 biz；不得以 createExecutionProject/createExecutionSession 等别名放回 runtime。

公开能力仍只有 db、file、proc、auth、runtime、render。auth 的 getLoginState/startLogin/pollLogin/cancelLogin/logout，runtime 的 getCapabilities/submitRun/getRun/cancelRun/recoverRun/getSnapshot/streamEvents，以及 render 的 getCapabilities/render 保持既定边界。getRuntimeAuthorization 与凭据解密是服务端私有实现，不新增公开 token/credentials 能力。

## 目标目录

以下是迁移目标，不要求一次性搭建全部空目录。biz、adapters、dependencies 各自只有一个 package.json。tests 与 src 同级。

```text
open-design/
├── apps/
│   ├── daemon/                         # 不改动
│   ├── web/                            # HTTP/SSE 消费者
│   └── cloud/
│       ├── AGENTS.md
│       ├── package.json
│       ├── src/
│       │   ├── server.ts               # HTTP + run jobs
│       │   ├── renderer-server.ts      # 独立渲染入口
│       │   ├── bootstrap/
│       │   │   ├── main.ts
│       │   │   ├── renderer.ts
│       │   │   └── requirements.ts
│       │   ├── config/
│       │   │   ├── main.ts
│       │   │   └── renderer.ts
│       │   ├── http/
│       │   │   ├── auth-context.ts
│       │   │   ├── errors.ts
│       │   │   ├── sse.ts
│       │   │   └── downloads.ts
│       │   ├── routes/
│       │   │   ├── account.ts
│       │   │   ├── workspaces.ts
│       │   │   ├── projects.ts
│       │   │   ├── conversations.ts
│       │   │   ├── runs.ts
│       │   │   ├── files.ts
│       │   │   ├── resources.ts
│       │   │   ├── exports.ts
│       │   │   ├── public-metadata.ts
│       │   │   ├── compatibility.ts
│       │   │   └── renderer.ts
│       │   ├── facades/
│       │   │   ├── account/            # 含登录、账号与隐私数据衔接
│       │   │   ├── workspaces/         # 含成员与账单来源组装
│       │   │   ├── projects/           # 项目及会话创建外部步骤
│       │   │   ├── runs/               # 提交入口与后台 dispatch 分开
│       │   │   ├── resources/
│       │   │   ├── files/
│       │   │   ├── exports/
│       │   │   └── public-metadata/
│       │   └── jobs/
│       │       ├── index.ts
│       │       ├── runs/
│       │       │   ├── poll.ts
│       │       │   ├── dispatch.ts
│       │       │   ├── recovery.ts
│       │       │   └── streams.ts
│       │       └── render/
│       │           └── execute.ts
│       ├── scripts/
│       │   ├── migrate.ts
│       │   └── resources/              # 目录构建、校验、发布入口
│       ├── deploy/                     # 包内运行镜像/资源适配
│       └── tests/
├── biz/
│   ├── AGENTS.md
│   ├── package.json
│   ├── src/
│   │   ├── account/                    # 映射、隐私、授权后业务处理
│   │   ├── workspaces/                 # 固定绑定与权限
│   │   ├── billing/                    # 事实解释与准入
│   │   ├── projects/
│   │   ├── conversations/              # 消息、事件、游标
│   │   ├── runs/                       # 幂等、状态、重试和恢复
│   │   ├── prompts/                    # 策略、示例、附件上下文
│   │   ├── catalog/                    # 资源绑定与预览规则
│   │   ├── files/                      # 含附件和编辑状态
│   │   ├── exports/
│   │   └── public-metadata/
│   └── tests/
├── adapters/
│   ├── AGENTS.md
│   ├── package.json
│   ├── src/
│   │   ├── db/
│   │   │   ├── postgres/              # 事务、SQL、记录访问
│   │   │   ├── catalog/               # 只读资源 SQLite
│   │   │   └── migrations/
│   │   ├── file/
│   │   │   ├── index.ts
│   │   │   ├── amr.ts
│   │   │   └── bundled.ts
│   │   ├── auth/
│   │   │   ├── index.ts
│   │   │   ├── session-store.ts        # 注入的存储接口，不含 SQL
│   │   │   └── credentials.ts
│   │   ├── runtime/
│   │   │   ├── index.ts
│   │   │   ├── authorization.ts
│   │   │   └── events.ts
│   │   └── render/
│   │       ├── http.ts
│   │       ├── local.ts
│   │       └── engine/                # 浏览器、PDF/PPTX/图片/MP4
│   └── tests/
├── packages/
│   ├── bridge/
│   │   ├── AGENTS.md
│   │   ├── src/                       # register/error/db/file/process/auth/runtime/render
│   │   └── tests/
│   ├── dependencies/
│   │   ├── AGENTS.md
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── amr/             # 统一 AMR/Vela；按 auth/authorization/workspaces/billing/projects/runtime/files/resources 拆分
│   │   │   ├── renderer/             # 独立渲染服务的 HTTP 协议
│   │   │   ├── github/
│   │   │   └── internal/
│   │   └── tests/
│   └── contracts/src/                 # 共享 HTTP/SSE/错误与传输契约
└── deploy/cloud/                      # 保留现有部署编排所有权
```

包内 deploy 仅承接运行镜像/资源适配，并对接现有 deploy/cloud 和发布流程；不新建第二套发布控制面，也不在本次文档工作中搬动既有部署改动。实际实现时按仓库工具规则接入 tools-dev，不恢复根 dev/start 别名。

proc 契约保留，但没有直接消费者时不建空 adapter。浏览器/编码器子进程属于 render 实现内部资源；若显式消费公开 proc/file 能力，须声明依赖。云端首阶段不搭建未使用的 Vela CLI 客户端。

## db、事务与任务执行

拟议 db 形态为只读入口加 transaction 回调，tx 下提供按记录类型组织的窄接口：projects、conversations、runs、messages、events、outbox，以及实际需要的会话/凭据密文存储。数据访问命名不代表 adapter 拥有业务创建流程。接口不暴露 SQL、pg PoolClient 或通用 ORM 查询构造器。

- biz 用例打开事务，协作模块显式接收同一个 tx。所有 tx 操作绑定同一 PostgreSQL 连接，禁止可选 tx 回退、独立嵌套事务、后台未 await 写入、全局 bridge 重绑定；回调结束后 tx 失效。
- 成功返回意味着 COMMIT 已确认。提交前失败回滚；发送 COMMIT 后失联必须表达结果未知，用幂等身份核对，不能一律宣称回滚或自动重放整个回调。
- 同一事务保存 run、原始用户消息、项目 active-run 状态、submit outbox、业务事件。模型输入和资源选择保存一次；重复请求返回原任务，输入变化则冲突。
- 保留数据库唯一约束、项目加锁和一致的锁顺序。业务数据库事务不能覆盖资源只读 SQLite、文件系统、Vela 或 AMR。
- SQL 和数据库约束进入 db adapter；权限、状态迁移、写入内容、何时发事件和 outbox 由 biz 决定。事件只能在事务提交后对外发布，内存唤醒仅加速调度。

```text
用户提交：
routes -> facade -> biz.submit -> 事务 A：任务 + 消息 + 项目状态 + outbox + 事件

后台投递：
jobs -> 事务 B：领取 outbox / 持久化 claimToken 与租约
     -> facade -> biz.prepareDispatch（校验当前授权、状态与领取凭据）
               -> 事务外 bridge/runtime 或 dependencies 调用
               -> biz.applyOutcome
                  -> 事务 C：业务结果 + 事件 + 后续意图 + outbox 确认
```

- 后台使用原 run/input/idempotency key；不能再次调用用户提交入口。outbox 完成与 run 终态不同：提交接受后仍需同步，取消接受后仍需确认终止。
- 事务 C 检查 claimToken；可重新入队的记录还要检查版本，防止旧确认覆盖新请求。领取超时不证明远程执行停止。
- 正常状态轮询与失败重试预算分开。biz 持久化重试条件、次数、下一次时间和最后错误；jobs 到期调度。轮询数据库自身失败可以由 jobs 技术退避。
- 上游执行成功但本地未确认时，依赖同一上游幂等键或已支持的查询核对；outbox 不提供跨系统 exactly-once 保证。不得发明按键查询端点或上游幂等保证。
- 结果落库失败不能被包装为上游执行失败。超过重试预算但远程结果未知时，保留待确认事实，停止自动投递或转人工处理。
- 重启扫描只回收已失效/过期执行者的工作。保留单 worker 所有权约束；不能每次启动全量重置可能仍存活的操作。
- POC 的事务内 runtime.recover 要拆为事务外恢复动作，回来后重新加锁/校验版本；Vela reserve 的内存 proof 消费不会随数据库回滚，不能当作事务内扣费。

## 登录态、凭据与重启恢复

持久化与缓存分工：

| 数据 | 保存内容与恢复方式 |
| --- | --- |
| 应用会话 | cookie token 的哈希、客户端绑定、稳定用户身份、credentialRef、到期/撤销状态、版本。请求时按 cookie 查库，不依赖恢复 Map。 |
| 调用凭据 | 加密 controlKey、所属用户、供应商环境/身份、应用允许使用期限、已知的上游期限、撤销状态和版本。按需解密和验证。 |
| 任务授权关联 | 发起人、固定工作空间、内部授权/凭据引用；不得保存 cookie 或明文 token。 |
| 任务/outbox/游标 | 保留原 ID、输入、幂等键、上游引用、取消意图、重试/领取信息和已提交消息进度。 |
| 短期 grant | 内存缓存即可；重启后用有效凭据重取，持久化版本/撤销状态是事实来源。 |
| 未完成 device login | 首阶段允许重启后重新发起；不承诺跨一次性 token 领取的无缝恢复。 |

- 区分浏览器 cookie、内部 sessionRef 和 credentialRef。当前把凭据解析绑定到内存会话的实现需改造；任务不能寻找“该用户随便一个会话”。重新授权检查稳定用户 ID、供应商环境和原工作空间，不按邮箱或浏览器当前选择匹配。
- 会话、密文凭据及关联确认提交后，才报告登录成功并设置 cookie。加密配置通过部署注入，重启后可解密并带密钥版本，不能每次启动随机生成。应用自有记录不写入 Vela 认证数据库。
- 供应商一次性 token 已消费但本地尚未持久化时崩溃，可能需重新登录；不能把 consumed 当作已成功登录。重启也不能延长会话期限，POC 的八小时应用会话不代表 controlKey 永久有效。
- 临时网络失败保留会话并报告暂不可验证；明确撤销、过期或身份不符才使对应授权失效。biz/facades 只接收身份、状态和内部引用，秘密留在 adapter 内部。
- 当前同步 isCurrent/内存 revision 检查需要改为能验证持久化状态的机制。获取 grant 前后检查有效性，防止撤销后的迟到结果恢复授权；清缓存不能撤销已经发出的远程请求。
- 关闭页面不撤销会话，已接受任务继续；主动退出登录撤销当前会话及关联授权，停止继续使用该授权，但不等同于远程取消。
- 缺少有效凭据时记录等待重新授权，与远程 run.status 分开；不能直接失败或提前释放仍可能占用的项目。重新登录后 biz 只恢复重新验证允许的工作，不自动重启终态或主动停止/撤销的任务。
- 有上游 ID 的任务查询状态、补快照并恢复订阅；提交结果未知且无 ID 的任务仅在幂等保证下重放，否则等待核对。未知的项目/会话创建也不能盲目再创建。
- renderer 不接触这些凭据。同步导出的进程退出/断连不承诺续跑，也不自动盲目补发。

## POC 源码迁移对应关系

| POC 源码 | 目标与拆分 |
| --- | --- |
| src/server.ts、src/config.ts | apps/cloud 入口、分进程配置、bootstrap、生命周期 |
| src/app.ts、src/http/sse.ts | routes/http；其中业务判断和 SQL 下沉到 biz/db adapter |
| src/auth/remote-vela.ts | 原始协议 -> dependencies/amr；登录状态/凭据 -> adapters/auth；cookie -> app/http |
| src/auth/legacy-device-login.ts、src/auth/legacy-workspace.ts | routes + account/workspaces facades；权限和绑定 -> biz |
| src/runtime/client.ts、src/runtime/generated.ts | 原始协议/schema -> dependencies/amr；执行适配 -> adapters/runtime；文件适配 -> adapters/file |
| src/runtime/authority.ts | 项目归属/工作空间解析 -> biz；凭据与 grant -> runtime 私有实现 |
| src/services/resources.ts | 项目/会话生命周期 -> biz/projects、conversations；远端创建衔接 -> facades/projects |
| src/services/access.ts、src/auth/identity.ts | HTTP 身份提取 -> app/http；账号映射/权限/实体访问规则 -> 相应 biz 模块；SQL -> db adapter |
| src/services/runs.ts、src/services/journal.ts | biz/runs、conversations；SQL -> db adapter |
| src/services/worker.ts | 调度/订阅生命周期 -> jobs；调用衔接 -> facades/runs；状态/重试/恢复 -> biz |
| src/storage/*、migrations/* | db adapter 和迁移；命令入口 -> apps/cloud/scripts/migrate.ts |
| src/billing/vela-usage.ts | Vela 协议 -> dependencies；数据获取 -> facade；准入/解释 -> biz/billing。不能当作真实扣费/结算。 |
| src/services/files.ts、src/services/attachments.ts、src/compat/legacy-files.ts、src/compat/legacy-edit.ts | 规则 -> biz/files；数据流 -> facades/files；I/O -> file adapter；附件 PostgreSQL 存储 -> db adapter |
| src/compat/legacy-chat.ts | HTTP、输入组装、业务执行和 SQL 分别迁入 routes、facades、biz、db adapter |
| src/compat/legacy-strategy.ts、src/compat/legacy-example.ts、src/compat/official-selection.ts | 提示词/资源绑定 -> biz/prompts、catalog；外部数据由 facade/bridge 提供 |
| src/catalog/reader.ts、src/catalog/sqlite.ts、src/catalog/official.ts、src/catalog/preview.ts、src/compat/legacy-catalog.ts | 目录/预览规则 -> biz/catalog；SQLite -> db adapter；文件读取 -> file adapter |
| src/catalog/preview-ticket.ts | app/http 的预览访问票据；不是用户凭据或任务授权 |
| src/catalog/build.ts、src/catalog/official-package.ts、src/catalog/official-publish.ts、src/catalog/official-meta-publish.ts 及对应 scripts | 保留实际需要的构建/校验/发布入口于 apps/cloud/scripts/resources；协议调用复用 dependencies，不成为运行时 biz 模块 |
| src/services/export-renderer.ts、src/services/pdf-export.ts | 收敛为 HTTP render adapter；导出业务和错误展示分别回到 biz/app |
| src/pdf/server.ts、src/pdf/http.ts | renderer 入口和 routes；并发执行管理 -> jobs/render |
| src/pdf/renderer.ts、src/pdf/motion.ts | adapters/render/engine |
| src/services/export-archive.ts、src/compat/legacy-export.ts、src/compat/legacy-export-metadata.ts | 内存打包与导出规则 -> biz/exports；下载响应头 -> app/http |
| src/compat/legacy-app-config.ts、src/compat/legacy-public-metadata.ts、src/services/public-metadata.ts | 隐私规则 -> biz/account；公共信息规则 -> biz/public-metadata；GitHub 协议 -> dependencies/github；HTTP -> routes |
| src/contracts/*、src/pdf/contracts.ts | 按职责合入 packages/contracts 的共享应用/传输契约或 bridge 能力契约；供应商 DTO 进入 dependencies，数据库记录契约进入 bridge/db |
| src/compat/legacy-memory.ts | 保留明确不可用的兼容响应，不创建未实现的 memory biz 模块 |

混合职责文件不能整份搬进某一层。POC 附件继续使用 PostgreSQL，本次不顺带引入对象存储。资源内容优先复用主仓库已有 skills/plugins/design-templates/design-systems，按 POC 所需构建目录和发布，不复制第二份长期内容真相。

## 迁移顺序

| 阶段 | 内容 | 完成条件 |
| --- | --- | --- |
| 0：文档（已完成） | 更新本计划、根与各层 AGENTS | 目标、现状、边界与范围一致 |
| 1：基础入口（已实现） | 建立实际消费的包入口/workspace；创建 cloud 包时同步迁入其目录级 AGENTS；按进程需求注册 | renderer 可只注册 render；缺必需能力启动失败；支持/就绪检查早于消费者启动；失败资源清理；无空 adapter；根 biz 已加入 workspace |
| 2：协议拆分（已实现） | dependencies 与已有 auth/runtime/HTTP render 的协议拆分 | 方法、归一化、错误与有限授权刷新语义保持；无 vendor bridge 能力 |
| 3：数据库（已实现） | db 契约、PostgreSQL adapter、事务和迁移 | 同连接原子性、唯一约束、锁序、条件更新、提交未知可验证 |
| 4：身份与空间（已实现） | 登录/账号/空间/账单读取，持久化会话与凭据 | 已完成登录跨重启可恢复；权限/撤销生效；临时故障不误判退出；无秘密泄露 |
| 5：项目与输入（已实现，最终接口验收见阶段 8） | 项目/会话映射、目录、文件、附件、提示词 | 外部创建不在长事务内；未知结果不重复创建；条件保存和固定空间绑定正确 |
| 6：任务闭环（已实现并验证） | runs、journal、outbox、jobs、重新授权后恢复 | 请求幂等；事务故障无半条任务；崩溃/取消/断流/凭据失效恢复可靠 |
| 7：导出（已实现并验证） | biz/exports、HTTP render、本地引擎、独立 renderer | 主进程和 renderer 独立注册；格式/限制/超时语义一致；无伪造异步队列 |
| 8：对接验收（代码已实现；资源/线上验收见下） | 剩余兼容接口、公共信息、资源构建、部署入口 | 按 POC 接口清单验收；两进程启停/重启；现有发布控制面与 daemon 保持边界 |

每个业务阶段同步迁移相应 routes、contracts 和针对性测试，不把兼容层留到最后集中重写。所有公开 adapter 改动与 bridge 契约、参数/状态/错误、注册/转发及测试同步提交。

保留已应用数据库迁移的编号和校验和，以新迁移增加会话、密文凭据、授权关联和恢复字段。已有 mock 表属于历史迁移，不能直接删改旧文件；正式业务不依赖 mock_wallets/mock_usage 模拟扣费。部署迁移命令与服务启动校验分开，schema 不匹配不能静默继续。

## daemon 复用与验证

- 优先复用已有共享 packages 中语义一致的逻辑，例如 contracts 的渲染协议和 HTML 处理。尚在 daemon 私有源码中的纯逻辑如确有需要，可以适配到新层并保留 daemon 原实现；不得直接跨 app 导入或修改 daemon 调用链。
- 本次是已存在 POC 能力的后端迁移，不借机新增用户功能。后续新增功能仍须遵守根文档的 UI/CLI 能力暴露规则；不能用本迁移为新功能长期豁免。
- 不创建完整长期记忆、MCP、自动化、其他 agent runtime、未使用 CLI、完整账本结算、多活动 worker 或持久化渲染任务。兼容端点未实现时明确返回不可用，不能伪造空成功。
- 文档阶段检查链接、规则一致性、变更范围与差异；不声称文档检查验证了运行时。实现阶段使用各包 tests/；跨 app/进程集成在 e2e，遵循其指南。
- 重点验证：事务逐步失败全部回滚；响应丢失后的幂等；上游成功而本地未确认；提交结果未知；过期 claim 的迟到结果；取消接受与终止区分；登录/凭据重启与撤销；消息游标恢复；renderer-only 注册和同步渲染限制。
- 运行受影响的针对性检查，不无授权运行完整 daemon/web 套件。发布前遵守仓库 guard/typecheck 要求。记录未验证的外部保证，尤其 AMR 幂等和认证协议行为，不以 mock 测试替代真实接受性证据。

### 阶段 4–5 实施记录

- 已完成持久化会话、AES-GCM 凭据、独立浏览器 cookie 映射；上游临时故障不撤销会话，显式退出与 provider 撤销会持久化。工作空间/账单协议在 dependencies，选择/权限/账单投影在 biz，facades 装配请求。
- AMR 创建项目/会话为 dependencies 协议；biz 记录创建意图、固定 workspace 与操作租约，facade 调用外部后条件确认。未知结果不会自动重建。
- file 契约和 cloud adapter 同步增加结构化文件引用、条件保存、目录分页；内置文件校验路径与摘要。只读资源索引由 db catalog 提供，业务事务内不可读取该独立构建快照。
- 项目/会话、附件、目录投影、示例绑定和 cloud-text-v1 提示词已迁入 biz；提示词复用主仓库资源文本，daemon 私有源码与调用链未修改。
- 已通过真实 PostgreSQL 创建幂等/未知结果/过期编辑租约/附件原子批次验证，以及 file 路径穿越、符号链接越界、摘要变化和条件写入协议测试。主进程路由组合及两进程本地运行验收已完成，外部联调限制见下文。

## 第 6–8 阶段实施与验收（2026-10-28）

- `biz/runs` 冻结原始消息和 model input，提交任务/消息/active-run/outbox/events；`biz/journal` 合并 canonical snapshot 与持久游标；`biz/runs/recovery` 决定提交、发现、取消、恢复、重试和重新授权。外部执行始终在事务外。
- `apps/cloud/jobs/runs` 持有单 worker 所有权、claim 续租和 stream 句柄。主进程重启重建工作；未知提交只按 key 查找，不重发。已确认终态才释放项目占用。
- 独立 renderer 只注册 render；引擎在 `adapters/render/engine`。PDF、PDF-image、PNG、可编辑 PPTX、MP4 实际输出已验证，网络阻断与输入限制已验证。无异步导出队列。
- `apps/cloud/scripts/resources` 处理源快照和 package 生成；Filesys HTTP/回执/条件版本在 `dependencies/filesys`。运行时 catalog SQL 在 db adapter，静态字节经 file adapter 校验摘要。
- `apps/cloud/sidecar` 是 app 生命周期壳；`tools-dev cloud` 调用既有 sidecar 原语。既有 daemon/web/desktop 启动默认值保持原样，未改 daemon。
- 跨进程测试用真实临时 PostgreSQL 和 Chromium/FFmpeg，Vela/AMR 用本地协议服务；验证完成登录、创建项目、提交 run、重启、同 Cookie 恢复、完成消息、不重复提交、下载 PDF、退出和 tools-dev 启停。DB 测试覆盖五个原子写入点失败回滚、过期 claim、提交结果未知与迁移摘要。
- 未执行真实 provider 写入、Filesys 发布、镜像推送或集群部署；以上测试不能当作这些外部环境的可用性证明。

### 本地验证结果

2026-10-28：cloud 及依赖构建、全仓 `pnpm typecheck`、`pnpm guard` 和 `git diff --check` 通过。聚焦测试共 117 个通过：bridge 22、dependencies 25、adapters 45、biz 3、cloud 13、跨包 cloud 4、tools-dev 5。资源测试曾发现 macOS 临时目录的 realpath 差异，修复后 13 个 cloud 用例全部通过。没有运行完整 daemon/web 测试套件。

与本次工作开始时逐文件摘要比较，apps/daemon 的 1,862 个基线文件均未变化；001–006 数据库迁移与 POC 原文件逐字节一致。现有 Web/CI 等未提交改动保留。真实资源 package 的失败属于下列源引用缺失，未作为通过项记录。

### POC 接口清单

| POC 能力 | 当前入口 |
| --- | --- |
| device login、session、退出、app-config | routes/account；密钥只在 bootstrap/auth adapter |
| 空间目录/当前空间/成员/邀请/账单/wallet | routes/workspaces；Vela 协议结果送 biz 解释 |
| 项目/会话/协作只读状态 | routes/projects；创建外部步骤由 facade 直接调用 dependencies/amr |
| legacy runs/messages/drafts/SSE | routes/runs；稳定重放 IDs 与持久 journal |
| native conversations snapshot/runs/events | routes/runs；与 legacy 共用业务提交和状态 |
| 文件目录/raw/附件/upload/条件编辑/当前版本 | routes/files、edit；同一 file/db 能力 |
| 导出/ZIP/manifest/diagnostics | routes/exports、compatibility；history 和不支持路径明确拒绝 |
| 官方插件/模板/skills/design-systems/marketplace/preview | routes/resources；只读目录、隔离预览与短期限定资源 ticket |
| 版本、agents/model、公有 GitHub 信息 | routes/compatibility；GitHub 缓存规则在 biz，调用在 dependencies |
| memory、library/Figma、目录修改 | 保持 POC 明确不可用，不用空成功响应冒充实现 |

原生 POC 项目接口与 legacy 的同路径差异按现有 Web 使用的 legacy DTO 对齐；原生新增入口保留，未引入另一套运行模式。未迁入 POC 未使用的本地 CLI、自动化、MCP 等功能。

### 资源验收阻塞

真实源快照 `743fb6cf7cf742b0d0e41b53e649312d98afed9f` 包含 6,888 个资源文件。离线复制、摘要和 SQLite 构建成功，完整 package 生成因下列源引用缺失而失败。保持 fail-closed，不删减条目或修改已有资源内容来绕过验收。prepare 写入 `resource-validation.json` 供 CI 定位；修复资源源文件并提交新的 SHA 后重新构建。

| 条目 | 缺失引用 |
| --- | --- |
| `plugin:example-guizang-ppt` | Missing or unsafe file: ./example.html |
| `plugin:example-html-ppt` | Missing or unsafe file: ./example.html |
| `plugin:example-kami-deck` | Missing craft: typographic-rhythm; Missing craft: pixel-discipline |
| `plugin:example-kami-landing` | Missing craft: typographic-rhythm; Missing craft: pixel-discipline |
| `plugin:example-live-dashboard` | Missing craft: motion-discipline |
| `plugin:example-open-design-homepage` | Missing craft: pixel-discipline; Missing craft: typographic-rhythm |
| `plugin:example-open-design-landing` | Missing craft: pixel-discipline; Missing craft: typographic-rhythm |
| `plugin:example-open-design-landing-deck` | Missing craft: typographic-rhythm; Missing craft: pixel-discipline |
| `plugin:example-replit-deck` | Missing or unsafe file: ./example.html |
| `plugin:od-plugin-authoring` | Missing or unsafe file: ./examples/generated-plugin/open-design.json |
| `skill:kami-deck` | Missing craft: typographic-rhythm; Missing craft: pixel-discipline |
| `skill:kami-landing` | Missing craft: typographic-rhythm; Missing craft: pixel-discipline |
| `skill:live-dashboard` | Missing craft: motion-discipline |
| `skill:open-design-landing` | Missing craft: pixel-discipline; Missing craft: typographic-rhythm |
| `skill:open-design-landing-deck` | Missing craft: typographic-rhythm; Missing craft: pixel-discipline |

## AMR/Vela dependency 合并（2026-10-28）

同一平台统一通过 `@open-design/dependencies/amr` 导出，移除旧 `/vela` 子路径。内部目录、客户端清单和凭据约束见 [dependencies README](../../packages/dependencies/README.md)。账号/空间/账单与 Runtime 地址仍分别注入；账号 control key 和 Runtime grant 不混用。

- auth、runtime、file adapters 只调整依赖引用和内部客户端选择，bridge 公共契约、注册与行为不变；apps/daemon 不修改。
- 项目/会话和官方资源客户端由 bootstrap 注入项目 facade；空间与账单客户端分别构造后注入 workspace facade。业务流程仍由 biz 决定。
- 保留当前环境变量名、上游 HTTP 路径/请求头、错误码、超时和有限 401 刷新行为。没有因合并修改线上配置或访问真实上游。

本次验证：dependencies/adapters/cloud 构建、全仓 `pnpm typecheck`、`pnpm guard`、`git diff --check` 通过；相关测试 93 个通过（dependencies 28、auth/runtime/file/registration adapters 27、bridge 22、cloud 启动/配置 12、cloud 跨包集成 4）。与本轮开始时的文件摘要比较，packages/bridge 的 23 个文件和 apps/daemon 的 1,862 个文件均未修改。此前资源构建与线上联调的验收限制不因本次模块合并而消失。


## 2026-10-28：worker 丢锁退出与 Kubernetes 守护

- db adapter 的私有 worker lease 监听连接 error/end，丢失所有权只通知一次；关闭已断连 lease 不再尝试 unlock。bridge 对外契约、注册和业务方法不变。
- jobs 丢锁后中止领取、续租和订阅；异步 claim 返回后再次验证所有权，避免继续派发。bootstrap 将失败信号交给入口生命周期，直接 Node 与 tools-dev sidecar 均有 60 秒失败排空上限，完成或超时退出码为 1。正常 SIGTERM 排空仍为 0；不清空持久化 claim，不盲目重提上游动作。
- `deploy/cloud/chart` 复用 POC 单副本 Recreate、启动/存活/就绪探针、非 root 和 renderer 网络隔离；两个进程各自 Deployment，Pod 退出宽限 75 秒。API 容器直接执行 Node；renderer 不注入 DB/用户秘密。主进程显式允许 renderer 的私有 Service HTTP，其他上游 HTTPS 约束不变。
- Secret、数据库、资源 PVC 由现有基础设施提供。旧 POC PostgreSQL NetworkPolicy 通过独立的窄范围许可接纳新 cloud/migration 标签。迁移 Job 与 Ingress 默认关闭，无自动 DDL 或 Helm hook。不得用精简 chart 直接替换包含数据库/PVC 的旧混合 release。源配置、参数映射、切换顺序及离线命令见 [部署说明](../../deploy/cloud/README.md)。
- 验证覆盖：真实临时 PostgreSQL 持锁连接终止与锁重获；worker 领取竞态、启动期丢锁、正在执行任务排空、正常停止；失败退出上限；真实主进程丢锁后非零退出、renderer 继续就绪、Cookie/任务恢复和无重复上游提交；tools-dev 包装入口同样退出并可重新启动；Helm 本地模板正反例。测试使用本地上游模拟服务，不替代集群演练或真实 AMR 联调。
- `apps/daemon` 保持不变。未部署、未执行线上迁移、未构建/推送镜像；完整资源包的既有阻塞仍需解决，renderer 镜像也仍需接入既有发布流程。

本轮本地验证通过：40 个聚焦用例（cloud 启动/配置/worker/退出 20，PostgreSQL adapter 6，真实跨进程恢复 1，启动及任务恢复边界 2，Helm 模板 11）；adapter/cloud 构建、全仓 typecheck、guard、Helm 3.19.0 lint/template 与 git diff --check 均通过。与本轮开始时摘要对照，apps/daemon 的 1,862 个文件和 packages/bridge 的 23 个文件保持不变。未运行完整 daemon/web 测试套件。


### 本地容器部署演练（2026-10-28）

- `deploy/cloud/local/compose.yaml` 保留独立 PostgreSQL；应用 overlay `compose.app.yaml` 增加 cloud、隔离 renderer 和 Nginx 静态代理。Web 使用 `--target web` 的生产 export；浏览器同源访问本地入口，登录/空间/额度/runtime 继续访问原 POC 云端 AMR。详细操作见[本地部署说明](../../deploy/cloud/local/README.md)。
- 修复 Docker 构建上下文，包含顶层 biz/adapters；pnpm 使用 `@open-design/cloud...` 选择完整依赖闭包。cloud/renderer 使用同一 Dockerfile 的两个 target，不借用旧 POC 业务镜像。
- 本地 `resources:prepare:local` 仅新增 runtime bundle 入口，复用同一固定 SHA 快照、内容/权限摘要、metadata 和 catalog 构建。保留全部 902 条资源及 15 条不完整记录；使用不完整资源仍失败。正式 prepare/publish 的全量依赖和打包校验不变，发布阻塞没有被绕过。
- Compose 保存本地 DB 数据和固定 credential keyring，进程退出后自动重启；renderer 使用独立 internal 网络，不具备 AMR/数据库凭据或外网出口。healthcheck 不等同于 Kubernetes liveness 自动重启。
- 未改 apps/daemon、bridge 或现有资源内容；未部署 EKS、发布镜像、执行远端迁移或替用户提交真实 AMR 任务。

本轮已实际构建并启动四个本地容器，健康检查、同源 HTTP/SSE、SPA 刷新、真实 PDF 渲染和 renderer 出网隔离均通过；2 个资源回归用例、1 个 Web 生产产物用例及全仓 typecheck/guard 通过。正式资源发布仍被 15 个不完整条目阻塞。
