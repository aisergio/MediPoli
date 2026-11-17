import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand, TransactWriteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { StoreConflict } from "./agenda.mjs";

const indexes = { patient: "por-paciente", professional: "por-profesional", availability: "por-disponibilidad" };

function compileCondition(condition) {
  if (condition.absent) return { ConditionExpression: "attribute_not_exists(pk)" };
  if (condition.absentOrExpired !== undefined) {
    return {
      ConditionExpression: "attribute_not_exists(pk) OR startsEpoch <= :now",
      ExpressionAttributeValues: { ":now": condition.absentOrExpired }
    };
  }
  const pairs = Object.entries(condition.equal);
  return {
    ConditionExpression: pairs.map((_, i) => `#name${i} = :value${i}`).join(" AND "),
    ExpressionAttributeNames: Object.fromEntries(pairs.map(([key], i) => [`#name${i}`, key])),
    ExpressionAttributeValues: Object.fromEntries(pairs.map(([, value], i) => [`:value${i}`, value]))
  };
}

export function createDynamoStore(tableName, sdk = new DynamoDBClient({ maxAttempts: 3 })) {
  const client = DynamoDBDocumentClient.from(sdk, { marshallOptions: { removeUndefinedValues: true } });
  const TableName = tableName;
  async function paginate(Command, options) {
    const all = [];
    let next;
    do {
      const result = await client.send(new Command({ TableName, ...options, ExclusiveStartKey: next }));
      all.push(...(result.Items ?? []));
      next = result.LastEvaluatedKey;
    } while (next);
    return all;
  }
  return {
    async get(pk) {
      const { Item } = await client.send(new GetCommand({ TableName, Key: { pk }, ConsistentRead: true }));
      return Item;
    },
    async query(field, value, after) {
      if (!value || !indexes[field]) return [];
      return paginate(QueryCommand, {
        IndexName: indexes[field],
        KeyConditionExpression: after ? "#key = :key AND starts > :after" : "#key = :key",
        ExpressionAttributeNames: { "#key": field },
        ExpressionAttributeValues: after ? { ":key": value, ":after": after } : { ":key": value }
      });
    },
    async listAppointments() {
      return paginate(ScanCommand, {
        FilterExpression: "entity = :kind",
        ExpressionAttributeValues: { ":kind": "APPOINTMENT" }
      });
    },
    async atomic(actions) {
      const TransactItems = actions.map(({ item, deleteKey, condition }) => item
        ? { Put: { TableName, Item: item, ...compileCondition(condition) } }
        : { Delete: { TableName, Key: { pk: deleteKey }, ...compileCondition(condition) } });
      try {
        await client.send(new TransactWriteCommand({ TransactItems }));
      } catch (error) {
        if (error.name === "TransactionCanceledException" && error.CancellationReasons?.some(reason =>
          ["ConditionalCheckFailed", "TransactionConflict"].includes(reason.Code))) {
          throw new StoreConflict("La transacción compitió por un recurso.");
        }
        throw error;
      }
    },
    async create(item) {
      try {
        await client.send(new PutCommand({ TableName, Item: item, ConditionExpression: "attribute_not_exists(pk)" }));
        return true;
      } catch (error) {
        if (error.name === "ConditionalCheckFailedException") return false;
        throw error;
      }
    }
  };
}
