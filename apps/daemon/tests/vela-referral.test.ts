import type { Express, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerVelaReferralRoutes } from "../src/routes/vela-referral.js";

afterEach(() => vi.unstubAllGlobals());
function route(readContext: Parameters<typeof registerVelaReferralRoutes>[1]) {
	let handler: ((req: Request, res: Response) => Promise<void>) | undefined;
	const app = {
		get: (_path: string, value: typeof handler) => {
			handler = value;
		},
	} as unknown as Express;
	registerVelaReferralRoutes(app, readContext);
	const response = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() };
	response.status.mockReturnValue(response);
	return {
		response,
		invoke: () => {
			if (!handler) throw new Error("Route missing");
			return handler({} as Request, response as unknown as Response);
		},
	};
}
describe("referral summary read boundary", () => {
	it("requires the current control session before querying the account summary", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const { response, invoke } = route(async () => null);
		await invoke();
		expect(response.status).toHaveBeenCalledWith(401);
		expect(fetch).not.toHaveBeenCalled();
	});
	it("uses the selected environment and bearer identity for the one read endpoint", async () => {
		const summary = { serverTime: new Date().toISOString(), campaignStatus: "active", canShare: false, shareBlockReason: "free", inviteUrl: null, inviterIssuedCount: 0, inviterRewardLimit: 5, inviteeIssuedCount: 0, availableCardCount: 0, invitee: null };
		const fetch = vi.fn().mockResolvedValue(Response.json(summary));
		vi.stubGlobal("fetch", fetch);
		const { response, invoke } = route(async () => ({
			apiUrl: "https://test.example.com",
			controlKey: "test-control-session",
		}));
		await invoke();
		expect(String(fetch.mock.calls[0]?.[0])).toBe(
			"https://test.example.com/api/v1/referrals/me",
		);
		expect(fetch.mock.calls[0]?.[1]).toMatchObject({
			headers: { authorization: "Bearer test-control-session" },
			redirect: "error",
		});
		expect(response.setHeader).toHaveBeenCalledWith(
			"Cache-Control",
			"no-store",
		);
		expect(response.json).toHaveBeenCalledWith(summary);
	});
	it("reports unavailable without inventing eligibility or returning private transport errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("private transport detail")),
		);
		const { response, invoke } = route(async () => ({
			apiUrl: "https://test.example.com",
			controlKey: "test-control-session",
		}));
		await invoke();
		expect(response.status).toHaveBeenCalledWith(502);
		expect(response.json).toHaveBeenCalledWith({
			error: "referral_summary_unavailable",
		});
	});
});


it('rejects incomplete upstream data instead of inventing an active entry', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ campaignStatus: 'active' })));
 const { response, invoke } = route(async () => ({ apiUrl: 'http://localhost:18080', controlKey: 'current' }));
 await invoke();
 expect(response.status).toHaveBeenCalledWith(502);
});
it('rejects the response when the active account changes during the read', async () => {
 const summary = { serverTime: new Date().toISOString(), campaignStatus: 'active', canShare: false, shareBlockReason: 'free', inviteUrl: null, inviterIssuedCount: 0, inviterRewardLimit: 5, inviteeIssuedCount: 0, availableCardCount: 0, invitee: null };
 let current = 'first';
 vi.stubGlobal('fetch', vi.fn(async () => { current = 'second'; return Response.json(summary); }));
 const { response, invoke } = route(async () => ({ apiUrl: 'http://localhost:18080', controlKey: current }));
 await invoke();
 expect(response.status).toHaveBeenCalledWith(409);
 expect(response.json).toHaveBeenCalledWith({ error: 'referral_identity_changed' });
 expect(response.json).not.toHaveBeenCalledWith(summary);
});
