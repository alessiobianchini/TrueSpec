let TableClient;
let TableServiceClient;
let loadError = null;

try {
  ({ TableClient, TableServiceClient } = require("@azure/data-tables"));
} catch (error) {
  loadError = error;
}

const TABLE_NAME = process.env.WAITLIST_TABLE_NAME || "waitlist";
const TABLE_PARTITION = process.env.WAITLIST_PARTITION || "waitlist";
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

let tableClient = null;
let tableReady = null;

function getStorageConnection() {
  return (
    process.env.WAITLIST_STORAGE_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage ||
    ""
  );
}

function getTableClient() {
  if (loadError) {
    throw loadError;
  }

  if (!TableClient) {
    throw new Error("TableClient is not available.");
  }

  const storageConnection = getStorageConnection();
  if (!storageConnection) {
    throw new Error("Missing storage connection string.");
  }

  if (!tableClient) {
    tableClient = TableClient.fromConnectionString(storageConnection, TABLE_NAME);
  }

  return tableClient;
}

async function ensureTable() {
  if (tableReady) {
    return tableReady;
  }

  tableReady = (async () => {
    if (loadError) {
      throw loadError;
    }

    if (!TableServiceClient) {
      throw new Error("TableServiceClient is not available.");
    }

    const storageConnection = getStorageConnection();
    if (!storageConnection) {
      throw new Error("Missing storage connection string.");
    }

    const serviceClient = TableServiceClient.fromConnectionString(storageConnection);
    try {
      await serviceClient.createTable(TABLE_NAME);
    } catch (error) {
      const status = error?.statusCode;
      if (status !== 409) {
        throw error;
      }
    }
  })();

  return tableReady;
}

function parseEmailFromString(value) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && parsed.email) {
        return parsed.email;
      }
    } catch (error) {
      return null;
    }
  }

  const params = new URLSearchParams(trimmed);
  return params.get("email");
}

function getEmail(req) {
  if (req?.body) {
    if (typeof req.body === "string") {
      const fromString = parseEmailFromString(req.body);
      if (fromString) {
        return fromString;
      }
    } else if (Buffer.isBuffer(req.body)) {
      const fromBuffer = parseEmailFromString(req.body.toString("utf8"));
      if (fromBuffer) {
        return fromBuffer;
      }
    } else if (typeof req.body === "object" && req.body.email) {
      return req.body.email;
    }
  }

  if (req?.query?.email) {
    return req.query.email;
  }

  return null;
}

function getAdminToken(req) {
  const headerToken = req?.headers?.["x-waitlist-token"];
  if (headerToken) {
    return headerToken;
  }

  const authHeader = req?.headers?.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  return null;
}

function normalizePageSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(parsed, MAX_PAGE_SIZE);
}

function getContinuationToken(req) {
  const nextPartitionKey = req?.query?.nextPartitionKey;
  const nextRowKey = req?.query?.nextRowKey;

  if (!nextPartitionKey && !nextRowKey) {
    return undefined;
  }

  return {
    nextPartitionKey,
    nextRowKey,
  };
}

function toOdataString(value) {
  return String(value).replace(/'/g, "''");
}

function isTruthy(value) {
  return /^(1|true|yes)$/i.test(String(value || ""));
}

function parseEntityTime(entity) {
  const createdAt = entity?.createdAt;
  if (createdAt) {
    const parsed = Date.parse(String(createdAt));
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  const timestamp = entity?.timestamp || entity?.Timestamp;
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }

  if (timestamp) {
    const parsed = Date.parse(String(timestamp));
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function formatDateValue(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

module.exports = async function (context, req) {
  const debug = /^(1|true)$/i.test(process.env.WAITLIST_DEBUG || "");

  try {
    const method = (req?.method || "").toUpperCase();
    if (method === "GET") {
      const expectedToken = process.env.WAITLIST_ADMIN_TOKEN || "";
      const providedToken = getAdminToken(req);

      if (!expectedToken) {
        context.res = {
          status: 403,
          body: "Admin token not configured",
        };
        return;
      }

      if (!providedToken || providedToken !== expectedToken) {
        context.res = {
          status: 403,
          body: "Forbidden",
        };
        return;
      }

      await ensureTable();
      const client = getTableClient();
      const filter = `PartitionKey eq '${toOdataString(TABLE_PARTITION)}'`;

      if (isTruthy(req?.query?.summary)) {
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const weekMs = 7 * dayMs;
        const bySource = {};
        const recent = [];

        let total = 0;
        let last24h = 0;
        let last7d = 0;

        const entities = client.listEntities({
          queryOptions: {
            filter,
            select: ["email", "createdAt", "source", "timestamp"],
          },
        });

        for await (const entity of entities) {
          total += 1;
          const source = entity.source || "unknown";
          bySource[source] = (bySource[source] || 0) + 1;

          const time = parseEntityTime(entity);
          if (time) {
            const age = now - time;
            if (age <= dayMs) {
              last24h += 1;
            }
            if (age <= weekMs) {
              last7d += 1;
            }
          }

          recent.push({
            email: entity.email || null,
            createdAt: formatDateValue(entity.createdAt),
            source,
            timestamp: formatDateValue(entity.timestamp || entity.Timestamp),
            _time: time || 0,
          });
        }

        recent.sort((a, b) => (b._time || 0) - (a._time || 0));
        const trimmed = recent.slice(0, 10).map(({ _time, ...rest }) => rest);

        context.res = {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            generatedAt: new Date().toISOString(),
            total,
            last24h,
            last7d,
            bySource,
            recent: trimmed,
          },
        };
        return;
      }

      const pageSize = normalizePageSize(
        req?.query?.limit || req?.query?.top || req?.query?.pageSize
      );
      const continuationToken = getContinuationToken(req);

      const items = [];
      const pages = client.listEntities({
        queryOptions: {
          filter,
          select: [
            "partitionKey",
            "rowKey",
            "email",
            "createdAt",
            "source",
            "timestamp",
          ],
        },
      }).byPage({
        maxPageSize: pageSize,
        continuationToken,
      });

      let nextToken = null;
      for await (const page of pages) {
        for (const entity of page) {
          items.push({
            partitionKey: entity.partitionKey || entity.PartitionKey,
            rowKey: entity.rowKey || entity.RowKey,
            email: entity.email || null,
            createdAt: entity.createdAt || null,
            source: entity.source || null,
            timestamp: entity.timestamp || entity.Timestamp || null,
          });
        }
        nextToken = page.continuationToken || null;
        break;
      }

      context.res = {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
        body: {
          items,
          continuationToken: nextToken,
        },
      };
      return;
    }

    if (method !== "POST") {
      context.res = { status: 405 };
      return;
    }

    const rawEmail = getEmail(req);
    const email = rawEmail ? rawEmail.toString().trim().toLowerCase() : "";

    if (!email || !email.includes("@")) {
      context.res = {
        status: 400,
        body: "Invalid email",
      };
      return;
    }

    await ensureTable();
    const client = getTableClient();
    const rowKey = encodeURIComponent(email);

    try {
    await client.createEntity({
      partitionKey: TABLE_PARTITION,
      rowKey,
      email,
      createdAt: new Date().toISOString(),
      source: "landing",
      });
    } catch (error) {
      const status = error?.statusCode;
      if (status !== 409) {
        throw error;
      }
    }

    context.res = {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
      body: "OK",
    };
  } catch (error) {
    context.log.error("Waitlist request failed", error);
    context.res = {
      status: 500,
      body: debug ? String(error?.message || "Server error") : "Server error",
    };
  }
};
