# Motion 时间点反馈技术方案

## 依据与选择

基于 main `9724c44142`。产品范围见 [product.md](./product.md)。复用 `motion-source-player.ts` 的 GSAP 时钟、现有评论持久化与标注到对话通道，新增宿主播放器控制和时间上下文，不建第二套播放引擎。

模型负责理解修改要求、编辑源代码；暂停、定位、截图和上下文校验由确定性代码负责。本功能运行时不需要多 Agent 编排。

## 实现切片

### 1. 共享播放器与 iframe 通信

- 在 contracts 的 Motion runtime 定义可选帧率、状态与命令类型；源 runtime marker 升级，保留已有 audio sync、activity 和导出保护。
- opaque iframe 使用 `postMessage`，源端只接收 parent；宿主只接收当前活动 iframe。连接使用每次文档加载重新生成的 client challenge，回复带 client ID 和 document instance；后续命令必须匹配两者。
- 支持连接、播放、暂停、定位、重播、静音和锁定。命令回复携带实际状态；暂停与截图等待确认。无效数字拒绝，不把 NaN 传给 GSAP。锁定同时阻断根节点点击、transport play/seek 和 activity 恢复。
- 有效 `data-fps` 才计算帧；定位范围 [0,duration]，逐帧限制到最后有效采样点。保留原有自动循环语义；暂停到终点保持暂停，用户播放后从头开始。
- 状态只在播放时有限频率回报，暂停后停止循环；隐藏 iframe 与 thumbnail 保留已有暂停／静音约束。
- 同内容的 URL/srcdoc 切换通过独立内容标识恢复已确认的暂停位置与锁定，收到实际恢复确认后才允许截图；换文件或内容变化不恢复旧时间。恢复保存用户静音偏好，不把宿主临时静音写成用户设置。

### 2. 持久评论与 Agent 上下文

- `PreviewCommentTarget`、`PreviewComment`、`ChatCommentAttachment` 新增可选 `motion`，包含 `timeSeconds`、`durationSeconds`、可选 `fps` 和 `sourceFingerprint`。帧号由时间与帧率派生，避免存两个可矛盾的时间真值。
- DB 增量添加可空 `motion_json`，放在现有两次 legacy table rebuild 之后，兼容已有评论；所有 select/upsert/row normalization 显式透传。API 校验有限数字、非负范围、帧率和有界来源指纹，非法值拒绝而非静默删除。
- 新建 motion 评论在共同 HTTP 边界要求有效图片附件；ChatRequest 的 motion 反馈同样要求截图路径或图片附件，CLI 不能绕过此约束。编辑旧评论省略 motion／附件时保留原证据，不能清空或悄悄改成当前时刻。用户通过 CLI 提供图片与时间时，内容一致性属于调用方声明，服务端只验证结构与项目内附件边界。
- relay 完整覆盖 `CollabCloudComment → toCloudComment → JSON → integrations/collab-cloud.ts validator/normalizer → mergeSyncedPreviewComment UPDATE/INSERT → normalizePreviewComment`。旧 relay payload 省略 motion 时保留本地时间证据与配套截图。外部 relay 是否保留新字段尚未知，本地透传测试不代表跨端验收。
- CLI 复用 `od comment --target <json> --prompt-file <path|-> --json`，与 Web 使用同一 HTTP API。无需另建预览控制 REST API：播放是本地显示状态，持久反馈才是对外能力。
- `comments.ts`、绘制事件和 ChatComposer 传递同一 motion 上下文；daemon `chat-prompt-inputs.ts` 标准化后渲染成明确的“参考时间点”信息，保留来源、时间与图片路径，提示时间点不自动限定修改作用区间。

### 3. Web 播放与反馈

