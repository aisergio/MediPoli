import { execFileSync } from "node:child_process";

export function aws(args, { json = true, print = false } = {}) {
  const executable = process.platform === "win32" ? "aws.exe" : "aws";
  const options = { encoding: "utf8", timeout: 240_000, stdio: ["ignore", "pipe", "pipe"] };
  const suffix = json ? ["--output", "json", "--no-cli-pager"] : ["--no-cli-pager"];
  let output;
  try {
    output = execFileSync(executable, [...args, ...suffix], options).trim();
  } catch (error) {
    const summary = String(error.stderr ?? "").split(/\r?\n/).find(line => line.trim())?.trim() ?? "Error sin detalle de AWS";
    throw new Error(`AWS ${args.slice(0, 2).join(" ")}: ${summary}`);
  }
  if (print && output) console.log(output);
  return json && output ? JSON.parse(output) : output;
}

export function assertAccount(expected) {
  if (!/^[0-9]{12}$/.test(expected ?? "")) throw new Error("Se requiere el ID esperado de MediPoli.");
  if (aws(["sts", "get-caller-identity"]).Account !== expected) throw new Error("La AWS actual no corresponde a MediPoli.");
}
