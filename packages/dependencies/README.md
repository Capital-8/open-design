# @open-design/dependencies

单个外部协议包，不依赖 bridge、adapters、biz 或 app 私有源码。构造客户端不产生 I/O；URL 和 fetch 由应用或 adapter 注入，不读取环境、cookie 或凭据文件。

| 子路径 | 现有协议 |
| --- | --- |
| `@open-design/dependencies/amr` | 同一 AMR/Vela 平台的设备登录、用户、执行授权、空间、账单、项目/会话、任务、文件、资源及 SSE |
| `@open-design/dependencies/renderer` | ready、render-export、wire schema、超时/大小限制、MIME 与输出字节验证 |
| `@open-design/dependencies/github` | 固定匿名公共信息接口 |
| `@open-design/dependencies/filesys` | 官方资源条件发布及版本/回执验证 |
| 根入口 | DependencyError、HttpFailure；不聚合导出全部客户端 |

AMR/Vela 统一使用 `/amr`，原 `/vela` 入口已移除。每类客户端独立构造，只要求它使用的配置，不要求 auth/file/runtime 消费者构造全量平台客户端。

```text
src/amr/
├── index.ts
├── auth.ts             # createAmrAuthClient：device login、profile
├── authorization.ts    # createAmrAuthorizationClient：grant 协议
├── workspaces.ts       # createAmrWorkspaceClient：目录、上下文、成员、邀请
├── billing.ts          # createAmrBillingClient：snapshot、balance、preflight、summary
├── projects.ts         # createAmrProjectClient：远端项目和会话创建
├── runtime.ts          # createAmrRuntimeClient、readAmrEvents：既有任务与会话
├── files.ts            # createAmrFileClient：目录、读取、条件保存
├── resources.ts        # createAmrResourceClient：官方资源清单
├── sse.ts
├── types.ts
├── schemas/            # auth、workspaces、billing、runtime DTO
└── internal/           # API/Runtime 各自的传输与路径处理
```

## 配置与凭据

- `apiUrl`：账号、空间、账单和执行授权 API。使用账号 control key；device login 使用自己的 device secret 协议。
- `webUrl`：登录页面 URL，用于校验 activation URL。
- `runtimeUrl`：项目、会话、任务、文件、资源 API。每次调用接受独立的授权回调，使用 Runtime grant。
- URL 可以属于同一平台的不同服务，不强制同源；账号 key 不会转发到 Runtime，grant 也不替代账号凭据。调用方负责凭据持久化、作用域校验和授权缓存。

公开 DTO 保持供应商形态，adapter 再转换为 bridge 契约。合并目录不修改 `x-vela-workspace-id` 请求头、`vela_*` 等既有错误码、HTTP 路径、超时、大小限制或未知写入语义。协议错误不携带上游原始响应体；adapter 保留 code、uncertain、requestId 和 status 转换为 BridgeError。

Runtime 只在首次明确 401 后请求注入的授权回调刷新一次，使用同一请求及 deadline 重放；网络失败和未知写入结果不自动重试。账号 API 保持原有请求策略，不套用 Runtime 的刷新行为。

## 调用边界

已有基础能力由 bridge -> adapter -> dependencies/amr 调用。远端项目/会话创建、空间和账单协议由 facade 调用；创建流程、权限、额度判断、事务及重试仍在 biz。项目创建没有加入 runtime bridge。登录态及 grant 缓存仍在 adapter，依赖客户端没有全局用户或凭据状态。

cloud 已使用以上客户端；未增加未被使用的 CLI 协议。完整迁移记录见[迁移文档](../../specs/current/cloud-backend-boundaries.md)。

```sh
pnpm --filter @open-design/dependencies build
pnpm --filter @open-design/dependencies typecheck
pnpm --filter @open-design/dependencies test
```

测试使用可控 fetch、协议响应和时钟，不访问真实服务。
