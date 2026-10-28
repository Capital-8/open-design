# Great Figures Résumé

从 `example.html` 开始制作影片；画面结构、可替换变量与时间线都在该文件的 `CFG` 中。声音节拍与效果映射记录在 `references/sound.json`，runner 会补入的示范音轨路径是 `assets/soundtrack.mp3`。

**Arc:** 落笔写名 → 履历揭晓 → 纸张折叠 → 节目标题

| Scene (`CFG.scenes` id) | Dur | Summary | Build | Reuse |
|-|-|-|-|-|
| `resume` | 10.85 s | 钢笔在日式履历书上写出「織田」，镜头再拉远显出织田信长的肖像、履历与资格表 | 单 Canvas；`write-begins` 与 `surname-complete` 控制遮罩书写，`resume-pan-begins` 让近景在第二字落笔时开始掠过表格，`resume-reveal` 继续拉远到双页文书，`resume-out` 交给折页 | 可替换 `subjectName`、`subjectKana`、`portraitImage`、`penImage`、`paperColor`；写名与连续拉远是场景标志 |
| `fold` | 2.35 s | 完整履历短暂停留后迅速向内压成单张纸，小节目标题随纸面一起持续推近 | 单 Canvas；纸张缩放、斜切与阴影模拟折页，`fold-title-appears` 在折叠中段接入 `titleImage`，同一条推近运动跨过 `fold-out` | 可替换 `titleImage` 与 `paperColor`；履历停留、快速折叠、纸面与标题共同推近的连续变形必须保留 |
| `title` | 2.334667 s | 金红日文标题与四位历史人物继续推近并占满暖灰纸面，随后保持轻微呼吸 | 单 Canvas；沿用 `fold-title-appears` 开始的全局缩放，`title-settles` 完成最后一次推近，`title-end` 以前持续纸尘、漂移和暗角变化 | 可替换 `titleImage` 与 `paperColor`；居中的大标题落版必须保留 |

## Adapting the template

- `resume`：姓名、读音、人物肖像、钢笔和纸色都可替换，但“笔尖沿姓名移动后镜头连续拉远”的机制不能改成硬切。场景可在 9.2–14.0 秒之间伸缩；新增时长放在写名完成与 `resume-reveal` 之间，期间用笔尖轻微呼吸、纸尘与纸面漂移填充。`subjectName` 最多 8 个字符，`subjectKana` 最多 18 个字符；更长时先缩短文案，不要把姓名字号缩到难以阅读。履历默认每栏保留 6–7 条经历：条目更多时保留最强的七条并加第二页，不要继续压窄行高；更少时保留空白表格行以维持真实履历书的节奏。
- `fold`：这是锁定在 2.35 秒的变形桥段，不能伸缩。可替换纸色与 `titleImage`，但完整履历先短暂停留、双页快速向内收拢、标题从小到大出现、纸面持续放大直至木桌退场的顺序必须保留。该场景没有独立可编辑文案；标题内容应随 `titleImage` 一起更换。若用户有多件主视觉，只选最有代表性的一件作为折页后的锁定图，不要在折页中轮播。
- `title`：可在 1.8–4.0 秒之间伸缩，额外时长由标题的微弱呼吸、1–2 像素漂移、纸尘和暗角变化填充，不能冻结。`titleImage` 应提供带安全边距的横向透明图；若标题更复杂，应缩短副标题或重排图像，不要缩到主体不可辨。若有多件主视觉，使用最强的一件作为主锁定图，其余内容另增场景，不要在本场景内堆叠。

改变总时长时，先由 `resume` 吸收或释放时长，再调整 `title`；`fold` 始终保持 2.35 秒。所有离场和场景转换继续从 `from: "end"` 的 cue 计算，新增的中段保持时间必须保留可见的环境运动。

非拉丁文字使用时，`--od-font-heading` 与 `--od-font-body` 的拉丁字面都是随包提供的 Lato，简体中文/CJK 回退到 Noto Sans SC 并使用与 Lato 相同的 400 字重；繁体中文改用 Noto Sans TC。交付前必须用用户的真实文案渲染一帧，连同标点、混排拉丁字母一起检查字形是否统一且没有方框；若 Linux 或精简容器完全没有中文字体，应明确告知用户，不要交付缺字影片。

## Sound

The demo track is the reference film's own soundtrack.
It ships as `assets/soundtrack.mp3` and is timed to the reference picture; its
structure is described in `references/sound.json`.
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

When the film length changes, refit or replace the track using
references/sound.json (bpm, sections).

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

## Source

参考动效来自 [@Wakuwakukucx](https://x.com/Wakuwakukucx/status/2088804332783435958)。本模板仅保存从清晰帧裁出的局部静态素材，不包含原始视频或整帧背景。
