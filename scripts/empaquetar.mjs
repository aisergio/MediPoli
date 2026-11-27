import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { strToU8, zipSync } from "fflate";

const dir = ".work/build";
const revision = process.env.CODEBUILD_RESOLVED_SOURCE_VERSION ?? process.env.GITHUB_SHA;
await mkdir(dir, { recursive: true });
for (const [name, entry] of Object.entries({ api: "api", auditoria: "auditoria" })) {
  const outfile = `${dir}/${name}.cjs`;
  await build({
    entryPoints: [`src/backend/${entry}.mjs`], outfile, bundle: true,
    platform: "node", target: "node22", format: "cjs", legalComments: "none"
  });
  const files = { "index.cjs": await readFile(outfile) };
  if (name === "api" && /^[a-f0-9]{40}$/.test(revision ?? "")) {
    files["revision.json"] = strToU8(JSON.stringify({ revision }));
  }
  const bytes = zipSync(files, { level: 6, mtime: new Date("2026-01-01T00:00:00Z") });
  await writeFile(`${dir}/${name}.zip`, bytes);
  console.log(`${name}.zip ${createHash("sha256").update(bytes).digest("hex")}`);
}
