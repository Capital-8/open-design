import { RenderFailure } from "./error.js";
import { createRequire } from "node:module";
import { renderMotion } from "./motion.js";
import { chromium, type Browser, type Page } from "playwright-core";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

import * as PptxModule from "pptxgenjs";
import { PDFDocument } from "pdf-lib";
import {
  renderRequest,
  type RenderRequest,
} from "@open-design/contracts/cloud/render";

const SLIDES = ".slide, [data-screen-label], .deck-slide, .ppt-slide";
const MAX_BYTES = 20 * 1024 * 1024;
// The pinned package has different namespace wrappers under Node ESM and tsx.
type PptxInstance = InstanceType<typeof import("pptxgenjs").default>;
const candidates: unknown[] = [
  PptxModule,
  PptxModule.default,
  (PptxModule.default as unknown as { default?: unknown })?.default,
];
const PptxGenJS = candidates.find(
  (candidate) => typeof candidate === "function",
) as { new (): PptxInstance } | undefined;

// Credential-free isolated renderer only. Request data cannot select an
// executable, filesystem path, network destination, or browser profile.
export async function renderExport(
  input: RenderRequest,
  options: {
    executablePath: string;
    ffmpegPath: string;
    domToPptxBundle: string;
  },
): Promise<Buffer> {
  const request = renderRequest.parse(input);
  let browser: Browser | undefined;
  const timer = setTimeout(
    () => {
      void browser?.close();
    },
    request.format === "mp4" ? 300000 : 30000,
  );
  try {
    browser = await chromium.launch({
      executablePath: options.executablePath,
      timeout: 10000,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
      ],
    });
    const context = await browser.newContext({
      viewport: {
        width: request.width ?? (request.deck ? 1280 : 1440),
        height: request.height ?? (request.deck ? 720 : 900),
      },
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    const gsap =
      request.format === "mp4"
        ? await readFile(
            createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"),
            "utf8",
          )
        : undefined;
    let served = false;
    const blockedResources = new Set<string>();
    await context.route("**/*", async (route) => {
      const req = route.request();
      if (
        !served &&
        req.isNavigationRequest() &&
        req.url() === "https://export.invalid/"
      ) {
        served = true;
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          headers: {
            "Content-Security-Policy": `default-src 'none'; script-src 'unsafe-inline' ${gsap ? "'self'" : ""}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`,
          },
          body: request.html,
        });
      } else if (
        gsap &&
        [
          "https://export.invalid/gsap.min.js",
          "https://export.invalid/assets/gsap.min.js",
        ].includes(req.url()) &&
        req.resourceType() === "script"
      ) {
        await route.fulfill({
          contentType: "application/javascript",
          body: gsap,
        });
      } else {
        if (
          ["image", "stylesheet", "font", "script"].includes(req.resourceType())
        )
          blockedResources.add(req.resourceType());
        await route.abort();
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    if (gsap) {
      await page.addInitScript(() => {
        (window as any).__odMotionRender = true;
        (window as any).__odFrameRenderer = true;
      });
      await page.addInitScript({ content: gsap });
    }
    page.on("dialog", (dialog) => {
      void dialog.dismiss();
    });
    context.on("page", (popup) => {
      if (popup !== page) void popup.close();
    });
    // CSP-blocked dependencies never reach the route interceptor. Capture them
    // separately so an incomplete rendered document is not exported as success.
    await page.addInitScript(() => {
      (window as any).__exportMissingResource = false;
      document.addEventListener("securitypolicyviolation", (event) => {
        if (
          [
            "img-src",
            "style-src-elem",
            "script-src-elem",
            "font-src",
            "frame-src",
            "media-src",
          ].includes(event.effectiveDirective)
        ) {
          (window as any).__exportMissingResource = true;
        }
      });
    });
    await page.goto("https://export.invalid/", {
      waitUntil: "load",
      timeout: 15000,
    });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    if (
      blockedResources.size ||
      (await page.evaluate(() => (window as any).__exportMissingResource))
    ) {
      throw new RenderFailure(
        "export_resources_unavailable",
        "导出依赖未内嵌的图片、字体或脚本；当前仅支持自包含页面",
      );
    }
    if (request.format === "mp4") {
      const output = await renderMotion(page, options.ffmpegPath);
      if (
        blockedResources.size ||
        (await page.evaluate(
          () =>
            Boolean((window as any).__exportMissingResource) ||
            [...document.images].some(
              (img) =>
                Boolean(img.currentSrc || img.src) &&
                (!img.complete || !img.naturalWidth),
            ),
        ))
      )
        throw new RenderFailure(
          "export_resources_unavailable",
          "视频素材未能完整加载",
        );
      if (output.length > MAX_BYTES)
        throw new RenderFailure("export_too_large", "导出视频超过 20 MiB");
      return output;
    }
    await page.addStyleTag({
      content:
        "* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; animation: none !important; transition: none !important; }",
    });
    let output: Buffer;
    if (!request.deck && request.format === "pdf") {
      output = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      });
    } else {
      const stage = request.deck ? await prepareSlides(page, request) : null;
      if (request.format === "pptx" && request.editable) {
        const bundle = gunzipSync(
          await readFile(options.domToPptxBundle),
        ).toString("utf8");
        await page.addScriptTag({ content: bundle });
        const encoded = await page.evaluate(async () => {
          // SVG className is SVGAnimatedString; the pinned converter expects a string.
          for (const el of document.querySelectorAll("*")) {
            if (typeof el.className !== "string")
              Object.defineProperty(el, "className", {
                value: (el.className as any).baseVal ?? "",
                configurable: true,
              });
          }
          const blob = await (window as any).domToPptx.exportToPptx(
            Array.from(document.querySelectorAll("[data-cloud-export-slide]")),
            {
              fileName: "deck.pptx",
              skipDownload: true,
              autoEmbedFonts: false,
              svgAsVector: true,
            },
          );
          const bytes = new Uint8Array(await blob.arrayBuffer());
          if (bytes.length > 20 * 1024 * 1024)
            throw new Error("Export too large");
          let binary = "";
          for (let i = 0; i < bytes.length; i += 32768)
            binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
          return btoa(binary);
        });
        output = Buffer.from(encoded, "base64");
      } else if (request.format === "image") {
        if (stage && request.index !== undefined) {
          await showSlide(page, request.index, stage.count);
          output = await page.screenshot({
            type: "png",
            clip: { x: 0, y: 0, width: stage.width, height: stage.height },
          });
        } else {
          const size = await page.evaluate(() => ({
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight,
          }));
          if (size.height > 16000 || size.width * size.height > 32_000_000)
            throw new RenderFailure(
              "export_too_large",
              "图片过长，请使用 PDF 或按页导出",
            );
          output = await page.screenshot({ type: "png", fullPage: true });
        }
      } else {
        const images: Array<{ bytes: Buffer; width: number; height: number }> =
          [];
        const count = stage?.count ?? 1;
        for (let index = 0; index < count; index++) {
          if (stage) await showSlide(page, index, count);
          const size =
            stage ??
            (await page.evaluate(() => ({
              width: document.documentElement.scrollWidth,
              height: document.documentElement.scrollHeight,
            })));
          if (size.height > 16000 || size.width * size.height > 32_000_000)
            throw new RenderFailure(
              "export_too_large",
              "页面过长，请使用普通 PDF 导出",
            );
          const bytes = await page.screenshot({
            type: "png",
            clip: { x: 0, y: 0, width: size.width, height: size.height },
          });
          images.push({ bytes, width: size.width, height: size.height });
          if (
            images.reduce((sum, image) => sum + image.bytes.length, 0) >
            MAX_BYTES
          )
            throw new RenderFailure(
              "export_too_large",
              "导出图片总大小超过限制",
            );
        }
        if (request.format === "pptx") {
          if (!PptxGenJS) throw new Error("PPTX constructor unavailable");
          const pptx = new PptxGenJS();
          const { width, height } = images[0]!;
          pptx.defineLayout({
            name: "CLOUD",
            width: width / 96,
            height: height / 96,
          });
          pptx.layout = "CLOUD";
          pptx.author = "OpenDesign";
          for (const image of images)
            pptx.addSlide().addImage({
              data: `image/png;base64,${image.bytes.toString("base64")}`,
              x: 0,
              y: 0,
              w: width / 96,
              h: height / 96,
            });
          output = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
        } else {
          const pdf = await PDFDocument.create();
          for (const image of images) {
            const png = await pdf.embedPng(image.bytes);
            const page = pdf.addPage([image.width * 0.75, image.height * 0.75]);
            page.drawImage(png, {
              x: 0,
              y: 0,
              width: page.getWidth(),
              height: page.getHeight(),
            });
          }
          output = Buffer.from(await pdf.save());
        }
      }
    }
    if (
      blockedResources.size ||
      (await page.evaluate(
        () =>
          Boolean((window as any).__exportMissingResource) ||
          Array.from(document.images).some(
            (img) =>
              Boolean(img.currentSrc || img.src) &&
              (!img.complete || !img.naturalWidth),
          ),
      ))
    )
      throw new RenderFailure(
        "export_resources_unavailable",
        "页面资源未能完整加载",
      );
    if (output.length > MAX_BYTES)
      throw new RenderFailure("export_too_large", "导出文件超过 20 MiB 限制");
    return output;
  } finally {
    clearTimeout(timer);
    await browser?.close();
  }
}

