import type { Request } from "express";
import { BizError } from "@open-design/biz/errors";
export function jsonBody(req: Request): Record<string, unknown> {
  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body ?? {});
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body;
  } catch {
    throw new BizError("invalid_input");
  }
}
export function parameter(value: unknown): string {
  if (typeof value !== "string" || !value) throw new BizError("invalid_input");
  return value;
}