- 新建隔离的播放器 hook 与 CSS Module 组件，使用 `@open-design/components` 的 Button；不扩展 FileViewer 内部时钟。FileViewer 识别 canonical Motion video HTML 后在预览底部显示控制栏，不因启用播放器改变 URL/srcdoc 选择。
- 进入已有评论或 draw 前发送锁定命令并等待实际暂停。标注期间禁用播放与 seek，退出后解锁但不自动播放。避免 root 点击事件偷偷继续播放。
- 时间点评论保存前，通过当前活动 iframe 的 snapshot bridge 截取暂停画面；跳过原默认离屏渲染。使用现有图片上传／评论附件通道，失败保留草稿并阻止时间评论提交。
- 捕获开始与完成时核对文件、source fingerprint、document instance、宿主文档代次和暂停时间；导航开始即递增代次，切文件、重载、来源更新后丢弃过期结果。绘制提交也启用必需截图约束，不落入旧的缺图降级。
- 新评论记录当前 motion；编辑历史评论保留原 motion 与原截图。侧栏显示时间标签，点击后暂停定位；来源不同提示旧内容，并避免渲染旧空间锚点。正常播放隐藏时间评论标记。
- 同内容、同时间点下，显示用的标记可按当前预览尺寸重新定位；提交给 Agent 的历史位置、文字、时间与原截图保持一致，不用新的显示位置改写原证据。
- 所有新增文案补齐 18 语言 Dict。普通 HTML、deck 和非时间评论保持原行为。

## 取舍与边界

| 方案 | 判断 |
| --- | --- |
| 重建剪辑器／关键帧 UI | 超过单时间点反馈目标，暂缓 |
| 默认离屏重新打开再截图 | 无法证明与当前时间一致，不用于本路径 |
| 只把时间拼进用户留言 | 无法可靠回看、验证与机器读取，采用可选结构化字段 |
| 给全部 HTML 注入通用 seek | 任意计时器、WAAPI 与交互逻辑无法承诺确定定位，保留 canonical Motion 边界 |

snapshot bridge 的 DOM/SVG/Canvas 捕获仍可能受字体和远程素材限制。必须实测本地离线 GSAP 样本，并验证失败保稿；不能以截图接口返回值代替可见像素核验。

## 验证与回滚

1. runtime 行为测试：连接与实际暂停／seek、错误 challenge/instance、非法时间、隐藏活动、已知／未知帧率、音频暂停。复用 `apps/web/tests/runtime/motion-playback.test.ts` 与 contracts 注入测试。
2. 评论 API／CLI：创建、编辑、回读可选 motion；非法输入拒绝；普通旧评论兼容；relay 数据与 Agent prompt 保留时间和图片上下文。
3. Web 组件测试：状态确认后显示时间、锁定禁用控制、末帧步进、迟到消息丢弃。截图与评论行为通过公开事件/保存接口验证。
4. 真浏览器：用独立 tools-dev namespace、端口和按根 AGENTS.md 契约隔离的数据根；通过正式项目 API 建离线演示，检查定位、标注、截图像素、保存回读与加入对话。不调用付费模型；Agent 输入透传用定向测试验证，模型编辑效果另行验证。
5. 必需检查：`pnpm guard`、`pnpm typecheck`、受影响的 contracts/web/daemon 定向测试与构建。Node 24 + Corepack pnpm 10.33.2。

具体定向入口：

- Web：`pnpm --filter @open-design/web exec vitest run -c vitest.config.ts --maxWorkers=2 tests/runtime/motion-playback.test.ts tests/runtime/motion-preview-transport.test.ts tests/components/motion-playback-controls.test.tsx tests/comments.test.ts`，覆盖锁定、实际状态、无效与迟到消息、附件透传。
- contracts：`pnpm --filter @open-design/contracts exec vitest run tests/motion-source-player.test.ts`，覆盖注入、导出保护、marker 替换。
- daemon：在 `apps/daemon/tests/motion-comments.test.ts` 覆盖旧库迁移、创建／改文字／reopen、旧 relay 缺字段保留、API/CLI 缺图拒绝及 prompt 透传；用 `pnpm --filter @open-design/daemon exec vitest run tests/motion-comments.test.ts tests/comment-cli-http-sqlite.test.ts tests/comment-attachments.test.ts` 执行。
- 截图失败保稿和文件切换失效：`apps/web/tests/components/motion-comment-capture.test.ts` 定向行为测试，加真实浏览器暂停截图证据。真实模型调用与外部 cloud relay 不在本次验收声明内。

回滚前端入口与 transport 增量即可恢复已有播放；新增可空列与可选 DTO 字段可保留，不做破坏性迁移。此次仅本地分支和预览，不合并、不发布。
