---
name: claude-motion-reel
description: Claude 动态设计作品集，展示字形拉伸、缓动、形变、生成纹样与三维网格。
od:
  mode: video
  scenario: video
---

从 `example.html` 开始制作；它是完整影片，所有时间、文案和颜色集中在 `CFG` 中。先保留原片内容与节奏，再按用户的具体要求替换输入。

# Claude 动态设计作品集

**叙事：** 标志生成 → 字形身份 → 缓动实验 → 几何变形 → 生成纹样 → 空间网格 → 快速文字 → 品牌落版。

## 结构与时间

| 场景（`CFG.scenes` id） | 时长 | 观众看到的内容 | 构建方式 | 可复用内容 |
|---|---|---|---|---|
| `seed` | 1.883333 s | 红点变为十二根星芒射线，环线扩散。 | 单 canvas；`seed-grow`、`seed-rays`、`seed-out`；解析缓动与弹簧轮廓插值 | coral、ink；星芒比例保留。 |
| `identity` | 1.583334 s | CLAUDE 字母分别横向拉伸，斜体职业描述浮现。 | 单 canvas；`identity-in`、`descriptor-in`、`identity-out`；解析缓动与弹簧轮廓插值 | brand、role、reelYear；六字母分别伸缩。 |
| `easing` | 2.166666 s | 六种缓动让六个圆点沿同距离跑道运动。 | 单 canvas；`easing-grid`、`easing-run`、`easing-out`；解析缓动与弹簧轮廓插值 | easingTitle、paper、blue；固定六种曲线。 |
| `morph` | 1.866667 s | 圆、三角、星、方连续形变，十二个小形状绕行。 | 单 canvas；`morph-circle`、`morph-triangle`、`morph-star`、`morph-square`、`morph-out`；解析缓动与弹簧轮廓插值 | blue、paper、coral；四个主形状与十二个轨道形状。 |
| `systems` | 1.875000 s | 全屏弧线网格由米白连环变成红色散弧。 | 单 canvas；`systems-wave`、`systems-out`；解析缓动与弹簧轮廓插值 | ink、paper、coral；153 个弧线拼接单元。 |
| `depth` | 1.875000 s | 透视平面卷成球体，再成为旋转环面。 | 单 canvas；`depth-plane`、`depth-sphere`、`depth-torus`、`depth-out`；解析缓动与弹簧轮廓插值 | ink、paper、coral；保持 576 顶点。 |
| `kinetic` | 1.866667 s | EASE、IN、EASE、OUT、NEVER、字墙、LINEAR 快切。 | 单 canvas；`type-ease`、`type-in`、`type-tall`、`type-out`、`type-never`、`type-repeat`、`type-linear`、`type-zoom`；解析缓动与弹簧轮廓插值 | easeWord、inWord、outWord、neverWord、linearWord。 |
| `final` | 1.944666 s | 黑星芒、CLAUDE 字标、职业描述、合作状态落版。 | 单 canvas；`final-burst`、`final-wordmark`、`final-detail`、`final-settle`；解析缓动与弹簧轮廓插值 | wordmark、role、footer、availability；星芒与横线保留。 |

`CFG.duration` 是唯一总时长，场景起点由 `dur` 累加得出。入场从场景开始计时，离场通过 `from: "end"` 的 cue 读取。`render(t)` 和 `window.__odRenderAt(t)` 支持任意前后跳转。`window.__timelines.main` 是唯一播放时钟；底部控件随鼠标悬停显示，导出时隐藏。

## 携带的文件

复制 `example.html`、`references/sound.json`、`assets/gsap.min.js`、`assets/claude-wordmark.png`、`assets/ArchivoBlack-Regular.ttf`、`assets/ArchivoBlack-OFL.txt`、`assets/InstrumentSerif-Italic.ttf`、`assets/InstrumentSerif-OFL.txt`、`assets/IBMPlexMono-Regular.ttf`、`assets/IBMPlexMono-OFL.txt`。字体与脚本均为本地文件；字体许可随文件保留。`assets/cover.jpg` 仅作模板封面。仅按下述音频规则选用 `assets/soundtrack.mp3`。

## Adapting the template

