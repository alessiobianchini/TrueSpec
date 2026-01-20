const { app } = require("@azure/functions");
const { TableClient, TableServiceClient } = require("@azure/data-tables");

const TABLE_NAME = process.env.WAITLIST_TABLE_NAME || "waitlist";
const STORAGE_CONNECTION =
  process.env.WAITLIST_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;

let tableClient = null;
let tableReady = null;

function getTableClient() {
  if (!STORAGE_CONNECTION) {
    throw new Error("Missing storage connection string.");
  }

  if (!tableClient) {
    tableClient = TableClient.fromConnectionString(STORAGE_CONNECTION, TABLE_NAME);
  }

  return tableClient;
}

async function ensureTable() {
  if (tableReady) {
    return tableReady;
  }

  tableReady = (async () => {
    if (!STORAGE_CONNECTION) {
      throw new Error("Missing storage connection string.");
    }

    const serviceClient = TableServiceClient.fromConnectionString(STORAGE_CONNECTION);
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

async function waitlist(request, context) {
  if (request.method !== "POST") {
    return { status: 405 };
  }

  const body = await request.formData();
  const email = body.get("email")?.toString().trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return {
      status: 400,
      body: "Invalid email",
    };
  }

  try {
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
  } catch (error) {
    const status = error?.statusCode;
    if (status !== 409) {
      context.error("Waitlist insert failed", error);
      return {
        status: 500,
        body: "Server error",
      };
    }
  }

  return {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
    },
    body: "OK",
  };
}

app.http("waitlist", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: waitlist,
});
