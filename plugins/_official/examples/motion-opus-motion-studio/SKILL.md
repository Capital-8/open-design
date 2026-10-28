# Opus Motion Studio

从 `example.html` 开始生成影片。它是一支 15 秒竖版动效课程工作台：固定网页外壳包住一块演示画布和六旋钮代码控制台，六项动效原则逐段被调校，最后合成为完整标题。

**Arc:** 间距 → 排版 → 动态模糊 → 缓动 → 跟随动作 → 预备动作 → 完整成片

| Scene (`CFG.scenes` id) | Dur | Summary | Build | Reuse |
|-|-|-|-|-|
| `spacing` | 2.00 s | 蓝色圆角姿势沿基线从集中态展开 | Canvas 圆角方块，cue `spacing-poses` 以 smoothstep 展开，三处蓝色批注随后错峰出现；时间线和控制台持续运动 | 可换 `paper`、`ink`、`blue`；保留不均匀间距与最后一个实心蓝块 |
| `typography` | 2.00 s | EVERY FRAME / ON PURPOSE 两行重字逐字错峰升起 | Canvas 逐字符位移与行高遮罩，cue `type-stack`；蓝点与下划线随后出现 | 可换字色与字体；保留上下两行比例、左到右错峰、遮罩上升和句点 |
| `motion-blur` | 2.00 s | FAST. 带横向拖影冲入、锐利停住并向右冲出 | Canvas 多重文字残影，cue `fast-impact` 与 `fast-release`；蓝色快门批注错峰出现 | 可换 `accent`、`blue`；保留高速拖影—锐利停住—再加速离开的对比 |
| `easing` | 2.00 s | 红色线性轨迹切换为蓝色 S 曲线 | Canvas 坐标轴、轨迹、端点球与同步移动的下方方块，cue `curve-switch`、`curve-blue`；power3.inOut | 可换配色；保留线性对照、S 曲线重绘以及两个端点方块 |
| `follow-through` | 2.00 s | 主球沿对角线上升并停住，九个尾迹点随后向下弯曲落稳 | Canvas 黑色点阵、蓝球和两阶段程序化尾迹，cue `tail-settles` | 尾迹数量可随画幅调整；保留主体先停、尾迹后落的关系 |
| `anticipation` | 2.00 s | 蓝球前探、回拉蓄力，再冲向右侧墙并从撞击变形中复原 | Canvas 地面、墙、四个依次填充的倒计时块和 squash，cue `wind-up` | 项目数固定为四个预备帧；保留反向蓄力后发射的机制 |
| `full-reel` | 3.00 s | 最终标题逐字揭示、下划线与两侧批注错峰写入并显示 rendered 状态 | Canvas 逐字符位移与行高遮罩，cue `final-types`、`final-notes` 与 `rendered-toast` | 替换 `line1`、`line2`；保留两行尺度、左到右错峰、蓝点、下划线和状态条 |

`references/sound.json` 记录参考片的声音结构；`assets/soundtrack.mp3` 由交付流程补入，不在本模板源码中手写 `<audio>`。

## Adapting the template

