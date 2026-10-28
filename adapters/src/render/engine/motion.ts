import type { Page } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RenderFailure } from "./error.js";

// Port of upstream 45a6fd80b2's Motion clock and FFmpeg capture contract.
// Browser isolation is owned by renderer.ts; no user value selects a process,
// file path or network destination. FFmpeg receives PNG frames and inline audio.
export async function renderMotion(
  page: Page,
  ffmpegPath: string,
): Promise<Buffer> {
  const spec = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-composition-id]");
    const fail = (message: string) => ({ error: message }) as const;
    if (!root) return fail("缺少 Motion composition 根节点");
    if (
      document.querySelector<HTMLMetaElement>('meta[name="od-motion-output"]')
        ?.content === "interactive"
    )
      return fail("交互动效不能作为定时视频导出");
    const width = Number(root.dataset.width),
      height = Number(root.dataset.height);
    const duration = Number(root.dataset.duration),
      fps = Number(root.dataset.fps ?? 30);
    if (
      ![width, height, fps].every(Number.isInteger) ||
      width < 2 ||
      height < 2 ||
      width > 1920 ||
      height > 1920 ||
      width * height > 1920 * 1080 ||
      fps < 1 ||
      fps > 60 ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 60 ||
      Math.ceil(duration * fps) > 1800
    )
      return fail("视频须在 1080p、60 秒、60 fps、1800 帧范围内");
    const tl = (window as any).__timelines?.[root.dataset.compositionId!];
    if (
      !tl ||
      typeof tl.pause !== "function" ||
      typeof tl.seek !== "function" ||
      typeof tl.duration !== "function" ||
      typeof tl.timeScale !== "function"
    )
      return fail("Motion 源文件必须注册可定位的 GSAP 时间线");
    if (
      !Number.isFinite(tl.duration()) ||
      Math.abs(tl.duration() - duration) > 0.001 ||
      Math.abs(tl.timeScale() - 1) > 0.000001 ||
      tl.repeat() !== 0 ||
      tl.delay() !== 0
    )
      return fail(
        "Motion 时间线时长须与 data-duration 相同，且不能变速、循环或延迟",
      );
    if (document.querySelector("video"))
      return fail("当前云端视频导出尚不支持嵌套 video 素材");
    const elements = [...document.querySelectorAll("audio")];
    const audioRequired =
      document.querySelector<HTMLMetaElement>('meta[name="od-motion-audio"]')
        ?.content === "required";
    if (elements.length > 8 || (audioRequired && !elements.length))
      return fail("音轨缺失或超过 8 条");
    const tracks = [];
    for (const audio of elements) {
      const match =
        /^data:audio\/(wav|x-wav|mpeg|mp3|ogg);base64,([A-Za-z0-9+/=\s]+)$/.exec(
          audio.getAttribute("src") ?? "",
        );
      if (!match)
        return fail(
          "音频须内嵌为 WAV、MP3 或 OGG；Runtime 尚不能读取工程音频文件",
        );
      const start = Number(audio.dataset.start ?? 0);
      const length = Number(audio.dataset.duration);
      const volume = Number(audio.dataset.volume ?? 1);
      if (
        ![start, length, volume].every(Number.isFinite) ||
        start < 0 ||
        start >= duration ||
        length <= 0 ||
        length > 60 ||
        volume < 0 ||
        volume > 1 ||
        audio.matches("[loop], [data-media-start], [data-playback-rate]")
      )
        return fail("音频须使用有效的开始时间、时长和音量，且不能循环或变速");
      tracks.push({
        format: /wav/.test(match[1]!)
          ? "wav"
          : /mp/.test(match[1]!)
            ? "mp3"
            : "ogg",
        base64: match[2]!,
        start,
        duration: length,
        volume,
      });
      audio.pause();
      audio.muted = true;
    }
    if (audioRequired && !tracks.some((track) => track.volume > 0))
      return fail("该 Motion 要求可听音轨，不能静音导出");
    tl.pause(0);
    (window as any).__cloudMotionTimeline = tl;
    root.dataset.cloudMotionRoot = "true";
    return { width, height, duration, fps, tracks };
  });
  if ("error" in spec)
    throw new RenderFailure("invalid_motion_source", spec.error!);
  await page.setViewportSize({ width: spec.width, height: spec.height });
  await page.addStyleTag({
    content: `
    html,body{margin:0!important;padding:0!important;overflow:hidden!important}
    [data-cloud-motion-root]{position:fixed!important;left:0!important;top:0!important;
      width:${spec.width}px!important;height:${spec.height}px!important;transform:none!important;margin:0!important}
  `,
  });
  const dir = await mkdtemp(join(tmpdir(), "od-motion-"));
  const output = join(dir, "film.mp4");
  try {
    const audioArgs: string[] = [];
    const filters: string[] = [];
    for (const [index, track] of spec.tracks.entries()) {
      const file = join(dir, `audio-${index}`);
      const bytes = Buffer.from(track.base64, "base64");
      if (!bytes.length || bytes.length > 2 * 1024 * 1024)
        throw new RenderFailure(
          "invalid_motion_source",
          "音频内容为空或超过限制",
        );
      await writeFile(file, bytes);
      audioArgs.push(
        "-protocol_whitelist",
        "file,pipe",
        "-f",
        track.format,
        "-i",
        file,
      );
      const audible = Math.min(track.duration, spec.duration - track.start);
      const fade = Math.min(0.6, audible / 4);
      const delay = Math.round(track.start * 1000);
      filters.push(
        `[${index + 1}:a]atrim=duration=${track.duration},asetpts=PTS-STARTPTS,` +
          `aformat=channel_layouts=stereo,afade=t=out:st=${audible - fade}:d=${fade},` +
          `volume=${track.volume},adelay=${delay}|${delay}[a${index}]`,
      );
    }
    const mixArgs: string[] = [];
    if (filters.length) {
      const mixed =
        spec.tracks.length === 1
          ? "[a0]"
          : spec.tracks.map((_, i) => `[a${i}]`).join("") +
            `amix=inputs=${spec.tracks.length}:duration=longest:dropout_transition=0,volume=${spec.tracks.length},`;
      filters.push(`${mixed}apad,atrim=duration=${spec.duration}[audio]`);
      mixArgs.push(
        "-filter_complex",
        filters.join(";"),
        "-map",
        "0:v",
        "-map",
        "[audio]",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
      );
    }
    const child = spawn(
      ffmpegPath,
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        // Bound FFmpeg independently of the host CPU count: cloud containers
        // can see many host cores despite having a small CPU/memory quota.
        "-filter_threads",
        "1",
        "-filter_complex_threads",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "-framerate",
        String(spec.fps),
        "-threads",
        "2",
        "-i",
        "pipe:0",
        ...audioArgs,
        ...mixArgs,
        "-vf",
        "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-t",
        String(spec.duration),
        "-movflags",
        "+faststart",
        output,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let failure: Error | undefined;
    const completion = new Promise<void>((resolve) => {
      child.once("error", (error) => {
        failure = error;
        resolve();
      });
      child.once("close", (code) => {
        if (code !== 0) failure ??= new Error("FFmpeg failed");
        resolve();
      });
    });
    // Consume diagnostics without returning source data or server paths to clients.
    child.stderr.resume();
    child.stdin.on("error", (error) => {
      failure ??= error;
    });
    const timer = setTimeout(() => {
      failure = new Error("Motion rendering timed out");
      child.kill("SIGKILL");
      void page.context().close();
    }, 290000);
    try {
      const count = Math.ceil(spec.duration * spec.fps);
      for (let frame = 0; frame < count; frame++) {
        if (failure) throw failure;
        await page.evaluate(async (time) => {
          (window as any).__cloudMotionTimeline.pause().seek(time, true);
          // Canvas layers derive state from timeline time during requestAnimationFrame.
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        }, frame / spec.fps);
        const png = await page.screenshot({
          type: "png",
          clip: { x: 0, y: 0, width: spec.width, height: spec.height },
        });
        await new Promise<void>((resolve, reject) => {
          child.stdin.write(png, (error) =>
            error ? reject(error) : resolve(),
          );
        });
        if (
          frame % 30 === 0 &&
          (await stat(output).catch(() => null))?.size! > 20 * 1024 * 1024
        )
          throw new RenderFailure("export_too_large", "导出视频超过 20 MiB");
      }
      child.stdin.end();
      await completion;
      if (failure) throw failure;
      return await readFile(output);
    } catch (error) {
      if (error instanceof RenderFailure) throw error;
      throw new RenderFailure(
        "motion_render_failed",
        "视频编码未完成，请检查时间线或重试",
        502,
      );
    } finally {
      clearTimeout(timer);
      child.kill("SIGKILL");
      await completion;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
