/** Account-owned projection from GET /api/v1/referrals/me. Unknown data is never eligibility. */
export interface ReferralSummary {
	serverTime: string;
	campaignStatus: "active" | "ended";
	canShare: boolean;
	shareBlockReason: "free" | "cap_reached" | "ended" | "restricted" | null;
	inviteUrl: string | null;
	inviterIssuedCount: number;
	inviteeIssuedCount: number;
	availableCardCount: number;
	invitee: {
		status:
			| "registered"
			| "pending"
			| "issued"
			| "expired"
			| "ineligible"
			| "review";
		purchaseDeadline: string | null;
		dueAt: string | null;
	} | null;
}

export type ReferralNoticeKind = "registered" | "pending" | "exhausted";

export function referralNoticeKind(
	summary: ReferralSummary | null,
	exhausted: boolean,
	now: number,
): ReferralNoticeKind | null {
	if (!summary || summary.campaignStatus !== "active") return null;
	if (
		summary.invitee?.status === "registered" &&
		summary.invitee.purchaseDeadline &&
		Date.parse(summary.invitee.purchaseDeadline) > now
	)
		return "registered";
	if (summary.invitee?.status === "pending") return "pending";
	return exhausted && summary.canShare ? "exhausted" : null;
}

export function referralCountdown(deadline: string, now: number): string {
	const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
	return [
		Math.floor(seconds / 3600),
		Math.floor(seconds / 60) % 60,
		seconds % 60,
	]
		.map((value) => String(value).padStart(2, "0"))
		.join(":");
}
