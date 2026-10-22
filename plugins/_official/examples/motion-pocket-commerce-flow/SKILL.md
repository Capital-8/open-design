# 商品到收款

**叙事弧线：** 创作者提问 → 数字商品 → 手机店铺 → 结算与自动处理 → 品牌宣言 → 行动按钮。

画布尺寸为 1920 × 1080；时长仅由 `CFG.duration` 定义。场景起点由 `CFG.scenes` 的 `dur` 累加，关键动作通过 `CFG.cues` 和 `cueTime()` 定位。

| 场景（`CFG.scenes` id） | 时长 | 画面与意义 | 构建方式 | 复用方式 |
|---|---|---|---|---|
| `hook` | 2.35 秒 | 提出创作者是否有数字商品可售的问题；右侧半色调角色、左侧两行粗体与蓝色斜体 | 单画布；角色从右侧滑入；文字逐词从遮罩底部上移；问号处蓝色圆形扩张；关键 cue：`character-land`、`whisper`、`headline-enter`、`sell-enter`、`blue-expand` | `hook`、`sell`、`primary`、`font`；保留右侧角色与两行层级 |
| `catalog` | 2.1 秒 | 展示课程、电子书和应用三类数字商品；左侧角色、右侧依次弹出的三张白卡 | 单画布；蓝底保持；三张白卡由下方升入并旋转归位；关键 cue：`course-card`、`ebook-card`、`app-card` | `coursePrice`、`ebookPrice`、`appPrice`、`primary`；三张卡保持横排 |
| `store` | 2.65 秒 | 这些商品可以快速变成手机店铺；右侧手机、左侧品牌和 a store / in minutes. | 单画布；白色擦除进入；手机落位，商品示意图下落进入列表；文字逐步建立；关键 cue：`phone-land`、`store-words`、`store-title`、`minutes-enter`、`purchase-zoom` | `brand`、`domain`、`storeName`、`course`、`ebook`、`app` 及对应价格 |
| `checkout-zoom` | 0.15 秒 | 点击购买进入结算；极近景支付按钮 | 单画布；由手机购买区域放大，经黑色按钮切入结算缩放；关键 cue：`wallet-close` | `wallet`；保持支付按钮作为镜头连接点 |
| `dashboard` | 3.85 秒 | 付款、订阅、加购、税务和到账统一处理；三列圆角界面与 Handled. 印章 | 单画布；镜头从支付按钮拉远；面板逐块填入；金额递增；印章缩小落下；黑色圆扩张；关键 cue：`dashboard-land`、`subscription-rise`、`upsell-enter`、`upsell-check`、`tax-enter`、`payout-rise`、`handled-stamp`、`black-expand` | `wallet`、`course`、所有金额、`taxRate`、`card`、`expiry`、`bank`、`handled` |
| `promise` | 2.3 秒 | 创作者专注创作，支付由平台处理；左侧白色/灰色文字、蓝色斜体 flow. 与右侧角色 | 单画布；单词由下向上出现；角色表情切换，末尾 flow. 过渡到白底；关键 cue：`you-enter`、`create-enter`、`handle-enter`、`flow-enter` | `closeLine`、`createWord`、`handleLine`、`flowWord`、`primary` |
| `endcard` | 1.66133 秒 | 以品牌、行动按钮和规模数据结束；中央衬线品牌字标、探头角色、CTA | 单画布；字标成形；角色从后方探头；副标题、按钮与底部数字依次显示；关键 cue：`logo-lock`、`head-pop`、`cta-enter`、`stats-enter` | `brand`、`tagline`、`deserve`、`cta`、`domain`、`creators`、`countries` |

## 修改方式

所有可编辑项声明在 `<html data-composition-variables>`，默认值与 `CFG` 同步；包括品牌、域名、主色、字体、商品、价格、付款信息、客户规模和收尾文案。预览读取默认值，渲染时读取 `window.__hyperframes.getVariables()`。字段长度和金额范围见声明；超出范围应同时调整排版。

`font` 默认 `Inter`，对应 `brandToken: font.body`；`brand` 和 `primary` 分别对应 `brand.name` 与 `color.primary`。只替换字体名称时，需把合法字体文件放入 `assets/` 并添加本地 `@font-face`。衬线字标与斜体强调使用本地 Fraunces、Instrument Serif。所有依赖均随模板提供，不调用 CDN。

角色为原创侧分卷发、圆胸章儿童；商品图为程序绘制的笔记本电脑、书堆与柱体。它们是模板插画，保持其半色调语言；可修改 `characterArt()` 和 `productArt()` 重绘。画布没有独立 DOM 图层，编辑定位依靠变量与 cue id；画布本身 id 为 `film-canvas`。

`window.__timelines.main` 为 GSAP 主时间轴；`window.__odRenderAt(t)` 提供纯时间定位。预览底部可播放或拖动；`html.od-export`、`window.__OD_EXPORT__`、`window.__odFrameRenderer` 以及 `?export` 隐藏预览控制并使用导出舞台布局。

## 声音

本模板静音，没有 `<audio>`。不得把参考片音频复制进模板或导出影片。如后续增加音轨，只能使用为模板创作、授权清晰的素材；音频标签的 `data-start`、`data-duration`、`data-volume` 必须写字面量数字，禁止 `loop`，不得超过影片时长。修改时长时同步更新音频字面量。已核对官方 `motion-product-promo/SKILL.md` 的声音规则：用户当前要求优先；没有特定音乐要求时，原官方示例允许添加有益的合适音频，但不强制复用演示音轨；音频必须使用真实本地文件，按要求的影片时长安排结尾和淡出，不依赖 HTML 循环或变速。音频元素置于合成根节点内，使用 `id="soundtrack"`、字面量 `data-start="0"` 和数值 `data-volume`，并写入实际音轨时长；删除未使用的演示音频。需要声音时元数据为 `required`，有意静音时为 `silent`；预览音频跟随时间轴和后退 seek，帧捕获与沙箱缩略图保持静音。交付前应核验 HTML 和导出 MP4 的音频结尾。本次明确要求默认静音且禁止原片音轨，因此不选用任何音轨；本模板标记 `od-motion-audio: silent`。

## 来源与边界

参考为团队成员上传的 `reference.mp4`，未由上传者提供公开链接、原作者或源工程。官方 `motion-product-promo/SKILL.md` 提及关联原作候选 [@achxvi 的帖子](https://x.com/achxvi/status/2103918792845963545)，本地上传文件与该链接是否同一版本未获核验。仅用于内部 ODEval 对照；素材本体不随模板发布。品牌、商品名称、业务数字、账户演示信息和角色身份均已替换。所有差异、替代素材与未检查项见本次交付的 `out/RESULT.md`。