async function prepareSlides(page: Page, request: RenderRequest) {
  const stage = await page.evaluate(
    ({ selector, width, height }) => {
      const slides = Array.from(
        document.querySelectorAll<HTMLElement>(selector),
      ).filter(
        (el) =>
          !el.closest(".mini-slide, .overview, .notes-overlay, .thumb") &&
          !el.parentElement?.closest(selector),
      );
      if (!slides.length || slides.length > 80) return null;
      const first = slides[0]!;
      const css = getComputedStyle(first);
      const w = width ?? (parseFloat(css.width) || first.offsetWidth || 1280);
      const h = height ?? (parseFloat(css.height) || first.offsetHeight || 720);
      if (w < 320 || w > 4096 || h < 180 || h > 2304) return null;
      // Keep DOM ancestry to preserve descendant CSS. Hide non-slide siblings,
      // neutralize carousel transforms and size every slide at its authored ratio.
      for (const slide of slides) {
        let child: Element = slide;
        while (
          child.parentElement &&
          child.parentElement !== document.documentElement
        ) {
          const parent = child.parentElement;
          for (const sibling of parent.children) {
            if (
              !slides.some((s) => sibling === s || sibling.contains(s)) &&
              sibling instanceof HTMLElement &&
              !["STYLE", "SCRIPT", "LINK"].includes(sibling.tagName)
            )
              sibling.style.setProperty("display", "none", "important");
          }
          parent.style.setProperty("transform", "none", "important");
          parent.style.setProperty("display", "block", "important");
          parent.style.setProperty("position", "static", "important");
          parent.style.setProperty("overflow", "visible", "important");
          parent.style.setProperty("height", "auto", "important");
          parent.style.setProperty("margin", "0", "important");
          parent.style.setProperty("padding", "0", "important");
          child = parent;
        }
        slide.dataset.cloudExportSlide = String(slides.indexOf(slide));
        slide.classList.add("active", "visible", "is-active", "current");
        const display = getComputedStyle(slide).display;
        slide.dataset.cloudExportDisplay =
          display === "none"
            ? css.display === "none"
              ? "block"
              : css.display
            : display;
        for (const [key, value] of Object.entries({
          position: "relative",
          top: "0",
          left: "0",
          display: slide.dataset.cloudExportDisplay,
          opacity: "1",
          visibility: "visible",
          transform: "none",
          margin: "0",
          width: `${w}px`,
          height: `${h}px`,
          "box-sizing": "border-box",
          overflow: "hidden",
        }))
          slide.style.setProperty(key, value, "important");
      }
      return {
        width: Math.round(w),
        height: Math.round(h),
        count: slides.length,
      };
    },
    { selector: SLIDES, width: request.width, height: request.height },
  );
  if (!stage)
    throw new RenderFailure(
      "unsupported_deck_layout",
      "无法识别幻灯片或尺寸超限，请使用标准 slide 容器且不超过 80 页",
    );
  if (request.index !== undefined && request.index >= stage.count)
    throw new RenderFailure("slide_index_out_of_range", "幻灯片索引超出范围");
  await page.setViewportSize({ width: stage.width, height: stage.height });
  return stage;
}
async function showSlide(page: Page, index: number, count: number) {
  if (index >= count)
    throw new RenderFailure("slide_index_out_of_range", "幻灯片索引超出范围");
  await page.evaluate((selected) => {
    for (const slide of document.querySelectorAll<HTMLElement>(
      "[data-cloud-export-slide]",
    )) {
      slide.style.setProperty(
        "display",
        Number(slide.dataset.cloudExportSlide) === selected
          ? (slide.dataset.cloudExportDisplay ?? "block")
          : "none",
        "important",
      );
    }
    window.scrollTo(0, 0);
  }, index);
}
