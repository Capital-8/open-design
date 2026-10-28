# HyperFrames Studio 发布片

从 `example.html` 开始，这是可编辑的完整影片。

**Arc:** 深夜通知 → 创作指令 → 吉祥物与多轨编辑 → 协作与真人素材 → 社交短片 → 平台装置 → 品牌落版

## Source
参考：@HyperFrames_，https://x.com/HyperFrames_/status/2107149824189698558 。仅使用工作区提供的影片，未访问来源链接。

## Reference files
保留 `example.html`、`references/sound.json` 以及 `assets/` 下所有图片（包括 `assets/gallery-vision.png`、`assets/gallery-calendar.png`、`assets/building.png`）、`assets/gsap.min.js`、`assets/Inter.ttf` 和 `assets/Inter-OFL.txt`。`assets/soundtrack.mp3` 由运行器加入。

## 场景结构

| Scene (`CFG.scenes` id) | Dur | Summary | Build | Reuse |
|---|---|---|---|---|
| `office` | 2.750 s | 深夜工作室背影与时间标记 | 单 Canvas；`office-enter` 进入，`office-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `notification` | 1.100 s | 桌面收到发布通知 | 单 Canvas；`notification-enter` 进入，`notification-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `request` | 6.850 s | Slack 回复、Dock 和逐字创作指令 | 单 Canvas；`request-enter` 进入，`request-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `mascot` | 4.200 s | 眼镜 Nib 阅读黄色手册并出现灵感灯泡 | 单 Canvas；`mascot-enter` 进入，`mascot-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `launch` | 2.500 s | 发布片卡片浮起旋转 | 单 Canvas；`launch-enter` 进入，`launch-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `tracks` | 4.100 s | 多轨时间线依次填充素材和声音 | 单 Canvas；`tracks-enter` 进入，`tracks-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `introducing` | 2.500 s | 黑色介绍片卡显示产品名 | 单 Canvas；`introducing-enter` 进入，`introducing-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `editor` | 3.050 s | 完整编辑器切入彩色网点预览 | 单 Canvas；`editor-enter` 进入，`editor-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `draw` | 3.400 s | 圈选标题、输入放大请求 | 单 Canvas；`draw-enter` 进入，`draw-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `comment` | 2.900 s | 评论把 humans 改为薄荷绿 | 单 Canvas；`comment-enter` 进入，`comment-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `aroll` | 5.850 s | Slack 中加入男子 A-roll，进入编辑器 | 单 Canvas；`aroll-enter` 进入，`aroll-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `gallery` | 5.900 s | 素材卡向上翻动进入作品画廊 | 单 Canvas；`gallery-enter` 进入，`gallery-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `prompts` | 5.600 s | 五类编辑请求逐条输入 | 单 Canvas；`prompts-enter` 进入，`prompts-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `social` | 7.900 s | 女性竖屏聚合出现并添加编辑轨 | 单 Canvas；`social-enter` 进入，`social-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `export` | 1.950 s | Export 按钮收缩为黑色弹珠 | 单 Canvas；`export-enter` 进入，`export-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `platform-x` | 5.300 s | X 灯泡标志与上传终端 | 单 Canvas；`platform-x-enter` 进入，`platform-x-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `platform-instagram` | 3.700 s | Instagram 立体图标、相片与分享终端 | 单 Canvas；`platform-instagram-enter` 进入，`platform-instagram-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `platform-tiktok` | 3.800 s | TikTok 标志和环形灯上传终端 | 单 Canvas；`platform-tiktok-enter` 进入，`platform-tiktok-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `platform-youtube` | 3.050 s | YouTube 灯泡标志与发布终端 | 单 Canvas；`platform-youtube-enter` 进入，`platform-youtube-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |
| `end` | 4.411 s | 暖色灯光照亮母品牌、品牌和 Studio | 单 Canvas；`end-enter` 进入，`end-out` 尾部衔接；cubic out | 保留原片身份；通过 CFG 图片和文案变量调整 |

## Adapting the template
- `office`：可替换深夜工作室背影与时间标记中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 2.750–4.125 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `office-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `notification`：可替换桌面收到发布通知中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 1.100–1.650 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `notification-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `request`：可替换Slack 回复、Dock 和逐字创作指令中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 6.850–10.275 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `request-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `mascot`：可替换眼镜 Nib 阅读黄色手册并出现灵感灯泡中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 4.200–6.300 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `mascot-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `launch`：可替换发布片卡片浮起旋转中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 2.500–3.750 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `launch-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `tracks`：可替换多轨时间线依次填充素材和声音中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 4.100–6.150 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `tracks-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `introducing`：可替换黑色介绍片卡显示产品名中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 2.500–3.750 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `introducing-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `editor`：可替换完整编辑器切入彩色网点预览中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 3.050–4.575 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `editor-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `draw`：可替换圈选标题、输入放大请求中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 3.400–5.100 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `draw-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `comment`：可替换评论把 humans 改为薄荷绿中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 2.900–4.350 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `comment-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `aroll`：可替换Slack 中加入男子 A-roll，进入编辑器中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 5.850–8.775 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `aroll-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `gallery`：可替换素材卡向上翻动进入作品画廊中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 5.900–8.850 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `gallery-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `prompts`：可替换五类编辑请求逐条输入中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 5.600–8.400 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `prompts-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `social`：可替换女性竖屏聚合出现并添加编辑轨中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 7.900–11.850 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `social-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `export`：可替换Export 按钮收缩为黑色弹珠中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 1.950–2.925 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `export-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `platform-x`：可替换X 灯泡标志与上传终端中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 5.300–7.950 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `platform-x-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `platform-instagram`：可替换Instagram 立体图标、相片与分享终端中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 3.700–5.550 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `platform-instagram-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `platform-tiktok`：可替换TikTok 标志和环形灯上传终端中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 3.800–5.700 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `platform-tiktok-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `platform-youtube`：可替换YouTube 灯泡标志与发布终端中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 3.050–4.575 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `platform-youtube-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。
- `end`：可替换暖色灯光照亮母品牌、品牌和 Studio中的相关文字或图片，保留对应动作顺序与 cubic out 入场。范围 4.411–6.616 秒，未锁定；多余时间由漂浮、光标、网点流动、弹珠或灯光呼吸填充，退出仍跟随 `end-out`。文案品牌上限 16、产品 24、标题 52、发布指令 170、社交指令 48 字符；超过限制先精简文字，保持字号可读。素材增减时优先保留最强三项，画廊可增加一行；通知与终端只保留一条主信息。

总时长变化优先由 tracks、social、gallery、request 吸收，品牌落版至少保留原时长；重新拟合所有从结尾计算的退出 cue。Chinese/CJK：标题与正文均使用随附 Google Fonts Inter，后备 Noto Sans SC，字重与 Latin 一致；繁体改用 Noto Sans TC。交付前用真实中英混排、标点截帧核对缺字；若环境无中文字体，应明确告知。只有用户指定时才加入其他中文字体。

## Sound
`assets/soundtrack.mp3` ships as the demo track.
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



### Runner review refinement

The request scene retains the close Slack camera pan, downward Dock reveal, app bounce and upward opening prompt card. The isolated image slots `slack_avatar`, `dock_settings`, and `dock_slack` supply chat and Dock artwork. Preserve this camera sequence when adapting; allow the prompt typing to finish during extra scene time.
