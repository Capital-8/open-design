import { promisify } from "node:util";
import { expect, it } from "vitest";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { database } from "../../lib/vitest/cloud-postgres.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const chrome =
  process.env.OD_CLOUD_CHROMIUM_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
async function port() {
  const s = createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}
async function until<T>(read: () => Promise<T>, check: (value: T) => boolean) {
  for (let i = 0; i < 150; i++) {
    const value = await read();
    if (check(value)) return value;
    await delay(100);
  }
  throw Error("Expected state was not reached");
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode) return;
  const end = once(child, "exit");
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
  await end;
  clearTimeout(timeout);
}
it.skipIf(!existsSync(chrome))(
  "[P1] lock loss exits main, preserves renderer, and restores cookie/task without duplicate submission",
  async () => {
    const d = await database(),
      directory = await mkdtemp(join(tmpdir(), "od-cloud-process-"));
    const children: ChildProcess[] = [];
    let logs = "";
    let cleanupTools: (() => Promise<unknown>) | undefined;
    let remote:
        | {
            id: string;
            project: string;
            session: string;
            key: string;
            status: string;
            answer: string;
            detail: string;
            created: string;
          }
        | undefined,
      submitCount = 0,
      complete = false;
    const membership = {
      workspaceId: "w",
      workspaceName: "Personal",
      workspaceType: "personal",
      workspaceMemberId: "m",
      role: "owner",
      memberStatus: "active",
      lifecycleState: "active",
    };
    const upstream = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString(),
        body = text ? JSON.parse(text) : {};
      const url = new URL(req.url!, "http://localhost");
      const send = (value: unknown, status = 200) => {
        res
          .writeHead(status, { "Content-Type": "application/json" })
          .end(JSON.stringify(value));
      };
      if (url.pathname === "/api/v1/me")
        return send({
          id: "actor",
          authUserId: "u",
          email: "u@example.test",
          name: "User",
          image: null,
          status: "active",
        });
      if (url.pathname.endsWith("/token"))
        return send({ status: "approved", controlKey: "private-control-key" });
      if (url.pathname === "/api/v1/cli/device-authorizations")
        return send({
          deviceId: "device",
          deviceSecret: "private-device-secret",
          userCode: "CODE",
          activationUrl:
            "https://login.test/cli/activate?deviceId=device&userCode=CODE",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          pollIntervalSeconds: 1,
        });
      if (url.pathname === "/api/v1/workspaces")
        return send({ items: [membership] });
      if (url.pathname === "/api/v1/workspaces/current")
        return send({
          ...membership,
          userId: "u",
          providerMode: "platform_credits",
          permissions: {
            canManageMembers: false,
            canManageBilling: true,
            canInviteMembers: false,
            canManageAutoRecharge: true,
            canShareProjects: false,
            canWriteSyncedFiles: true,
            canViewWorkspaceSettings: true,
            canManageSharedResources: false,
          },
        });
      if (url.pathname.endsWith("/billing/snapshot")) return send({}, 404);
      if (url.pathname.endsWith("/wallet/balance"))
        return send({
          workspaceId: "w",
          workspaceMemberId: "m",
          billingScopeVersion: 2,
          balanceUsd: "10",
          expiresAt: null,
          updatedAt: null,
        });
      if (url.pathname.endsWith("/billing/preflight"))
        return send({
          schemaVersion: 1,
          workspaceId: "w",
          workspaceMemberId: "m",
          modelId: null,
          generatedAt: new Date().toISOString(),
          balanceUsd: "10",
          funding: "wallet",
          modelCovered: null,
          codingPlan: {
            workspaceId: "w",
            generatedAt: new Date().toISOString(),
            eligible: false,
            tier: null,
            windows: [],
          },
        });
      if (url.pathname === "/api/v1/harness/authorizations")
        return send({
          actor: "actor",
          workspace: "w",
          token: "od_grant_test",
          expires: new Date(Date.now() + 3600000).toISOString(),
        });
      if (url.pathname === "/v1/me") return send({});
      if (url.pathname === "/v1/projects" && req.method === "POST")
        return send({ id: "p" });
      if (url.pathname === "/v1/projects/p/sessions" && req.method === "POST")
        return send({ id: "s", project: "p" });
      if (
        url.pathname === "/v1/projects/p/sessions/s/runs" &&
        req.method === "POST"
      ) {
        submitCount++;
        remote = {
          id: "r",
          project: "p",
          session: "s",
          key: body.key,
          status: "running",
          answer: "",
          detail: "",
          created: new Date().toISOString(),
        };
        return send(remote);
      }
      if (url.pathname === "/v1/projects/p/sessions/s/runs/r") {
        if (complete)
          remote = { ...remote!, status: "succeeded", answer: "done" };
        return send(remote);
      }
      if (url.pathname === "/v1/projects/p/sessions/s") {
        if (complete)
          remote = { ...remote!, status: "succeeded", answer: "done" };
        return send({
          session: { id: "s", project: "p" },
          cursor: complete ? 2 : 0,
          runs: remote ? [remote] : [],
          messages: complete
            ? [
                { sequence: 1, run: "r", role: "user", text: "hello" },
                { sequence: 2, run: "r", role: "assistant", text: "done" },
              ]
            : [],
        });
      }
      if (url.pathname.endsWith("/stream")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end();
        return;
      }
      if (url.pathname === "/v1/projects/p/files/index.html")
        return send({
          path: "index.html",
          html: '<html><body><div class="slide" style="width:960px;height:540px">Cloud export</div></body></html>',
          version: "v1",
        });
      if (url.pathname === "/v1/projects/p/directory")
        return send({
          cursor: "",
          files: [{ path: "index.html", kind: "file", size: 100 }],
        });
      return send({ code: "fixture_missing", path: url.pathname }, 404);
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    try {
      await mkdir(join(directory, "resources"));
      const manifest = JSON.stringify({
        version: 1,
        source: { commit: "a".repeat(40) },
        files: [],
      });
      await writeFile(join(directory, "resources", "manifest.json"), manifest);
      await writeFile(
        join(directory, "official-resource-meta.json"),
        JSON.stringify({
          schemaVersion: 1,
          sourceCommit: "a".repeat(40),
          resources: [],
        }),
      );
      await promisify(execFile)(process.execPath, [
        "--input-type=module",
        "--eval",
        `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA user_version=2;CREATE TABLE catalog_meta(manifest_sha256 TEXT);CREATE TABLE installed_plugins(id TEXT,record_json TEXT);CREATE TABLE skills(id TEXT,summary_json TEXT,root TEXT,body TEXT);CREATE TABLE design_systems(id TEXT,summary_json TEXT,manifest_json TEXT);CREATE TABLE assets(kind TEXT,owner_id TEXT,path TEXT,resource_path TEXT,sha256 TEXT,size INTEGER)');db.prepare('INSERT INTO catalog_meta VALUES (?)').run(process.argv[2]);db.close();`,
        join(directory, "catalog.sqlite"),
        createHash("sha256").update(manifest).digest("hex"),
      ]);
      const apiPort = await port(),
        rendererPort = await port(),
        upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`,
        origin = `http://127.0.0.1:${apiPort}`;
      const env = {
        ...process.env,
        OD_CLOUD_PORT: String(apiPort),
        OD_CLOUD_PROFILE: "test",
        OD_CLOUD_DATABASE_URL: d.connectionString,
        OD_CLOUD_CREDENTIAL_KEYS: JSON.stringify({
          v1: randomBytes(32).toString("base64"),
        }),
        OD_CLOUD_CREDENTIAL_KEY_ID: "v1",
        OD_CLOUD_RESOURCE_DIR: directory,
        OD_CLOUD_WEB_URL: origin,
        OD_CLOUD_VELA_API_URL: upstreamUrl,
        OD_CLOUD_VELA_WEB_URL: "https://login.test",
        OD_CLOUD_AMR_URL: upstreamUrl,
        OD_CLOUD_RENDERER_URL: `http://127.0.0.1:${rendererPort}`,
      };
      const launch = (entry: string, variables: NodeJS.ProcessEnv) => {
        const child = spawn(
          process.execPath,
          [join(root, "apps/cloud/dist", entry)],
          { env: variables, stdio: ["ignore", "ignore", "pipe"] },
        );
        child.stderr!.on("data", (data) => {
          logs += data;
        });
        children.push(child);
        return child;
      };
      const ffmpeg = createRequire(join(root, "adapters/package.json"))(
        "@ffmpeg-installer/ffmpeg",
      ).path as string;
      const renderer = launch("renderer-server.js", {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        OD_CLOUD_RENDERER_PORT: String(rendererPort),
        OD_CLOUD_CHROMIUM_PATH: chrome,
        OD_CLOUD_FFMPEG_PATH: ffmpeg,
      });
      await until(
        () =>
          fetch(env.OD_CLOUD_RENDERER_URL + "/ready")
            .then((r) => r.ok)
            .catch(() => false),
        Boolean,
      );
      let main = launch("server.js", env);
      await until(
        () =>
          fetch(origin + "/ready")
            .then((r) => r.ok)
            .catch(() => false),
        Boolean,
      );
      const jar = new Map<string, string>();
      async function request(
        path: string,
        body?: unknown,
        method = body === undefined ? "GET" : "POST",
      ) {
        const response = await fetch(origin + path, {
          method,
          headers: {
            Origin: origin,
            Cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        for (const item of response.headers.getSetCookie()) {
          const [name, value] = item.split(";")[0]!.split("=");
          jar.set(name!, value!);
        }
        return response;
      }
      const start = await request("/api/auth/vela/start", {});
      expect(start.status).toBe(200);
      expect(JSON.stringify(await start.json())).not.toContain("private-");
      await delay(1100);
      expect(
        await (await request("/api/auth/vela/poll", {})).json(),
      ).toMatchObject({ status: "approved" });
      const pid = randomUUID();
      const create = await request("/api/projects", { id: pid, name: "Cloud" });
      expect(create.status, await create.clone().text()).toBe(201);
      const project = (await create.json()) as { conversationId: string };
      const submit = await request(
        "/api/conversations/" + project.conversationId + "/runs",
        { clientRequestId: "request-1", input: "hello" },
      );
      expect(submit.status, await submit.clone().text()).toBe(202);
      const run = (await submit.json()) as { id: string };
      await until(
        () => d.db.read().runs.get(run.id),
        (r) => r?.runtime_run_id === "r",
      );
      expect(submitCount).toBe(1);
      const loseWorker = async () => {
        const locks = await d.pool.query(
          "SELECT pid FROM pg_locks WHERE locktype='advisory' AND granted",
        );
        expect(locks.rows).toHaveLength(1);
        await d.pool.query("SELECT pg_terminate_backend($1)", [
          locks.rows[0].pid,
        ]);
      };
      await loseWorker();
      await until(
        async () => main.exitCode,
        (code) => code !== null,
      );
      expect(main.exitCode).toBe(1);
      expect(logs).toContain("worker_ownership_lost");
      expect(renderer.exitCode).toBeNull();
      expect((await fetch(env.OD_CLOUD_RENDERER_URL + "/ready")).ok).toBe(true);
      // Fresh process acquires the lock; auth state and the running task survive.
      main = launch("server.js", env);
      await until(
        () =>
          fetch(origin + "/ready")
            .then((r) => r.ok)
            .catch(() => false),
        Boolean,
      );
      expect((await request("/api/me")).status).toBe(200);
      expect(submitCount).toBe(1);
      await stop(main);
      expect(main.exitCode).toBe(0);
      complete = true;
      main = launch("server.js", env);
      await until(
        () =>
          fetch(origin + "/ready")
            .then((r) => r.ok)
            .catch(() => false),
        Boolean,
      );
      expect((await request("/api/me")).status).toBe(200);
      await until(
        () => d.db.read().runs.get(run.id),
        (r) => r?.status === "succeeded",
      );
      expect(submitCount).toBe(1);
      const snapshot = (await (
        await request("/api/conversations/" + project.conversationId)
      ).json()) as { messages: { content: string }[] };
      expect(snapshot.messages.map((m) => m.content)).toEqual([
        "hello",
        "done",
      ]);
      const replay = await request(
        "/api/conversations/" + project.conversationId + "/runs",
        { clientRequestId: "request-1", input: "hello" },
      );
      expect(((await replay.json()) as { id: string }).id).toBe(run.id);
      expect(submitCount).toBe(1);
      expect((await request("/api/projects/" + pid + "/files")).status).toBe(
        200,
      );
      const pdf = await request("/api/projects/" + pid + "/export/pdf", {
        fileName: "index.html",
      });
      expect(pdf.status, await pdf.clone().text()).toBe(200);
      expect(
        Buffer.from(await pdf.arrayBuffer())
          .subarray(0, 5)
          .toString(),
      ).toBe("%PDF-");
      expect((await request("/api/memory/extractions")).status).toBe(501);
      expect((await request("/api/plugins")).status).toBe(200);
      expect((await request("/api/auth/sign-out", {})).status).toBe(200);
      expect((await request("/api/me")).status).toBe(401);
      const encrypted = await d.pool.query(
        "SELECT ciphertext FROM cloud_credentials",
      );
      expect(JSON.stringify(encrypted.rows) + logs).not.toContain(
        "private-control-key",
      );
      await stop(main);
      await stop(renderer);
      const namespace = "cloud-test-" + randomUUID();
      const lifecycleEnv = {
        ...env,
        OD_CLOUD_RENDERER_PORT: String(rendererPort),
        OD_CLOUD_CHROMIUM_PATH: chrome,
        OD_CLOUD_FFMPEG_PATH: ffmpeg,
      };
      const control = (action: string) =>
        promisify(execFile)(
          process.execPath,
          [
            join(root, "tools/dev/bin/tools-dev.mjs"),
            "cloud",
            action,
            "--namespace",
            namespace,
            "--tools-dev-root",
            join(directory, "lifecycle"),
            "--no-env-file",
            "--json",
          ],
          { cwd: root, env: lifecycleEnv, timeout: 45000 },
        );
      cleanupTools = () => control("stop");
      await control("start");
      const state = JSON.parse((await control("status")).stdout);
      expect(state.cloud.ready).toBe(true);
      expect(state["cloud-renderer"].ready).toBe(true);
      // The tools-dev wrapper must propagate the same fatal lifecycle, without restarting renderer.
      await loseWorker();
      await until(
        async () => JSON.parse((await control("status")).stdout),
        (s) => s.cloud === null,
      );
      expect(
        JSON.parse((await control("status")).stdout)["cloud-renderer"].ready,
      ).toBe(true);
      await control("start");
      expect(JSON.parse((await control("status")).stdout).cloud.ready).toBe(
        true,
      );
      await control("stop");
      cleanupTools = undefined;
    } catch (error) {
      throw new Error(String(error) + "\n" + logs, { cause: error });
    } finally {
      await cleanupTools?.().catch(() => {});
      await Promise.all(children.map(stop));
      upstream.closeAllConnections();
      await new Promise<void>((r) => upstream.close(() => r()));
      await d.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  60000,
);
