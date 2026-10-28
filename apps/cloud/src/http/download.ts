export function downloadDisposition(title: string, extension: string) {
  const name =
    title
      .replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/g, "-")
      .replace(/\.(html?|pdf|pptx|png|zip)$/i, "")
      .trim()
      .slice(0, 100) || "export";
  return `attachment; filename="export.${extension}"; filename*=UTF-8''${encodeURIComponent(`${name}.${extension}`).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
