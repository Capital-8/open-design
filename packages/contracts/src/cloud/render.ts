import { z } from "zod";

export const renderRequest = z
  .object({
    html: z
      .string()
      .min(1)
      .max(2 * 1024 * 1024),
    format: z.enum(["pdf", "pdf-image", "pptx", "image", "mp4"]),
    deck: z.boolean().default(false),
    editable: z.boolean().default(false),
    index: z.number().int().min(0).max(79).optional(),
    width: z.number().int().min(320).max(4096).optional(),
    height: z.number().int().min(180).max(2304).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.format === "mp4" &&
        (value.deck ||
          value.width !== undefined ||
          value.height !== undefined)) ||
      (value.editable && value.format !== "pptx") ||
      (value.format === "pptx" && !value.deck) ||
      (value.index !== undefined && (value.format !== "image" || !value.deck))
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid export mode" });
    }
  });
export type RenderRequest = z.infer<typeof renderRequest>;
export const exportMime = {
  pdf: "application/pdf",
  "pdf-image": "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  image: "image/png",
  mp4: "video/mp4",
} as const;
