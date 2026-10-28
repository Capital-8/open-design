import { posix } from "node:path";
import type { BundledPlugin } from "@open-design/contracts/cloud/legacy-catalog";
import { BizError } from "../errors.js";
import type { BundledCatalog } from "./index.js";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const htmlFile = (value: unknown): value is string =>
  typeof value === "string" && /\.html?$/i.test(value);
const normalized = (path: string) => path.replace(/^\.\//, "");

export async function previewPath(
  catalog: BundledCatalog,
  plugin: BundledPlugin,
  example?: string,
) {
  const od = plugin.manifest.od ?? {};
  const examples = list(object(od.useCase).exampleOutputs).map(object);
  const files = (await catalog.files("plugin", plugin.id)).map((f) => f.path);
  let candidates: unknown[];
  if (example !== undefined) {
    if (!example || /[\\/\u0000-\u001f]|\.\./.test(example))
      throw new BizError("invalid_example", "Invalid example name");
    const match = examples.find(
      (e) =>
        typeof e.path === "string" &&
        [
          posix.basename(e.path),
          posix.basename(e.path, posix.extname(e.path)),
          posix.basename(posix.dirname(e.path)),
          e.title,
        ].includes(example),
    );
    candidates = match
      ? [match.path]
      : [`examples/${example}/index.html`, `examples/${example}.html`];
  } else {
    candidates = [
      object(od.preview).entry,
      ...list(object(od.context).assets),
      ...examples.map((e) => e.path),
      ...[
        "preview/index.html",
        "index.html",
        "examples/index.html",
        "assets/index.html",
        "assets/preview.html",
        "assets/example.html",
        "assets/example-slides.html",
        "assets/template.html",
        "public/index.html",
        "dist/index.html",
      ],
      ...files.filter((p) =>
        [
          ".",
          "assets",
          "public",
          "dist",
          "examples",
          "preview",
          "templates",
        ].includes(posix.dirname(p)),
      ),
    ];
  }
  // Resolve only indexed HTML, never scan directories or accept a URL as a file.
  const found = candidates
    .filter(htmlFile)
    .map(normalized)
    .find((p) => files.includes(p));
  if (!found)
    throw new BizError("preview_unavailable", "此插件没有可用的内置预览");
  return found;
}

function relativePath(
  value: string,
  source: string,
): { path: string; suffix: string } | null {
  // Absolute and external references retain their meaning. The CSP decides
  // which resource types may load; this is not an arbitrary URL proxy.
  if (
    !value ||
    /^[#/?]|^[a-z][a-z0-9+.-]*:/i.test(value) ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return null;
  const split = value.search(/[?#]/);
  const raw = split < 0 ? value : value.slice(0, split);
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const path = posix.normalize(posix.join(posix.dirname(source), decoded));
  if (
    path === "." ||
    path === ".." ||
    path.startsWith("../") ||
    /[\\\u0000-\u001f]/.test(path)
  )
    return null;
  return { path, suffix: split < 0 ? "" : value.slice(split) };
}

export function rewritePreviewResources(
  text: string,
  pluginId: string,
  source: string,
  html: boolean,
  ticket?: string,
  kind: "plugin" | "design-system" = "plugin",
) {
  const url = (raw: string) => {
    const ref = relativePath(raw.trim(), source);
    if (!ref) return raw;
    let suffix = ref.suffix;
    if (ticket) {
      const hashAt = suffix.indexOf("#");
      const hash = hashAt < 0 ? "" : suffix.slice(hashAt);
      const query = hashAt < 0 ? suffix : suffix.slice(0, hashAt);
      suffix = `${query}${query ? "&" : "?"}od_preview_ticket=${encodeURIComponent(ticket)}${hash}`;
    }
    return `/api/${kind === "plugin" ? "plugins" : "design-systems"}/${encodeURIComponent(pluginId)}/asset/${ref.path.split("/").map(encodeURIComponent).join("/")}${suffix}`;
  };
  // The old frontend loads HTML at /preview, which loses the file's directory.
  // Restore resource paths server-side without changing frontend or Chat SSE.
  if (html)
    text = text.replace(
      /(\s(?:src|href|poster)\s*=\s*)(['"])([^'"]+)\2/gi,
      (_match, attr: string, quote: string, value: string) =>
        `${attr}${quote}${url(value)}${quote}`,
    );
  // Also handle nested CSS files and inline CSS image/font references.
  return text
    .replace(
      /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi,
      (_match, quote: string, value: string) =>
        `url(${quote}${url(value)}${quote})`,
    )
    .replace(
      /(@import\s+)(['"])([^'"]+)\2/gi,
      (_match, prefix: string, quote: string, value: string) =>
        `${prefix}${quote}${url(value)}${quote}`,
    );
}

export function iframeShellTarget(html: string, source: string): string | null {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i
    .exec(html)?.[1]
    ?.replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  const target =
    body &&
    /^<iframe\b[^>]*\bsrc\s*=\s*(['"])([^'"]+)\1[^>]*>\s*<\/iframe>$/i.exec(
      body,
    )?.[2];
  return target && htmlFile(target)
    ? (relativePath(target, source)?.path ?? null)
    : null;
}
