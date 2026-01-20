let TableClient;
let TableServiceClient;
let loadError = null;

try {
  ({ TableClient, TableServiceClient } = require("@azure/data-tables"));
} catch (error) {
  loadError = error;
}

const TABLE_NAME = process.env.WAITLIST_TABLE_NAME || "waitlist";

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

module.exports = async function (context, req) {
  const debug = /^(1|true)$/i.test(process.env.WAITLIST_DEBUG || "");

  try {
    if (req.method !== "POST") {
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

    await client.createEntity({
      partitionKey: "waitlist",
      rowKey,
      email,
      createdAt: new Date().toISOString(),
      source: "landing",
    });

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
