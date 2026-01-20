import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { appendFile } from "fs/promises";
import path from "path";

export async function waitlist(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (request.method !== "POST") {
    return { status: 405 };
  }

  const body = await request.formData();
  const email = body.get("email")?.toString();

  if (!email || !email.includes("@")) {
    return {
      status: 400,
      body: "Invalid email",
    };
  }

  const record = JSON.stringify({
    email,
    ts: new Date().toISOString(),
  }) + "\n";

  const filePath = path.join(context.executionContext.functionDirectory, "..", "waitlist.txt");

  await appendFile(filePath, record);

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