- `seed`：伸展范围 1.883333–3.107499 秒。可换 coral、ink，星芒的不等长十二射线和环线扩散必须保留。orbitText 最长 60 字符；过长先精简，不能把环字压到不可辨读。无其他主文案；新增作品优先放后续场景。加长时星芒持续旋转、环线和轨道点继续变化。
- `identity`：伸展范围 1.583334–2.612501 秒。brand 最长 9 字符，role 最长 24 字符，reelYear 最长 4 字符，reelLabel 最长 24 字符。默认 CLAUDE 使用逐帧测出的六字母边界；换品牌后用逐字伸缩布局。长文案先精简，不能压低可读字号。保持大字占宽和逐字反差，不增加第二个品牌；更多职业只保留最主要的一项。加长时循环中段字母伸缩。
- `easing`：伸展范围 2.166666–3.574999 秒。easingTitle 最长 35 字符。六种缓动及六跑道是对比机制，圆点可随配色变化。多于六个项目只选六个代表项；少于六个时保留空行或明确减少行数并等距排列，不能挤成微小文字。标题过长先精简；加长时按固定 1.4 秒周期重新跑动，离场仍对齐 easing-out。
- `morph`：伸展范围 1.866667–3.080001 秒。保留圆→三角→五角星→方的连续轮廓插值、旋转、红色线框和十二个卫星形状。用户需要更多形状时增加轮廓阶段并相应延长此场景；更少形状则保留首尾和最有辨识度的中间形状。图形辅助标签不超过 30 字符，长句移到说明。加长时四形状循环且轨道持续转动。
- `systems`：伸展范围 1.875000–3.093750 秒。保留四分之一圆弧拼接、三道波及由连接到断开的变化，允许改色。没有列表项；不要把新增产品卡硬放入此镜头，需要展示项目时增加独立镜头。小标签控制 45 字符以内。加长后各弧线仍随时间摆动。
- `depth`：伸展范围 1.875000–3.093750 秒。保留平面→球体→环面的空间变形，576 个顶点是原片内容；若用户要求改变数量，需连同画面内 VERTICES 数值更新，不能只改标签。额外产品不放进网格，改用红色高亮点表达类别。辅助文案最多 55 字符，长文案精简。延长时环面持续旋转，白点和红点随空间运动。
- `kinetic`：伸展范围 1.866667–1.866667 秒。此段锁定节拍，minDur=maxDur，必须保留七次快切和红色句点放大。easeWord 最长 6、inWord 最长 5、outWord 最长 5、neverWord 最长 7、linearWord 最长 8 字符。长词先精简，不缩到小号；更多词优先替换既有七次镜头中的词，少于七项时用重复、轮廓与字墙变体补足，不能改切点。字形拉伸、拖影和字墙移动持续到每次切换。
- `final`：伸展范围 1.944666–3.208699 秒。wordmark 是从原片裁取的透明字标，换品牌时同时替换此图片与 brand，不能只改 HUD。role 最长 24、footer 最长 60、availability 最长 30 字符。保留左侧星芒、右侧宽字标、斜体职业、横线与状态点。只保留一个主品牌和一条合作状态，多项目移到前面。长文案先精简；加长时星芒增加可见的轻缓转动，状态灯继续呼吸。

不同总时长优先由 easing、systems、depth 吸收，再调整 identity、morph、final，最后才调整 seed。kinetic 锁定；修改场景时同步更新 CFG.duration，并让后续起点自动累加。所有离场 cue 保持 `from: "end"`，不要整体缩放场景内部时间。

Chinese / CJK：`--od-font-heading` 使用随包的 Archivo Black，后接 Noto Sans SC；`--od-font-body` 使用随包的 IBM Plex Mono，后接 Noto Sans SC；斜体角色使用 Instrument Serif，后接 Noto Serif SC。中文回退取与拉丁字重相应的常规或粗体；繁体中文改为 Noto Sans TC / Noto Serif TC。中文字体由 OD 提供，不随模板打包。交付前用真实文案连同标点和中英混排渲染，检查方框与异常回退；机器没有任何中文字型时明确告知使用者。仅在用户指定时增加具体中文字体，不因此阻止默认英文模板交付。

## 来源

团队成员上传的 `reference.mp4`，1920×1080，60 FPS，容器时长 15.061333 秒。未提供可核实的外部链接与作者，不能编造发布页。保留片中 CLAUDE 名称与标志；除裁取稳定片尾字标，其余活动图形均重建，未携带原视频或整帧背景。

## Sound
示范音轨来自原片，后续由 runner 写入；它仅是可选示范，用户的时长、音乐和声音要求优先。影片长度改变时，应根据 `references/sound.json` 的节拍与分段重新剪配或更换音轨。以下保留官方音频规则原文。

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
