import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const helm = process.env.HELM_BIN ?? "helm";
const installed = spawnSync(helm, ["version", "--short"]).status === 0;
const chart = join(root, "deploy/cloud/chart");
const values = join(root, "deploy/cloud/fixtures/review-values.yaml");
const yaml = createRequire(join(root, "apps/cloud/package.json"))(
  "js-yaml",
) as {
  loadAll(text: string): Record<string, any>[];
};
function render(...extra: string[]) {
  return yaml
    .loadAll(
      execFileSync(
        helm,
        [
          "template",
          "cloud-fixture",
          chart,
          "--namespace",
          "od-amr-4114",
          "-f",
          values,
          ...extra,
        ],
        { encoding: "utf8" },
      ),
    )
    .filter(Boolean);
}
// Helm template is client-only. No kubeconfig, discovery, apply or cluster access.
describe.skipIf(!installed)(
  "[P1] cloud Kubernetes workload contract (requires Helm)",
  () => {
    it("renders single-worker supervision and secret-free isolated renderer without managing the database", () => {
      const docs = render();
      expect(docs.filter((d) => d.kind === "Deployment")).toHaveLength(2);
      expect(
        docs.some((d) =>
          [
            "Job",
            "Secret",
            "StatefulSet",
            "PersistentVolumeClaim",
            "Ingress",
          ].includes(d.kind),
        ),
      ).toBe(false);
      const main = docs.find(
        (d) =>
          d.kind === "Deployment" && d.metadata.name === "open-design-cloud",
      )!;
      const renderer = docs.find(
        (d) =>
          d.kind === "Deployment" &&
          d.metadata.name === "open-design-cloud-renderer",
      )!;
      for (const deployment of [main, renderer]) {
        expect(deployment.spec.replicas).toBe(1);
        expect(deployment.spec.strategy.type).toBe("Recreate");
        const pod = deployment.spec.template.spec;
        expect(pod.restartPolicy).toBe("Always");
        expect(pod.terminationGracePeriodSeconds).toBeGreaterThan(60);
        expect(pod.automountServiceAccountToken).toBe(false);
        expect(pod.containers[0].image).toMatch(/@sha256:[a-f0-9]{64}$/);
        expect(pod.containers[0].startupProbe.httpGet.path).toBe("/ready");
        expect(pod.containers[0].readinessProbe.httpGet.path).toBe("/ready");
        expect(pod.containers[0].securityContext.readOnlyRootFilesystem).toBe(
          true,
        );
      }
      const api = main.spec.template.spec.containers[0];
      expect(api.command).toEqual(["node", "dist/server.js"]);
      expect(api.livenessProbe.httpGet.path).toBe("/health");
      expect(api.env.map((v: { name: string }) => v.name).sort()).toEqual(
        [
          "OD_CLOUD_CREDENTIAL_KEYS",
          "OD_CLOUD_CREDENTIAL_KEY_ID",
          "OD_CLOUD_DATABASE_URL",
        ].sort(),
      );
      expect(
        api.volumeMounts.find((m: { name: string }) => m.name === "resources")
          .readOnly,
      ).toBe(true);
      const engine = renderer.spec.template.spec.containers[0];
      expect(engine.command).toEqual(["node", "dist/renderer-server.js"]);
      expect(engine.livenessProbe.httpGet.path).toBe("/ready");
      expect(engine.envFrom).toBeUndefined();
      expect(
        engine.env.every((e: { valueFrom?: unknown }) => !e.valueFrom),
      ).toBe(true);
      expect(
        engine.env.map((e: { name: string }) => e.name).join(),
      ).not.toMatch(/DATABASE|CREDENTIAL|AMR|VELA/);
      const policy = docs.find(
        (d) =>
          d.kind === "NetworkPolicy" &&
          d.metadata.name === "open-design-cloud-renderer",
      )!;
      expect(policy.spec.egress).toEqual([]);
      expect(policy.spec.ingress).toHaveLength(1);
      expect(policy.spec.ingress[0].from).toEqual([
        {
          podSelector: {
            matchLabels: {
              "app.kubernetes.io/name": "open-design-cloud",
              "app.kubernetes.io/instance": "cloud-fixture",
            },
          },
        },
      ]);
      const database = docs.find(
        (d) =>
          d.kind === "NetworkPolicy" &&
          d.metadata.name === "open-design-cloud-postgres-access",
      )!;
      expect(database.spec.podSelector.matchLabels).toEqual({
        "app.kubernetes.io/name": "open-design-cloud-poc-postgres",
      });
      expect(database.spec.ingress[0].ports).toEqual([
        { protocol: "TCP", port: 5432 },
      ]);
      expect(
        database.spec.ingress[0].from[0].podSelector.matchExpressions[0].values,
      ).toEqual(["open-design-cloud", "open-design-cloud-migrate"]);
      const config = docs.find((d) => d.kind === "ConfigMap")!;
      expect(config.data.OD_CLOUD_RENDERER_URL).toBe(
        "http://open-design-cloud-renderer.od-amr-4114.svc:19001",
      );
      expect(config.data.OD_CLOUD_RENDERER_ALLOW_PRIVATE_HTTP).toBe("true");
    });
    it("only renders migration and public API ingress when explicitly requested", () => {
      const docs = render(
        "--set",
        "migration.enabled=true,migration.runId=fixture,ingress.enabled=true",
      );
      const job = docs.find((d) => d.kind === "Job")!;
      expect(job.spec.backoffLimit).toBe(0);
      expect(job.metadata.annotations?.["helm.sh/hook"]).toBeUndefined();
      expect(job.spec.template.spec.restartPolicy).toBe("Never");
      expect(job.spec.template.spec.containers[0].env).toEqual([
        {
          name: "OD_CLOUD_DATABASE_URL",
          valueFrom: {
            secretKeyRef: {
              name: "fixture-migration",
              key: "OD_CLOUD_DATABASE_URL",
            },
          },
        },
      ]);
      expect(job.spec.template.spec.containers[0].command).toEqual([
        "node",
        "dist/scripts/migrate.js",
      ]);
      const ingress = docs.find((d) => d.kind === "Ingress")!;
      expect(
        ingress.metadata.annotations[
          "nginx.ingress.kubernetes.io/proxy-buffering"
        ],
      ).toBe("off");
      expect(
        ingress.spec.rules[0].http.paths.every(
          (p: any) => p.backend.service.name === "open-design-cloud",
        ),
      ).toBe(true);
    });
    it("does not manage database networking for an external database", () => {
      expect(
        render("--set", "postgresAccess.enabled=false").filter(
          (d) => d.kind === "NetworkPolicy",
        ),
      ).toHaveLength(1);
    });
    it.each([
      ["--namespace", "default"],
      ["--set", "target=other"],
      ["--set", "image.digest="],
      ["--set", "renderer.image.digest=latest"],
      ["--set", "secrets.application="],
      ["--set", "resources.existingClaim="],
      ["--set", "resources.revision="],
      ["--set", "migration.enabled=true"],
    ])(
      "rejects incomplete or misdirected deployment values %s %s",
      (flag, value) => {
        const result = spawnSync(
          helm,
          [
            "template",
            "cloud-fixture",
            chart,
            "--namespace",
            "od-amr-4114",
            "-f",
            values,
            flag,
            value,
          ],
          { encoding: "utf8" },
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Error:");
      },
    );
  },
);
