let TableClient;
let TableServiceClient;
let loadError = null;

try {
  ({ TableClient, TableServiceClient } = require("@azure/data-tables"));
} catch (error) {
  loadError = error;
}

let yaml = null;
try {
  yaml = require("yaml");
} catch (error) {
  // Optional; we will surface a clear error when needed.
}

const crypto = require("crypto");

const TABLE_NAME = process.env.REPORTS_TABLE_NAME || "reports";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_TEXT_LENGTH = 60000;

let tableClient = null;
let tableReady = null;

function getStorageConnection() {
  return (
    process.env.REPORTS_STORAGE_CONNECTION_STRING ||
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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSpecInput(value) {
  if (!value) {
    return null;
  }

  if (Buffer.isBuffer(value)) {
    return parseSpecInput(value.toString("utf8"));
  }

  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return isRecord(parsed) ? parsed : null;
    } catch (error) {
      // fall through to YAML parse
    }
  }

  if (!yaml) {
    throw new Error("YAML parser not available.");
  }

  const parsed = yaml.parse(trimmed);
  return isRecord(parsed) ? parsed : null;
}

function getBodyObject(req) {
  if (!req?.body) {
    return {};
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return { raw: req.body };
    }
  }

  if (Buffer.isBuffer(req.body)) {
    const text = req.body.toString("utf8");
    try {
      return JSON.parse(text);
    } catch (error) {
      return { raw: text };
    }
  }

  if (isRecord(req.body)) {
    return req.body;
  }

  return {};
}

