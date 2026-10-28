import { extname } from "node:path";
export function classification(path: string) {
  const extension = extname(path).toLowerCase();
  switch (extension) {
    case ".html":
    case ".htm":
      return { kind: "html", mime: "text/html" };
    case ".txt":
    case ".md":
      return { kind: "text", mime: "text/plain" };
    case ".css":
      return { kind: "code", mime: "text/css" };
    case ".js":
      return { kind: "code", mime: "text/javascript" };
    case ".json":
      return { kind: "code", mime: "application/json" };
    case ".png":
      return { kind: "image", mime: "image/png" };
    case ".jpg":
    case ".jpeg":
      return { kind: "image", mime: "image/jpeg" };
    case ".svg":
      return { kind: "image", mime: "image/svg+xml" };
    case ".mp4":
      return { kind: "video", mime: "video/mp4" };
    case ".mp3":
      return { kind: "audio", mime: "audio/mpeg" };
    case ".zip":
      return { kind: "binary", mime: "application/zip" };
    default:
      return { kind: "binary", mime: "application/octet-stream" };
  }
}
