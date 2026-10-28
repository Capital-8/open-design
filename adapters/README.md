# @open-design/adapters

单个后端 adapter 包。公开操作与 packages/bridge 对应，通过子路径导入：

- `@open-design/adapters/db`：createPostgresDb，提供 adapter、迁移、schema readiness、单 worker 所有权与连接清理。
- `@open-design/adapters/auth`：createVelaAuthAdapter，返回 auth 实现及仅供服务端装配的 credentials。
- `@open-design/adapters/runtime`：createAmrRuntimeAdapter，消费已确定的执行引用；内部管理 AMR 授权。
- `@open-design/adapters/render`：createHttpRenderAdapter，调用独立 renderer 的 /ready 和 /render-export。

这些实现从 cloud-daemon POC 提取，外部协议现由 packages/dependencies 的 vela、amr、renderer 子路径提供，未接入 apps/cloud 或 apps/daemon。没有桌面 adapter 占位实现。file/proc 的具体实现仍待迁移。

应用使用 `register(bindings, { required })` 显式声明消费者所需能力。HTTP render adapter 可单独注册；结构校验本身不触发 /ready 请求。注册兼容测试与 bridge 变更同步维护，支持范围和 readiness 由 app 在接收工作前显式检查。

## 应用装配边界

应用提供经过验证的端点配置、版本／主机标识及恢复能力声明，构造各 adapter。将 auth 返回的 credentials 注入 runtime；不要从 biz 获取或传递 provider token。应用持有连接与生命周期，业务代码消费 bridge。

认证上下文由应用从受保护的客户端／会话绑定解析，不能信任请求 JSON 自报的 clientRef、principalId 或 workspaceId。成功登录返回的 sessionRef 是服务端会话句柄，不能原样复制到公开 JSON；Cookie、HTTP 和页面跳转由应用处理。

当前登录尝试和会话仍为 POC 的进程内存模型。多副本共享和重启持久化需要之后在 app/db 设计中明确。渲染引擎和它的部署也未搬入这个客户端 adapter 包。

协议客户端不反向依赖 bridge。adapter 将 DependencyError/HttpFailure 转回 BridgeError，保留 code、uncertain、requestId 和 HTTP status。登录状态、凭据和 grant 缓存、原引用匹配、SSE 订阅关闭以及返回值归一化仍由 adapter 负责；公开构造参数和 bridge 方法不变。

完整的方法与迁移边界见 [cloud-backend-boundaries](../specs/current/cloud-backend-boundaries.md)。

## 验证

```sh
pnpm --filter @open-design/bridge --filter @open-design/dependencies -r build
pnpm --filter @open-design/adapters build
pnpm --filter @open-design/adapters typecheck
pnpm --filter @open-design/dependencies --filter @open-design/adapters -r test
```

测试只使用可控 transport 和时钟，不访问真实账号或上游服务。
