# Pocketsflow 创作者商店

从 `example.html` 开始制作；它是本模板的完整动画源文件。默认保留原片品牌与商品，改编时通过输入变量替换。

**Arc:** 提问 → 三类商品 → 手机商店 → 支付推镜 → 结账自动化 → 创作宣言 → 品牌收尾。

## 场景结构

| Scene (`CFG.scenes` id) | Dur | Summary | Build | Reuse |
|---|---|---|---|---|
| `hook` | 2.350 s | 男孩气泡与卖货提问 | 单 canvas，三次缓出与阻尼弹簧；cue `boy-enter`, `whisper`, `hook-copy`, `hook-prefix`, `sell-word`, `hook-underline`, `blue-wipe` | hookLine、hookPrefix、hookWord；人物造型保留 |
| `anything` | 2.100 s | 三类商品依次出现 | 单 canvas，三次缓出与阻尼弹簧；cue `course-in`, `ebook-in`, `app-in`, `cards-out` | course、ebook、app、对应价格和图片 |
| `store` | 2.650 s | 手机商店逐项填充 | 单 canvas，三次缓出与阻尼弹簧；cue `phone-in`, `store-copy`, `store-items`, `store-line`, `minutes-in`, `buy-click`, `phone-zoom` | brand、storePrefix、storeLine、storeEnd、storeAccent、storeName、商品名称与图片 |
| `checkout-zoom` | 0.150 s | 推进支付按钮的黑色短过渡 | 单 canvas，三次缓出与阻尼弹簧；cue `zoom-out` | 保留支付推镜机制 |
| `handled` | 3.850 s | 结账、订阅、加购、税务与到账网格 | 单 canvas，三次缓出与阻尼弹簧；cue `board-in`, `card-type`, `subscription-rise`, `upsell-in`, `tax-in`, `payout-in`, `paid`, `stamp`, `board-out` | monthly、courseTitle、coursePrice、workbookTitle、workbookImage、handled |
| `flow` | 2.300 s | 创作与支付分工宣言 | 单 canvas，三次缓出与阻尼弹簧；cue `you-create`, `create-word`, `we-handle`, `handle-word`, `the-word`, `flow-word`, `flow-out` | flowYou、flowCreate、flowWe、flowWord |
| `close` | 1.661 s | 品牌字、探头人物与行动按钮 | 单 canvas，三次缓出与阻尼弹簧；cue `brand-drop`, `head-peek`, `tagline-in`, `close-cta`, `close-settle` | brand、logoImage、tagline、tagAccent、cta、domain、footer |

## 素材与来源

来源为团队上传的 `reference.mp4`，未提供公开链接或作者姓名，不能补写出处。
复制 `example.html`、`references/sound.json` 和 `assets/` 中被引用的本地素材：`assets/gsap.min.js`、`assets/inter-regular.ttf`、`assets/inter-OFL.txt`、`assets/instrumentserif-italic.ttf`、`assets/instrumentserif-OFL.txt`、`assets/fraunces-bold.ttf`、`assets/fraunces-OFL.txt`、`assets/jetbrainsmono-regular.ttf`、`assets/jetbrainsmono-OFL.txt`、`assets/course.png`、`assets/ebook.png`、`assets/app.png`、`assets/workbook.png`、`assets/logo.png`。只有依照声音政策选择演示音轨时才复制 `assets/soundtrack.mp3`。字体许可必须随字体一起交付。

默认品牌字用原片裁片；当 brand 改为其他文字时，代码切换到 Fraunces 排字。用户换图片时也应更新 logoImage。人物是代码重建的表演角色，不能用原视频或整帧代替。

## Adapting the template

- `hook`：可修改 hookLine、hookPrefix、hookWord；人物造型保留。保留男孩从右侧入场后的过冲回摆、随主句歪头和笑嘴、气泡逐字、主句按词进入、斜体抬升与曲线下划线展开；`boy-enter`、`hook-prefix`、`hook-underline` 为各动作的时间句柄。伸缩范围 2.35–3.5 秒，增加的时间由人物眨眼、张嘴、点头及轻微漂浮填充。文案限制：hookLine 18 字符、hookPrefix 4、hookWord 10；超长时先缩短文字，不能把字号缩到难以阅读。商品多于三项时保留最重要三项，少于三项时保留槽位并改为优势卡；其余场景不增列，收尾始终单一品牌。

- `anything`：可修改 course、ebook、app、对应价格和图片。保留三类商品依次出现的空间层级与错峰机制。伸缩范围 2.1–3.2 秒，增加的时间由人物眨眼、张嘴、点头及轻微漂浮填充。文案限制：类别各 12 字符；coursePrice 9、ebookPrice 9、appPrice 12；超长时先缩短文字，不能把字号缩到难以阅读。商品多于三项时保留最重要三项，少于三项时保留槽位并改为优势卡；其余场景不增列，收尾始终单一品牌。

- `store`：可修改 brand、storePrefix、storeLine、storeEnd、storeAccent、storeName、商品名称与图片。保留手机商店逐项填充的空间层级与错峰机制。伸缩范围 2.65–4.1 秒，增加的时间由人物眨眼、张嘴、点头及轻微漂浮填充。文案限制：brand 16、storePrefix 18、storeLine 12、storeEnd 4、storeAccent 12、storeName 18，商品名称各 20；超长时先缩短文字，不能把字号缩到难以阅读。商品多于三项时保留最重要三项，少于三项时保留槽位并改为优势卡；其余场景不增列，收尾始终单一品牌。

