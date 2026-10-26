import { it, expect } from "vitest";
import {
	referralNoticeKind,
	referralCountdown,
	type ReferralSummary,
} from "@open-design/contracts";
const now = Date.parse("2026-10-26T00:00:00Z");
const base: ReferralSummary = {
	serverTime: new Date(now).toISOString(),
	campaignStatus: "active",
	canShare: true,
	shareBlockReason: null,
	inviteUrl: "https://example.com/register?ref=a",
	inviterIssuedCount: 0,
	inviteeIssuedCount: 0,
	availableCardCount: 0,
	invitee: null,
};
it("never invents an invitation from unavailable or ended data", () => {
	equal(referralNoticeKind(null, true, now), null);
	equal(
		referralNoticeKind({ ...base, campaignStatus: "ended" }, true, now),
		null,
	);
	equal(
		referralNoticeKind(
			{ ...base, canShare: false, shareBlockReason: "cap_reached" },
			true,
			now,
		),
		null,
	);
});
it("gives qualified first subscription and pending rewards priority over exhaustion", () => {
	equal(
		referralNoticeKind(
			{
				...base,
				invitee: {
					status: "registered",
					purchaseDeadline: new Date(now + 1000).toISOString(),
					dueAt: null,
				},
			},
			true,
			now,
		),
		"registered",
	);
	equal(
		referralNoticeKind(
			{
				...base,
				invitee: { status: "pending", purchaseDeadline: null, dueAt: null },
			},
			true,
			now,
		),
		"pending",
	);
	equal(referralNoticeKind(base, true, now), "exhausted");
});
it("stops the first-subscription notice at the server deadline", () => {
	equal(
		referralNoticeKind(
			{
				...base,
				canShare: false,
				invitee: {
					status: "registered",
					purchaseDeadline: new Date(now).toISOString(),
					dueAt: null,
				},
			},
			false,
			now,
		),
		null,
	);
	equal(
		referralCountdown(
			new Date(now + 47 * 3600000 + 58 * 60000 + 3000).toISOString(),
			now,
		),
		"47:58:03",
	);
	equal(referralCountdown(new Date(now - 1).toISOString(), now), "00:00:00");
});

function equal(actual: unknown, expected: unknown) {
	expect(actual).toBe(expected);
}
