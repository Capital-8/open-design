# @open-design/bridge

后端能力的纯 TypeScript 契约、启动注册和转发层。具体实现位于根目录的单个 `adapters/` 包，应用负责构造和注册。

| 能力 | 公开方法 | 边界 |
| --- | --- | --- |
| db | read, transaction | 类型化记录读取及同连接事务；无 SQL/ORM 透传 |
| file | read | 文件读取骨架，使用单数命名 |
| proc | spawn | 程序、参数、输入输出和退出句柄，不把任务 API 伪装成进程 |
| auth | getLoginState, startLogin, pollLogin, cancelLogin, logout | 登录事实和协议操作 |
| runtime | getCapabilities, submitRun, getRun, cancelRun, recoverRun, getSnapshot, streamEvents | 对既有执行上下文操作 |
| render | getCapabilities, render | 渲染能力与执行渲染 |

## 注册与一致性

- `register(bindings, { required })` 在每个进程启动时执行一次。required 必须由已启用消费者显式声明，不从 bindings 反推；没有通用必填的 db/file/proc。renderer 可以只提供 render；提供的每项能力必须完整。
- 注册仅检查结构，不访问上游或判断资源健康。app 在注册后分别检查支持范围、资源就绪，再启动消费者；启动失败关闭资源并退出该进程，不能重置 bridge 再试。
- 未注册、未知能力、不完整能力、重复注册和使用未安装能力均显式失败。没有默认连接、静默回退或成功形状的占位 adapter。
- 注册表捕获方法和接收对象。身份及 scope 是调用参数，不允许按请求替换全局实现。
- 每个进程使用自己的模块实例。业务和启动代码必须消费同一实例，不能在不同 bundle 中各自内联。
- 每次公开能力变更必须同步接口、状态／错误、注册校验、转发和 adapter 测试。私有协议辅助方法不必公开。
- BridgeError.code 是依赖错误标识；uncertain 表示操作可能已执行，业务不能据此盲目重放。HTTP 状态映射和产品提示由 app/biz 处理。

## 业务边界

- 项目／会话创建、权限、workspace 绑定、提示词、业务状态、消息落库、幂等与恢复策略留在 biz。
- runtime 不包含 createProject/createSession 或改名后的创建接口，也不能在 submitRun 中隐式创建资源。
- getRuntimeAuthorization 仅存在于 runtime adapter 内部；登录凭据通过启动装配依赖接入，不通过 biz 手动传递 provider token。
- auth 不处理 Cookie、页面跳转、登录后的业务初始化、workspace 或 billing。sessionRef 是供应用服务端保管的凭据引用，不是前端 JSON DTO。
- render 接收准备好的内容，返回 Uint8Array 和 MIME。它不选择项目文件、不写业务产物、不命名下载文件，也不虚构异步渲染任务。
- streamEvents 返回可关闭的 AsyncIterable；close() 只关闭订阅，不取消 run。
- apps/daemon 保持原有实现。云应用已有启动入口，业务层接线尚未完成；参见 [迁移边界](../../specs/current/cloud-backend-boundaries.md)。

## 验证

```sh
pnpm --filter @open-design/bridge build
pnpm --filter @open-design/bridge typecheck
pnpm --filter @open-design/bridge test
```

## 数据库事务

`db.read()` 返回 accounts/projects/conversations/runs/messages/events/outbox/sessions/credentials/attachments/drafts 的只读接口。`db.transaction(async tx => …)` 使用同一连接，tx 下提供对应写入、加锁、条件更新与 outbox 领取/续租/确认。callback 结束后句柄失效；禁止嵌套事务和未 await 操作。

成功表示提交已确认；`db_commit_unknown` 的 uncertain=true 表示 COMMIT 响应丢失，必须按稳定标识核对，不能自动重放回调。业务决定事务中的写入内容和事件；adapter 只执行物理事务、唯一约束和租约/版本比较。