- `checkout-zoom`：可修改 保留支付推镜机制。保留推进支付按钮的黑色短过渡的空间层级与错峰机制。伸缩范围 0.15–0.15 秒，该段锁定，持续缩放使帧保持变化。文案限制：无可编辑的画面文案；超长时先缩短文字，不能把字号缩到难以阅读。商品多于三项时保留最重要三项，少于三项时保留槽位并改为优势卡；其余场景不增列，收尾始终单一品牌。

- `handled`：可修改 monthly、courseTitle、coursePrice、workbookTitle、workbookImage、handled。保留结账、订阅、加购、税务与到账网格的空间层级与错峰机制，以及段尾确认勾号、扩张印章圆环与黑色网点圆形擦除。伸缩范围 3.85–5.5 秒，增加的时间由人物眨眼、张嘴、点头及轻微漂浮填充。文案限制：courseTitle 20、coursePrice 9、workbookTitle 24、handled 14，monthly 1–99；超长时先缩短文字，不能把字号缩到难以阅读。商品多于三项时保留最重要三项，少于三项时保留槽位并改为优势卡；其余场景不增列，收尾始终单一品牌。

- `flow`：可修改 flowYou、flowCreate、flowWe、flowWord。保留 You / create. 和 We / handle / the 按整词抬升的错峰机制、连续人物表演与最后的圆形擦除；flow. 在擦除中继续可见。伸缩范围 2.3–3.5 秒，增加的时间由人物眨眼、张嘴、点头及轻微漂浮填充。文案限制：flowYou 8、flowCreate 12、flowWe 20、flowWord 12；超长时先缩短文字，不能把字号缩到难以阅读。商品多于三项时保留最重要三项，少于三项时保留槽位并改为优势卡；其余场景不增列，收尾始终单一品牌。

- `close`：可修改 brand、logoImage、tagline、tagAccent、cta、domain、footer。保留品牌字、探头人物与行动按钮的空间层级与错峰机制。伸缩范围 1.661333–2.5 秒，增加的时间由人物眨眼、张嘴、点头及轻微漂浮填充。文案限制：brand 16、tagline 44、tagAccent 20、cta 18、domain 26、footer 64；超长时先缩短文字，不能把字号缩到难以阅读。商品多于三项时保留最重要三项，少于三项时保留槽位并改为优势卡；其余场景不增列，收尾始终单一品牌。

总时长变化时优先让 handled、store、hook 吸收，再调整 flow 和 close；checkout-zoom 永远锁定。修改 CFG.scenes 的 dur 并同步 CFG.duration，起点自动累加。入场从段首计，退场和转场只从段尾 cue 计。

Chinese / CJK：--od-font-heading 和 --od-font-body 默认均为本地 Inter，后接 Noto Sans SC 与系统中文字体；斜体 Instrument Serif、品牌替换字 Fraunces 后接 Noto Serif SC。中文使用与拉丁角色匹配的字重；繁体改用 Noto Sans TC / Noto Serif TC。交付改编前必须用用户实际文案（含标点、中英混排）渲染一帧，检查缺字、方框与意外回退。若机器没有中文字体则告知用户；本模板不捆绑中文字体，仅在用户要求时添加特定字体。

## 预览与导出

GSAP 主时间线是唯一时钟。`window.__odRenderAt(t)` 支持前后跳转；所有绘画均为时间的纯函数。`html.od-export` 隐藏预览按钮。等待本地字体与图片就绪后暴露时间线。

## Sound
The demo track is the reference film's own soundtrack.
When the film length changes, refit or replace the track using references/sound.json (bpm, sections).
The bundled track is demo material, not a requirement for generated films.
The user's current brief takes priority over this reference and its seed prompt,
including duration, music choice, genre, mood, voiceover and sound effects.
Follow the general motion-design audio guidance; this template does not disable
available audio tools or original audio synthesis.

- If the user requests a silent film, remove all audio. If they request only
  no background music, remove the music but retain any requested sound effects
  or voiceover. No voiceover does not mean no music.
- Use the user's supplied audio when requested. If they request different music,
  choose or create a suitable real local asset using the available audio tools,
  licensed sources or original synthesis. Do not silently substitute the demo
  track for an unmet request; briefly disclose any limitation.
- Without a specific music request, add appropriate audio when it benefits the
  film. Reuse the demo track only when it suits the actual story, mood and timing;
  it is an option, not the default for every adaptation.
- Fit the visuals and audio to the requested film duration, not to the demo's
  duration. For example, a 15-second brief stays 15 seconds even when the demo
  score is 20 seconds. Edit the selected track with a deliberate ending/fade;
  use the same edited local file in HTML and MP4. For a longer film, arrange or
  replace the track to cover the intended beats rather than leaving an accidental
  silent tail. Do not rely on an HTML-only loop or playbackRate for export.

For background music keep `id="soundtrack"`, `data-start="0"` and a numeric
`data-volume`; update `src` and `data-duration` to the actual edited asset and
film. Remove unused demo audio from the generated composition. Set the source's
`od-motion-audio` metadata to `required` when sound is intended, or `silent` for
an intentionally silent film, using the general motion-design delivery guidance.
Verify the ending and audio in both HTML playback and the exported MP4.

The `<audio>` element stays inside the composition root; the desktop exporter
mixes its local file into the MP4. Preview sound starts with the film; when the
browser blocks autoplay, the first click or key press turns it on, and Sound off
mutes it. Sound follows the master timeline, including pause and backward
seeks. Keep it silent during frame capture and in sandboxed gallery thumbnails.