function getAdminToken(req) {
  const headerToken = req?.headers?.["x-report-token"];
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

function truncateText(value) {
  const text = String(value || "");
  if (text.length <= MAX_TEXT_LENGTH) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, MAX_TEXT_LENGTH - 3)}...`,
    truncated: true,
  };
}

function getEnumValues(schema) {
  if (!schema || typeof schema !== "object") return null;
  if (!Array.isArray(schema.enum)) return null;
  return new Set(schema.enum.map((value) => JSON.stringify(value)));
}

function getRequiredFields(schema) {
  if (!schema || typeof schema !== "object") return new Set();
  if (!Array.isArray(schema.required)) return new Set();
  return new Set(schema.required.map((value) => String(value)));
}

function normalizeTypes(rawType) {
  if (Array.isArray(rawType)) return rawType.map((value) => String(value));
  if (typeof rawType === "string") return [rawType];
  return [];
}

function getTypeInfo(schema) {
  if (!schema || typeof schema !== "object") return { type: null, nullable: false };
  const rawTypes = normalizeTypes(schema.type);
  let nullable = schema.nullable === true;
  if (rawTypes.includes("null")) {
    nullable = true;
  }
  const nonNullTypes = rawTypes.filter((type) => type !== "null");
  if (nonNullTypes.length === 0) {
    return { type: null, nullable };
  }
  return { type: nonNullTypes.sort().join("|"), nullable };
}

function getObjectShape(schema) {
  if (!schema || typeof schema !== "object") return null;
  const properties = {};
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((entry) => {
      if (!isRecord(entry)) return;
      const shape = getObjectShape(entry);
      if (!shape) return;
      Object.assign(properties, shape.properties);
    });
  }

  if (isRecord(schema.properties)) {
    Object.entries(schema.properties).forEach(([key, value]) => {
      if (isRecord(value)) {
        properties[key] = value;
      }
    });
  }

  if (Object.keys(properties).length === 0) {
    return null;
  }

  return { properties };
}

function getSchemaContext(schemaPath) {
  if (schemaPath.startsWith("request.")) return "request";
  if (schemaPath.startsWith("response.")) return "response";
  return "other";
}

function getSchemaAlternatives(schema) {
  const alternatives = [];
  const oneOf = schema?.oneOf;
  const anyOf = schema?.anyOf;
  if (Array.isArray(oneOf)) {
    oneOf.forEach((entry) => {
      if (isRecord(entry)) alternatives.push(entry);
    });
  }
  if (Array.isArray(anyOf)) {
    anyOf.forEach((entry) => {
      if (isRecord(entry)) alternatives.push(entry);
    });
  }
  return alternatives;
}

function getSchemaSignature(schema) {
  if (schema && typeof schema === "object" && typeof schema.$ref === "string") {
    return `ref:${schema.$ref}`;
  }
  const info = getTypeInfo(schema || {});
  const typeValue = info.type || "unknown";
  const format = schema && typeof schema.format === "string" ? schema.format : "";
  const title = schema && typeof schema.title === "string" ? schema.title : "";
  const nullable = info.nullable ? "|nullable" : "";
  const formatPart = format ? `|format:${format}` : "";
  const titlePart = title ? `|title:${title}` : "";
  return `type:${typeValue}${nullable}${formatPart}${titlePart}`;
}

function compareSchema(baseSchema, headSchema, schemaPath, items, ref, visitedBase, visitedHead) {
  if (!baseSchema || !headSchema) return;
  if (visitedBase.has(baseSchema) || visitedHead.has(headSchema)) return;
  visitedBase.add(baseSchema);
  visitedHead.add(headSchema);

  const baseTypeInfo = getTypeInfo(baseSchema);
  const headTypeInfo = getTypeInfo(headSchema);
  const context = getSchemaContext(schemaPath);
  const baseType = baseTypeInfo.type || "";
  const headType = headTypeInfo.type || "";

  if (baseTypeInfo.nullable && !headTypeInfo.nullable) {
    addItem(items, "breaking", "schema-nullable-removed", `Nullable removed at ${schemaPath}`, ref);
  } else if (!baseTypeInfo.nullable && headTypeInfo.nullable) {
    addItem(items, "info", "schema-nullable-added", `Nullable added at ${schemaPath}`, ref);
  }

  if (baseType && headType && baseType !== headType) {
    addItem(
      items,
      "breaking",
      "schema-type-changed",
      `Type changed at ${schemaPath} (${baseType} -> ${headType})`,
      ref
    );
    return;
  }

  const baseAlternatives = getSchemaAlternatives(baseSchema);
  const headAlternatives = getSchemaAlternatives(headSchema);
  if (baseAlternatives.length > 0 || headAlternatives.length > 0) {
    const baseSet = new Set(baseAlternatives.map(getSchemaSignature));
    const headSet = new Set(headAlternatives.map(getSchemaSignature));
    const removed = [...baseSet].filter((value) => !headSet.has(value));
    const added = [...headSet].filter((value) => !baseSet.has(value));
    if (removed.length > 0) {
      addItem(
        items,
        "breaking",
        "schema-union-removed",
        `Removed union variant at ${schemaPath} (${removed.join(", ")})`,
        ref
      );
    }
    if (added.length > 0) {
      const severity = context === "request" ? "info" : "info";
      addItem(
        items,
        severity,
        "schema-union-added",
        `Added union variant at ${schemaPath} (${added.join(", ")})`,
        ref
      );
    }
  }

  const baseEnum = getEnumValues(baseSchema);
  const headEnum = getEnumValues(headSchema);
  if (baseEnum || headEnum) {
    const baseValues = baseEnum ? [...baseEnum].sort() : [];
    const headValues = headEnum ? [...headEnum].sort() : [];
    const removedValues = baseValues.filter((value) => !headEnum?.has(value));
    const addedValues = headValues.filter((value) => !baseEnum?.has(value));
    if (removedValues.length > 0 || addedValues.length > 0) {
      const details = [];
      if (removedValues.length > 0) {
        details.push(`removed: ${removedValues.join(", ")}`);
      }
      if (addedValues.length > 0) {
        details.push(`added: ${addedValues.join(", ")}`);
      }
      const suffix = details.length > 0 ? ` (${details.join("; ")})` : "";
      addItem(
        items,
        "breaking",
        "schema-enum-changed",
        `Enum changed at ${schemaPath}${suffix}`,
        ref
      );
    }
  }

  const baseItems = isRecord(baseSchema.items) ? baseSchema.items : null;
  const headItems = isRecord(headSchema.items) ? headSchema.items : null;
  if (baseType === "array" || headType === "array" || baseItems || headItems) {
    if (baseItems && headItems) {
      compareSchema(baseItems, headItems, `${schemaPath}[]`, items, ref, visitedBase, visitedHead);
    }
  }

  const baseShape = getObjectShape(baseSchema);
  const headShape = getObjectShape(headSchema);
  if (baseShape && headShape) {
    const baseRequired = getRequiredFields(baseSchema);
    const headRequired = getRequiredFields(headSchema);
    headRequired.forEach((key) => {
      if (baseRequired.has(key)) return;
      const severity = context === "request" ? "warning" : "info";
      addItem(items, severity, "schema-required-added", `New required field ${schemaPath}.${key}`, ref);
    });

    Object.entries(baseShape.properties).forEach(([key, baseProp]) => {
      const headProp = headShape.properties[key];
      if (!headProp) {
        addItem(items, "breaking", "schema-field-removed", `Removed field ${schemaPath}.${key}`, ref);
        return;
      }
      compareSchema(baseProp, headProp, `${schemaPath}.${key}`, items, ref, visitedBase, visitedHead);
    });

    Object.entries(headShape.properties).forEach(([key]) => {
      if (baseShape.properties[key]) return;
      if (context === "response") {
        addItem(items, "info", "schema-field-added", `Added field ${schemaPath}.${key}`, ref);
      }
    });
  }
}

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "trace",
];

function normalizeMethod(method) {
  return method.toUpperCase();
}

function getOperations(spec) {
  const operations = new Map();
  const paths = spec.paths;
  if (!paths || typeof paths !== "object") {
    return operations;
  }

  Object.entries(paths).forEach(([path, pathItem]) => {
    if (!pathItem || typeof pathItem !== "object") return;
    HTTP_METHODS.forEach((method) => {
      const operation = pathItem[method];
      if (operation && typeof operation === "object") {
        const key = `${normalizeMethod(method)} ${path}`;
        operations.set(key, {
          path,
          method: normalizeMethod(method),
          operation,
          pathItem,
        });
      }
    });
  });

  return operations;
}

function getResponses(operation) {
  const responses = operation.responses;
  if (!responses || typeof responses !== "object") {
    return new Set();
  }
  return new Set(Object.keys(responses));
}

function extractSchema(value) {
  return isRecord(value) ? value.schema || null : null;
}

function getSchemaFromContent(content) {
  if (!content || typeof content !== "object") return null;
  const jsonEntry = content["application/json"];
  const jsonSchema = extractSchema(jsonEntry);
  if (jsonSchema && isRecord(jsonSchema)) return jsonSchema;

  const jsonLikeKey = Object.keys(content).find((key) => key.endsWith("+json") || key.includes("json"));
  if (jsonLikeKey) {
    const schema = extractSchema(content[jsonLikeKey]);
    if (schema && isRecord(schema)) return schema;
  }

  const firstEntry = Object.values(content)[0];
  const schema = extractSchema(firstEntry);
  return schema && isRecord(schema) ? schema : null;
}

function getRequestSchema(operation) {
  const requestBody = operation.requestBody;
  if (!requestBody || typeof requestBody !== "object") return null;
  return getSchemaFromContent(requestBody.content);
}

function getResponseSchemas(operation) {
  const responses = operation.responses;
  const result = new Map();
  if (!responses || typeof responses !== "object") return result;
  Object.entries(responses).forEach(([status, response]) => {
    if (!isRecord(response)) return;
    const schema = getSchemaFromContent(response.content);
    if (schema) {
      result.set(status, schema);
    }
  });
  return result;
}

function getRequiredParams(pathItem, operation) {
  const params = [];
  if (Array.isArray(pathItem.parameters)) {
    params.push(...pathItem.parameters);
  }
  if (Array.isArray(operation.parameters)) {
    params.push(...operation.parameters);
  }

  const required = new Set();
  params.forEach((param) => {
    if (!param || typeof param !== "object") return;
    const name = String(param.name || "");
    const location = String(param.in || "");
    if (!name || !location) return;
    const isRequired = Boolean(param.required) || location === "path";
    if (isRequired) {
      required.add(`${location}:${name}`);
    }
  });
  return required;
}

function isRequestBodyRequired(operation) {
  if (!operation.requestBody || typeof operation.requestBody !== "object") {
    return false;
  }
  return Boolean(operation.requestBody.required);
}

function addItem(items, severity, code, message, ref) {
  items.push({
    severity,
    code,
    message,
    operation: ref ? { path: ref.path, method: ref.method } : undefined,
  });
}

function diffSpecs(baseSpec, headSpec) {
  const items = [];
  const baseOps = getOperations(baseSpec);
  const headOps = getOperations(headSpec);

  baseOps.forEach((baseOp, key) => {
    if (!headOps.has(key)) {
      addItem(items, "breaking", "operation-removed", `Removed operation ${key}`, baseOp);
    }
  });

  headOps.forEach((headOp, key) => {
    if (!baseOps.has(key)) {
      addItem(items, "info", "operation-added", `Added operation ${key}`, headOp);
    }
  });

  baseOps.forEach((baseOp, key) => {
    const headOp = headOps.get(key);
    if (!headOp) return;

    const baseResponses = getResponses(baseOp.operation);
    const headResponses = getResponses(headOp.operation);

    baseResponses.forEach((status) => {
      if (!headResponses.has(status)) {
        addItem(items, "breaking", "response-removed", `Removed response ${status} for ${key}`, baseOp);
      }
    });

    headResponses.forEach((status) => {
      if (!baseResponses.has(status)) {
        addItem(items, "info", "response-added", `Added response ${status} for ${key}`, headOp);
      }
    });

    const baseRequiredParams = getRequiredParams(baseOp.pathItem, baseOp.operation);
    const headRequiredParams = getRequiredParams(headOp.pathItem, headOp.operation);
    headRequiredParams.forEach((param) => {
      if (!baseRequiredParams.has(param)) {
        addItem(items, "warning", "required-param-added", `New required parameter ${param} for ${key}`, headOp);
      }
    });

    const baseBodyRequired = isRequestBodyRequired(baseOp.operation);
    const headBodyRequired = isRequestBodyRequired(headOp.operation);
    if (!baseBodyRequired && headBodyRequired) {
      addItem(items, "warning", "request-body-required", `Request body is now required for ${key}`, headOp);
    }

    const baseRequestSchema = getRequestSchema(baseOp.operation);
    const headRequestSchema = getRequestSchema(headOp.operation);
    if (baseRequestSchema && headRequestSchema) {
      compareSchema(
        baseRequestSchema,
        headRequestSchema,
        "request.body",
        items,
        headOp,
        new WeakSet(),
        new WeakSet()
      );
    }

    const baseResponseSchemas = getResponseSchemas(baseOp.operation);
    const headResponseSchemas = getResponseSchemas(headOp.operation);
    baseResponseSchemas.forEach((baseSchema, status) => {
      const headSchema = headResponseSchemas.get(status);
      if (!headSchema) return;
      compareSchema(
        baseSchema,
        headSchema,
        `response.${status}.body`,
        items,
        headOp,
        new WeakSet(),
        new WeakSet()
      );
    });
  });

  const summary = {
    breaking: items.filter((item) => item.severity === "breaking").length,
    warning: items.filter((item) => item.severity === "warning").length,
    info: items.filter((item) => item.severity === "info").length,
    total: items.length,
  };

  return { summary, items };
}

function formatMarkdown(result) {
  const lines = [];
  lines.push("## TrueSpec Summary");
  lines.push("");
  lines.push(`- Breaking: ${result.summary.breaking}`);
  lines.push(`- Warning: ${result.summary.warning}`);
  lines.push(`- Info: ${result.summary.info}`);

  if (result.items.length === 0) {
    lines.push("");
    lines.push("No differences found.");
    return lines.join("\n");
  }

  const order = ["breaking", "warning", "info"];
  order.forEach((severity) => {
    const items = result.items.filter((item) => item.severity === severity);
    if (items.length === 0) return;
    lines.push("");
    lines.push(`### ${severity.charAt(0).toUpperCase() + severity.slice(1)} (${items.length})`);
    items.forEach((item) => {
      lines.push(`- ${item.message}`);
    });
  });

  return lines.join("\n");
}