- `spacing`：时长可在 1.6–3.0 秒间调整；额外时间由蓝块轻微发光、控制台滑杆、时间线游标和纸张颗粒填充。该段没有长文案。若姿势少于九个，保持首尾锚点并平均减少中间块；多于九个时缩短错峰但不缩小方块。
- `typography`：时长可在 1.6–3.0 秒间调整；额外时间由句点轻微呼吸、时间线和控制台滑杆填充。标题仍应保持两行重黑构图和从左到右的逐字上升错峰；用户文案过长时先压缩为每行不超过 14 个拉丁字符或 8 个汉字，不要把字号缩到失去压迫感。项目数固定为两行。
- `motion-blur`：时长可在 1.6–3.0 秒间调整；额外时间由网格颗粒、残影轻微闪动和界面游标填充。替换 FAST. 时优先使用不超过 7 个拉丁字符或 4 个汉字的短词；长文案应改写，不要缩小主字。只保留一个主词，避免多个拖影对象互相干扰。
- `easing`：时长可在 1.6–3.0 秒间调整；额外时间由球的连续推进、控制滑杆和微粒填充。图表可改标签，但必须保留线性红线到蓝色 S 曲线的切换。若需要比较更多曲线，分成第二行小图，不要挤压主坐标轴。
- `follow-through`：时长可在 1.6–3.0 秒间调整；额外时间由球和尾迹沿弧线的周期性微动填充。尾迹默认九个；更少时保留至少五个以读出延迟，更多时只增加到十二个并加快错峰。手写说明保持短语长度。
- `anticipation`：时长可在 1.6–3.0 秒间调整；额外时间由蓄力压缩、点阵和滑杆运动填充。四个倒计时块是签名元素；项目更多时仍截取最强的四个预备帧，项目更少时重复中间态，不扩成第二行。批注每处不超过 18 个拉丁字符或 10 个汉字。
- `full-reel`：时长可在 2.5–4.5 秒间调整；额外时间优先给标题停留、蓝色下划线轻微漂移、时间线和控制台波形。两行标题必须保持第一行先起、第二行随后且各自从左到右逐字上升；`line1` 与 `line2` 的 `maxLength` 均为 18，超长时先精简，不要缩小到低于当前视觉层级。项目数固定为两行标题与一个状态条。

总时长改变时，先让 `full-reel` 吸收差值，再依次调整 `spacing`、`typography` 和三个原理演示段；任何场景都不得超出其 `minDur`/`maxDur`。所有退出与场景切换仍从 scene 末尾的 cue 反算，延长部分只能成为持续运动的停留，不能冻结。

Brand-bound: `spacing`、`typography`、`motion-blur`、`easing`、`follow-through`、`anticipation` 的示例术语和批注应按用户品牌重写；`full-reel` 的 Claude 标题及状态按用户品牌重写；页首品牌和角标也需替换。

非拉丁文案（Chinese/CJK）：`--od-font-brand` 的拉丁字体是 Archivo Black，`--od-font-heading` 的拉丁字体是 Anton，两者中文均回退到 Noto Sans SC；`--od-font-body` 的拉丁字体是 IBM Plex Mono，中文同样回退到 Noto Sans SC，并使用与拉丁字面接近的常规或半粗字重。繁体中文改用 Noto Sans TC。交付前必须用用户真实文案（包含标点与中英混排）渲染一帧，检查没有方框字或意外字体回退；如果运行环境完全没有中文字体，应明确告知用户，不要带缺字交付。

## Sound

The demo track is the reference film's own soundtrack.
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
  duration. Edit the selected track with a deliberate ending or fade; use the
  same edited local file in HTML and MP4. Do not rely on an HTML-only loop or
  playbackRate for export.

When the film length changes, refit or replace the track using
references/sound.json (bpm, sections).

To refit, cut the track at the original scene boundaries, time-stretch each piece to its new scene length with ffmpeg atempo (keep each factor within 0.8–1.25; beyond that, trim or loop that piece instead), join the pieces with 40 ms crossfades, fade in 0.15 s and out over the last second, and replace assets/soundtrack.mp3 with the result at exactly CFG.duration.

For background music keep `id="soundtrack"`, `data-start="0"` and a numeric
`data-volume`; update `src` and `data-duration` to the actual edited asset and
film. Remove unused demo audio from the generated composition. The `<audio>`
element stays inside the composition root; verify the ending and audio in both
HTML playback and the exported MP4.

## Source

原始动效来自 [@Asteri_eth](https://x.com/Asteri_eth/status/2112506017887948960)。模板复刻其构图、文案、品牌身份与镜头节奏；两个角标从参考片的 0.00 秒干净区域裁切，其余会执行或被覆盖的元素均以代码重建。
