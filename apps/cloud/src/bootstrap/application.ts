import { hostname } from "node:os";
import { createPersistentVelaAuthAdapter } from "@open-design/adapters/auth";
import { createPostgresDb } from "@open-design/adapters/db";
import { createCatalogDb } from "@open-design/adapters/db/catalog";
import {
  createAmrRuntimeAdapter,
  createRuntimeAuthorization,
} from "@open-design/adapters/runtime";
import { createCloudFileAdapter } from "@open-design/adapters/file";
import { createHttpRenderAdapter } from "@open-design/adapters/render";
import {
  createAmrProjectClient,
  createAmrResourceClient,
  createAmrWorkspaceClient,
  createAmrBillingClient,
  type AmrApiClientOptions,
} from "@open-design/dependencies/amr";
import { revokeTasks } from "@open-design/biz/runs/recovery";
import {
  createAccountFacade,
  type CloudIdentity,
} from "../facades/account/index.js";
import { createWorkspaceFacade } from "../facades/workspaces/index.js";
import { createProjectFacade } from "../facades/projects/index.js";
import { createRunFacade, type RunFacade } from "../facades/runs/index.js";
import { createDispatchFacade } from "../facades/runs/dispatch.js";
import { createFileFacade } from "../facades/files/index.js";
import { createExportFacade } from "../facades/exports/index.js";
import { RunWorker } from "../jobs/runs/worker.js";
import { createCloudApp } from "../http/app.js";
import { scopeRequest } from "../http/scope.js";
import { projectRoutes } from "../routes/projects.js";
import { runRoutes } from "../routes/runs.js";
import { fileRoutes } from "../routes/files.js";
import { exportRoutes } from "../routes/exports.js";
import { compatibilityRoutes } from "../routes/compatibility.js";
import { resourceRoutes } from "../routes/resources.js";
import { startMain } from "./main.js";
import { listen } from "./listen.js";
import type { MainConfig } from "../config/main.js";
export async function launchMain(config: MainConfig) {
  let worker: RunWorker | undefined, runFacade: RunFacade | undefined;
  let startHttp: () => Promise<() => Promise<void>>;
  const failure = Promise.withResolvers<void>();
  return startMain({
    failure: failure.promise,
    modules: [
      {
        name: "cloud-http-and-runs",
        required: ["db", "auth", "runtime", "file", "render"],
        start: () => startHttp(),
      },
    ],
    async createResources() {
      const catalog = createCatalogDb({
        file: config.catalogFile,
        manifest: config.manifest,
        officialMeta: config.officialMeta,
      });
      const database = createPostgresDb({
        connectionString: config.databaseUrl,
        catalog: catalog.adapter,
      });
      try {
        const auth = createPersistentVelaAuthAdapter({
          database: database.adapter,
          environment: config.environment,
          keyring: config.keyring,
          apiUrl: config.velaApiUrl,
          webUrl: config.velaWebUrl,
          profile: config.profile,
          clientVersion: "cloud-poc",
          host: hostname(),
        });
        const authorize = createRuntimeAuthorization({
          apiUrl: config.velaApiUrl,
          credentials: auth.credentials,
          fetch,
          now: Date.now,
        });
        const runtime = createAmrRuntimeAdapter({
          url: config.amrUrl,
          authorizationApiUrl: config.velaApiUrl,
          credentials: auth.credentials,
          supportsRecovery: config.supportsRecovery,
        });
        const file = createCloudFileAdapter({
            amrUrl: config.amrUrl,
            authorize,
            resourceRoot: config.resourceRoot,
          }),
          render = createHttpRenderAdapter({ url: config.rendererUrl });
        const account = createAccountFacade(config.environment, {
          async revoked(principal, ref) {
            await revokeTasks(principal, ref);
            worker?.closeCredential(ref);
          },
          async loggedIn(context) {
            await runFacade?.resumeEligible(context);
          },
        });
        const apiOptions: AmrApiClientOptions<CloudIdentity> = {
          apiUrl: config.velaApiUrl,
          authorize: async (identity) =>
            (
              await auth.credentials.resolve(
                identity.credentialRef,
                identity.principalId,
              )
            ).controlKey,
        };
        const workspaces = createWorkspaceFacade(
            account,
            {
              workspaces: createAmrWorkspaceClient(apiOptions),
              billing: createAmrBillingClient(apiOptions),
            },
            {
              webUrl: config.velaWebUrl,
              modelId: config.modelId,
            },
          ),
          amrProjects = createAmrProjectClient({ runtimeUrl: config.amrUrl }),
          amrResources = createAmrResourceClient({ runtimeUrl: config.amrUrl });
        const projects = createProjectFacade(
          workspaces,
          {
            createProject: (scope, name) =>
              amrProjects.createProject(
                (refresh) => authorize(scope, refresh),
                name,
              ),
            createSession: (scope, id) =>
              amrProjects.createSession(
                (refresh) => authorize(scope, refresh),
                id,
              ),
            officialResources: (scope) =>
              amrResources.officialResources((refresh) =>
                authorize(scope, refresh),
              ),
          },
          config.runtimeId,
        );
        const runs = createRunFacade(projects, workspaces);
        runFacade = runs;
        const files = createFileFacade(),
          exports = createExportFacade(files);
        worker = new RunWorker(
          createDispatchFacade(config.environment),
          (lost) => database.acquireWorker(lost),
          (record) => process.stderr.write(JSON.stringify(record) + "\n"),
          failure.resolve,
        );
        const httpApp = createCloudApp({
          webUrl: config.webUrl,
          secureCookies: config.secureCookies,
          profile: config.profile,
          velaWebUrl: config.velaWebUrl,
          modelId: config.modelId,
          account,
          workspaces,
          async checkReadiness() {
            await database.checkReadiness();
            if (!worker?.healthy) throw new Error("worker_unavailable");
          },
        });
        const { app, http } = httpApp;
        projectRoutes(app, projects, http);
        runRoutes(app, runs, projects, http);
        const authorizeProject = async (
          req: import("express").Request,
          res: import("express").Response,
          id: string,
        ) =>
          projects.project(await http.context(req, res), id, {
            ...scopeRequest(req),
            write: !["GET", "HEAD"].includes(req.method),
          });
        fileRoutes(app, { files, authorize: authorizeProject });
        exportRoutes(app, exports, authorizeProject);
        resourceRoutes(app, async (req, res) =>
          account.current(await http.context(req, res)),
        );
        compatibilityRoutes(app, { account, runs, http });
        httpApp.finish();
        startHttp = async () => {
          await worker!.start();
          try {
            const listener = await listen(app, config.host, config.port);
            return async () => {
              worker!.quiesce();
              try {
                await listener.close();
              } finally {
                await worker!.stop();
              }
            };
          } catch (error) {
            await worker!.stop();
            throw error;
          }
        };
        return {
          bindings: {
            db: database.adapter,
            auth: auth.adapter,
            runtime,
            file,
            render,
          },
          async checkSupport() {
            const caps = await runtime.getCapabilities();
            if (
              !caps.submit ||
              !caps.query ||
              !caps.cancel ||
              !caps.snapshot ||
              !caps.events
            )
              throw new Error("runtime_features_unavailable");
          },
          async checkReadiness() {
            await database.checkReadiness();
          },
          async close() {
            await database.close();
            catalog.close();
          },
        };
      } catch (error) {
        await database.close();
        catalog.close();
        throw error;
      }
    },
  });
}