function normalizeRepo(value) {
  if (!value) return "unknown";
  return String(value).trim().toLowerCase() || "unknown";
}

function serializeItems(items) {
  const raw = JSON.stringify(items);
  return truncateText(raw);
}

module.exports = async function (context, req) {
  const debug = /^(1|true)$/i.test(process.env.REPORTS_DEBUG || "");

  try {
    const method = (req?.method || "").toUpperCase();
    const expectedAdminToken = process.env.REPORTS_ADMIN_TOKEN || "";
    const expectedIngestToken = process.env.REPORTS_INGEST_TOKEN || "";
    const providedToken = getAdminToken(req);

    if (method === "GET") {
      if (!expectedAdminToken) {
        context.res = {
          status: 403,
          body: "Admin token not configured",
        };
        return;
      }

      if (!providedToken || providedToken !== expectedAdminToken) {
        context.res = {
          status: 403,
          body: "Forbidden",
        };
        return;
      }

      await ensureTable();
      const client = getTableClient();

      if (req?.params?.id) {
        const id = String(req.params.id);
        const filter = `RowKey eq '${toOdataString(id)}'`;
        const entities = client.listEntities({
          queryOptions: {
            filter,
          },
        });

        for await (const entity of entities) {
          context.res = {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
            body: {
              id: entity.rowKey || entity.RowKey,
              repo: entity.repo || entity.partitionKey || entity.PartitionKey,
              createdAt: entity.createdAt || null,
              source: entity.source || null,
              summary: {
                breaking: entity.summaryBreaking || 0,
                warning: entity.summaryWarning || 0,
                info: entity.summaryInfo || 0,
                total: entity.summaryTotal || 0,
              },
              markdown: entity.markdown || null,
              items: entity.items ? JSON.parse(entity.items) : null,
            },
          };
          return;
        }

        context.res = {
          status: 404,
          body: "Report not found",
        };
        return;
      }

      const repo = normalizeRepo(req?.query?.repo);
      if (!repo || repo === "unknown") {
        context.res = {
          status: 400,
          body: "Missing repo query parameter",
        };
        return;
      }

      const pageSize = normalizePageSize(
        req?.query?.limit || req?.query?.top || req?.query?.pageSize
      );
      const continuationToken = getContinuationToken(req);
      const filter = `PartitionKey eq '${toOdataString(repo)}'`;

      const items = [];
      const pages = client.listEntities({
        queryOptions: {
          filter,
        },
      }).byPage({
        maxPageSize: pageSize,
        continuationToken,
      });

      let nextToken = null;
      for await (const page of pages) {
        for (const entity of page) {
          items.push({
            id: entity.rowKey || entity.RowKey,
            repo: entity.repo || entity.partitionKey || entity.PartitionKey,
            createdAt: entity.createdAt || null,
            source: entity.source || null,
            summary: {
              breaking: entity.summaryBreaking || 0,
              warning: entity.summaryWarning || 0,
              info: entity.summaryInfo || 0,
              total: entity.summaryTotal || 0,
            },
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

    if (expectedIngestToken && (!providedToken || providedToken !== expectedIngestToken)) {
      context.res = {
        status: 403,
        body: "Forbidden",
      };
      return;
    }

    const body = getBodyObject(req);
    const baseRaw = body.base || body.baseSpec || body.baseSpecText;
    const headRaw = body.head || body.headSpec || body.headSpecText;

    const baseSpec = parseSpecInput(baseRaw);
    const headSpec = parseSpecInput(headRaw);

    if (!baseSpec || !headSpec) {
      context.res = {
        status: 400,
        body: "Missing base/head specs",
      };
      return;
    }

    const repo = normalizeRepo(body.repo || req?.query?.repo);
    const source = body.source ? String(body.source) : "api";
    const reportId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

    const result = diffSpecs(baseSpec, headSpec);
    const markdown = formatMarkdown(result);
    const markdownResult = truncateText(markdown);
    const itemsResult = serializeItems(result.items);

    await ensureTable();
    const client = getTableClient();
    await client.createEntity({
      partitionKey: repo,
      rowKey: reportId,
      repo,
      source,
      createdAt: new Date().toISOString(),
      summaryBreaking: result.summary.breaking,
      summaryWarning: result.summary.warning,
      summaryInfo: result.summary.info,
      summaryTotal: result.summary.total,
      markdown: markdownResult.text,
      markdownTruncated: markdownResult.truncated,
      items: itemsResult.text,
      itemsTruncated: itemsResult.truncated,
    });

    context.res = {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: {
        reportId,
        repo,
        summary: result.summary,
        markdown: markdown,
        items: result.items,
      },
    };
  } catch (error) {
    context.log.error("Report request failed", error);
    context.res = {
      status: 500,
      body: debug ? String(error?.message || "Server error") : "Server error",
    };
  }
};
