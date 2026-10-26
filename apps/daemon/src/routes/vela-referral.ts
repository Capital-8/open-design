import type { Express } from "express";
import type { ReferralSummary } from "@open-design/contracts";

export function registerVelaReferralRoutes(
	app: Express,
	readContext: () => Promise<{ apiUrl: string; controlKey?: string } | null>,
) {
	app.get("/api/integrations/vela/referral-summary", async (_req, res) => {
		res.setHeader("Cache-Control", "no-store");
		try {
			const context = await readContext();
			if (!context?.controlKey) {
				res.status(401).json({ error: "vela_control_key_required" });
				return;
			}
			const response = await fetch(
				new URL("/api/v1/referrals/me", context.apiUrl),
				{
					headers: {
						authorization: `Bearer ${context.controlKey}`,
						accept: "application/json",
					},
					signal: AbortSignal.timeout(10_000),
					redirect: "error",
				},
			);
			if (!response.ok) {
				res
					.status(response.status)
					.json({ error: "referral_summary_unavailable" });
				return;
			}
			const summary = (await response.json()) as ReferralSummary;
			res.json(summary);
		} catch {
			res.status(502).json({ error: "referral_summary_unavailable" });
		}
	});
}
