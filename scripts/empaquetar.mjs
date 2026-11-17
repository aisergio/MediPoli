import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { zipSync } from "fflate";

const dir = ".work/build";
await mkdir(dir, { recursive: true });
for (const [name, entry] of Object.entries({ api: "api", auditoria: "auditoria" })) {
  const outfile = `${dir}/${name}.cjs`;
  await build({
    entryPoints: [`src/backend/${entry}.mjs`], outfile, bundle: true,
    platform: "node", target: "node22", format: "cjs", legalComments: "none"
  });
  const bytes = zipSync({ "index.cjs": await readFile(outfile) }, { level: 6, mtime: new Date("2026-01-01T00:00:00Z") });
  await writeFile(`${dir}/${name}.zip`, bytes);
  console.log(`${name}.zip ${createHash("sha256").update(bytes).digest("hex")}`);
}
