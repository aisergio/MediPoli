import { randomBytes } from "node:crypto";
import { aws, assertAccount } from "./aws-cli.mjs";

const id = process.env.AWS_EXPECTED_ACCOUNT;
if (process.env.MEDIPOLI_ENV !== "dev" || !process.argv.includes("--ensayar")) {
  throw new Error("La restauración crea una tabla temporal únicamente con MEDIPOLI_ENV=dev y --ensayar.");
}
assertAccount(id);
const source = "medipoli-dev-agenda";
const target = `medipoli-dev-restauracion-${randomBytes(5).toString("hex")}`;
const started = Date.now();
const pitr = aws(["dynamodb", "describe-continuous-backups", "--table-name", source])
  .ContinuousBackupsDescription.PointInTimeRecoveryDescription;
if (pitr.PointInTimeRecoveryStatus !== "ENABLED") throw new Error("PITR no está habilitado en dev.");
let created = false;
try {
  const restorePoint = new Date(pitr.LatestRestorableDateTime).toISOString();
  aws(["dynamodb", "restore-table-to-point-in-time", "--source-table-name", source,
    "--target-table-name", target, "--restore-date-time", restorePoint]);
  created = true;
  aws(["dynamodb", "wait", "table-exists", "--table-name", target], { json: false });
  const restored = aws(["dynamodb", "describe-table", "--table-name", target]).Table;
  if (restored.TableStatus !== "ACTIVE") throw new Error("La tabla restaurada aún no está activa.");
  const sample = aws(["dynamodb", "scan", "--table-name", target, "--select", "COUNT", "--limit", "100", "--consistent-read"]);
  console.log(JSON.stringify({
    ok: true, stage: "dev", elementsChecked: sample.Count,
    recoveredToUtc: restorePoint, elapsedSeconds: Math.round((Date.now() - started) / 1000),
    apparentRecoveryGapSeconds: Math.round((started - new Date(restorePoint).getTime()) / 1000)
  }));
} finally {
  if (created) {
    aws(["dynamodb", "delete-table", "--table-name", target]);
    aws(["dynamodb", "wait", "table-not-exists", "--table-name", target], { json: false });
    console.log("Tabla temporal retirada.");
  }
}
