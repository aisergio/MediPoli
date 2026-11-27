import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("MP-PORTADA-03: el fondo conserva su posición fija con movimiento reducido", async () => {
  const css = await readFile(new URL("../src/styles/portal.css", import.meta.url), "utf8");
  const backdropRules = [...css.matchAll(/\.home-backdrop\s*\{([^}]+)\}/g)];
  const positions = backdropRules
    .map(([, declarations]) => declarations.match(/(?:^|;)\s*position\s*:\s*([\w-]+)/)?.[1])
    .filter(Boolean);

  assert.deepEqual([...new Set(positions)], ["fixed"]);
});
