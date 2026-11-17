import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

const database = new DynamoDBClient({ maxAttempts: 2 });

export async function handler(event, context) {
  if (event.httpMethod !== "GET" || event.path !== "/health") {
    return { statusCode: 404, statusDescription: "404 Not Found", body: "", isBase64Encoded: false };
  }
  const { Item } = await database.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: { pk: { S: "LAB#STATUS" } },
    ConsistentRead: true
  }));
  const ok = Item?.value?.S === "medipoli-u2";
  console.log(JSON.stringify({ requestId: context.awsRequestId, operation: "network-read", ok }));
  return {
    statusCode: ok ? 200 : 503,
    statusDescription: ok ? "200 OK" : "503 Service Unavailable",
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify({ ok, prueba: "ALB-Lambda-DynamoDB", requestId: context.awsRequestId }),
    isBase64Encoded: false
  };
}
