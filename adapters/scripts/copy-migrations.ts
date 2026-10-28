import { cp, mkdir } from "node:fs/promises";
const source = new URL("../src/db/migrations/", import.meta.url);
const target = new URL("../dist/db/migrations/", import.meta.url);
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
