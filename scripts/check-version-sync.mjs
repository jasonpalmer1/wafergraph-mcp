#!/usr/bin/env node
// Fail if package.json / server.json / src/version.ts disagree.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const server = JSON.parse(readFileSync(join(root, "server.json"), "utf8")).version;
const versionTs = readFileSync(join(root, "src/version.ts"), "utf8");
const m = versionTs.match(/PACKAGE_VERSION\s*=\s*"([^"]+)"/);
const src = m?.[1];

if (!pkg || !server || !src) {
  console.error("Could not read all version sources", { pkg, server, src });
  process.exit(1);
}
if (pkg !== server || pkg !== src) {
  console.error(`Version mismatch: package.json=${pkg} server.json=${server} src/version.ts=${src}`);
  process.exit(1);
}
console.log(`versions in sync: ${pkg}`);
