import { unmarshall } from "@aws-sdk/util-dynamodb";
import { createDynamoStore } from "./dynamodb.mjs";

const eventTypes = new Set(["CitaReservada", "CitaCancelada", "CitaReprogramada"]);

export function createAuditConsumer(output) {
  return async function consume(event) {
    const batchItemFailures = [];
    for (const record of event.Records ?? []) {
      const sequence = record.dynamodb?.SequenceNumber;
      try {
        if (!record.dynamodb?.NewImage) continue;
        const item = unmarshall(record.dynamodb.NewImage);
        if (item.entity !== "APPOINTMENT" || !eventTypes.has(item.eventType)) continue;
        const id = `${item.id}#${item.revision}`;
        if (!item.id || !Number.isInteger(item.revision) || !item.changedAt || !sequence) throw new Error("Invalid event");
        const persisted = await output.create({
          pk: `EVENT#${id}`, entity: "AUDIT", eventId: id, type: item.eventType,
          appointmentId: item.id, revision: item.revision,
          changedAt: item.changedAt, clinic: item.clinic, service: item.service,
          requestId: item.requestId
        });
        console.log(JSON.stringify({ type: item.eventType, eventId: id, requestId: item.requestId, persisted }));
      } catch {
        if (!sequence) throw new Error("Evento sin secuencia.");
        console.warn(JSON.stringify({ issue: "audit-event-failed", messageId: record.eventID }));
        batchItemFailures.push({ itemIdentifier: sequence });
      }
    }
    return { batchItemFailures };
  };
}

let consumer;
export async function handler(event) {
  consumer ??= createAuditConsumer(createDynamoStore(process.env.AUDIT_TABLE));
  return consumer(event);
}
