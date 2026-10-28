import { expect, it } from "vitest";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { createLocalRenderAdapter } from "../src/render/engine/index.js";
const executablePath =
  process.env.EXPORT_TEST_BROWSER ??
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/usr/bin/chromium");
const ffmpegPath = createRequire(import.meta.url)("@ffmpeg-installer/ffmpeg")
  .path as string;
const html =
  '<style>body{margin:0}.slide{width:960px;height:540px;display:none;background:#f0f4ff;padding:40px;box-sizing:border-box}.active{display:block}</style><section class="slide active"><h1>First editable slide</h1></section><section class="slide"><h1>Second editable slide</h1></section>';
it.skipIf(!existsSync(executablePath))(
  "renders actual PDF, images, editable PPTX and MP4, rejecting unavailable assets",
  async () => {
    const engine = createLocalRenderAdapter({ executablePath, ffmpegPath });
    await engine.checkReadiness();
    try {
      expect(await engine.adapter.getCapabilities()).toMatchObject({
        available: true,
        editablePptx: true,
      });
      for (const format of ["pdf", "pdf-image"] as const) {
        const result = await engine.adapter.render({
          html,
          format,
          deck: true,
        });
        expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(2);
      }
      const png = Buffer.from(
        (
          await engine.adapter.render({
            html,
            format: "image",
            deck: true,
            index: 1,
          })
        ).bytes,
      );
      expect(png.readUInt32BE(16)).toBe(960);
      expect(png.readUInt32BE(20)).toBe(540);
      for (const editable of [false, true]) {
        const result = await engine.adapter.render({
            html,
            format: "pptx",
            deck: true,
            editable,
          }),
          zip = await JSZip.loadAsync(result.bytes),
          slides = Object.keys(zip.files).filter((path) =>
            /^ppt\/slides\/slide\d+\.xml$/.test(path),
          );
        expect(slides).toHaveLength(2);
        const text = (
          await Promise.all(
            slides.map((path) => zip.file(path)!.async("string")),
          )
        ).join("");
        expect(text).toContain(editable ? "First editable slide" : "<p:pic>");
      }
      const movie =
        '<meta name="od-motion-audio" content="silent"><main data-composition-id="main" data-duration="1" data-width="320" data-height="180" data-fps="5" style="background:red">Motion</main><script>const tl=gsap.timeline({paused:true});tl.to("main",{backgroundColor:"blue",duration:1,ease:"none"},0);window.__timelines={main:tl};</script>';
      const mp4 = Buffer.from(
        (await engine.adapter.render({ html: movie, format: "mp4" })).bytes,
      );
      expect(mp4.subarray(4, 8).toString()).toBe("ftyp");
      expect(mp4.length).toBeGreaterThan(1000);
      await expect(
        engine.adapter.render({
          html: '<img src="http://127.0.0.1:1/private">',
          format: "image",
        }),
      ).rejects.toMatchObject({ code: "export_resources_unavailable" });
      await expect(
        engine.adapter.render({
          html: "<h1>No deck</h1>",
          format: "pptx",
          deck: true,
        }),
      ).rejects.toMatchObject({ code: "unsupported_deck_layout" });
      await expect(
        engine.adapter.render({ html: "中".repeat(800000), format: "image" }),
      ).rejects.toMatchObject({ code: "invalid_render_request" });
    } finally {
      await engine.close();
    }
  },
  60000,
);
