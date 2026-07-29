const assert = require("node:assert/strict");
const test = require("node:test");

const {
    HALO_SDK_VERSION,
    HaloAPIError,
    HaloMemoryClient,
    MEMORY_RETRIEVE_FUNCTION_NAME,
    haloMemoryHeaders,
} = require("../dist/index.js");

const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
});

const withMockFetch = async (handler, run) => {
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        return handler(url, options);
    };

    try {
        await run(calls);
    } finally {
        global.fetch = originalFetch;
    }
};

test("executeRetrieveFunction posts the expected payload", async () => {
    await withMockFetch(
        async () => jsonResponse(200, { ok: true }),
        async (calls) => {
            const client = new HaloMemoryClient({
                apiKey: "sk-test",
                projectKey: "project-a",
                haloUrl: "https://halo.test/",
                timeoutMs: 1234,
            });

            const result = await client.executeRetrieveFunction({
                endUserKey: "end-user-1",
                sessionData: { messages: [{ role: "user", content: "hello" }] },
                limit: 7,
                cursor: "cursor-1",
                query: "hello",
            });

            assert.deepEqual(result, { ok: true });
            assert.equal(
                calls[0].url,
                "https://halo.test/api/v1/memory/functions/halo_retrieve_end_user_memory"
            );
            assert.equal(calls[0].options.method, "POST");
            assert.equal(calls[0].options.headers.Authorization, "Bearer sk-test");
            assert.equal(calls[0].options.headers["Content-Type"], "application/json");
            assert.equal(calls[0].options.headers["x-halo-sdk"], "agihalo-node-sdk");
            assert.equal(
                calls[0].options.headers["x-halo-sdk-version"],
                HALO_SDK_VERSION
            );
            assert.deepEqual(JSON.parse(calls[0].options.body), {
                projectKey: "project-a",
                endUserKey: "end-user-1",
                arguments: {
                    sessionData: {
                        messages: [{ role: "user", content: "hello" }],
                    },
                    limit: 7,
                    cursor: "cursor-1",
                    query: "hello",
                },
            });
        }
    );
});

test("capture requires request and assistant response payloads", async () => {
    const client = new HaloMemoryClient({
        apiKey: "sk-test",
        projectKey: "project-a",
    });

    await assert.rejects(
        () => client.capture({ endUserKey: "end-user-1" }),
        /sessionData or requestRaw is required/
    );
    await assert.rejects(
        () => client.capture({
            endUserKey: "end-user-1",
            sessionData: { messages: [] },
        }),
        /response or responseRaw is required/
    );

    await withMockFetch(
        async () => jsonResponse(201, { captured: true }),
        async (calls) => {
            const result = await client.capture({
                endUserKey: "end-user-1",
                requestRaw: { messages: [{ role: "user", content: "remember this" }] },
                responseRaw: { role: "assistant", content: "saved" },
            });

            assert.deepEqual(result, { captured: true });
            assert.equal(calls[0].url, "https://api.agihalo.com/api/v1/memory/capture");
            assert.deepEqual(JSON.parse(calls[0].options.body), {
                projectKey: "project-a",
                endUserKey: "end-user-1",
                requestRaw: {
                    messages: [{ role: "user", content: "remember this" }],
                },
                responseRaw: { role: "assistant", content: "saved" },
            });
        }
    );
});

test("retrieve validates topics before posting", async () => {
    const client = new HaloMemoryClient({
        apiKey: "sk-test",
        projectKey: "project-a",
    });

    await assert.rejects(
        () => client.retrieve({
            endUserKey: "end-user-1",
            topics: ["profile", ""],
        }),
        /topics must be an array of non-empty strings/
    );

    await withMockFetch(
        async () => jsonResponse(200, { rawEntries: [] }),
        async (calls) => {
            const result = await client.retrieve({
                endUserKey: "end-user-1",
                topics: ["report_preferences"],
                query: "weekly report",
                limit: 3,
                cursor: "cursor-2",
                includeRaw: false,
                includeDisabledTopics: true,
            });

            assert.deepEqual(result, { rawEntries: [] });
            assert.equal(calls[0].url, "https://api.agihalo.com/api/v1/memory/retrieve");
            assert.deepEqual(JSON.parse(calls[0].options.body), {
                projectKey: "project-a",
                endUserKey: "end-user-1",
                includeRaw: false,
                includeDisabledTopics: true,
                limit: 3,
                cursor: "cursor-2",
                query: "weekly report",
                topics: ["report_preferences"],
            });
        }
    );
});

test("delete helpers post inferred delete payloads", async () => {
    await withMockFetch(
        async () => jsonResponse(200, { deleted: true }),
        async (calls) => {
            const client = new HaloMemoryClient({
                apiKey: "sk-test",
                projectKey: "project-a",
            });

            await client.deleteTopic({
                endUserKey: "end-user-1",
                topicKey: "report_preferences",
                includeRaw: false,
            });
            await client.deleteRawEntry({
                endUserKey: "end-user-1",
                rawEntryId: "raw-entry-1",
            });

            assert.equal(calls[0].url, "https://api.agihalo.com/api/v1/memory/delete");
            assert.deepEqual(JSON.parse(calls[0].options.body), {
                projectKey: "project-a",
                target: "topic",
                endUserKey: "end-user-1",
                topicKey: "report_preferences",
                includeRaw: false,
            });
            assert.deepEqual(JSON.parse(calls[1].options.body), {
                projectKey: "project-a",
                target: "raw",
                endUserKey: "end-user-1",
                rawEntryId: "raw-entry-1",
            });
        }
    );
});

test("non-success responses raise HaloAPIError", async () => {
    await withMockFetch(
        async () => jsonResponse(400, { error: "sessionData is required" }),
        async () => {
            const client = new HaloMemoryClient({
                apiKey: "sk-test",
                projectKey: "project-a",
            });

            await assert.rejects(
                () =>
                    client.executeRetrieveFunction({
                        endUserKey: "end-user-1",
                        sessionData: { messages: [] },
                    }),
                (error) => {
                    assert.ok(error instanceof HaloAPIError);
                    assert.equal(error.message, "sessionData is required");
                    assert.equal(error.statusCode, 400);
                    assert.deepEqual(error.responseBody, { error: "sessionData is required" });
                    return true;
                }
            );
        }
    );
});

test("function declaration and legacy headers expose stable names", () => {
    const declaration = HaloMemoryClient.functionDeclaration();

    assert.equal(MEMORY_RETRIEVE_FUNCTION_NAME, "halo_retrieve_end_user_memory");
    assert.equal(declaration.name, MEMORY_RETRIEVE_FUNCTION_NAME);
    assert.deepEqual(declaration.parameters.required, ["sessionData"]);
    assert.deepEqual(
        haloMemoryHeaders({
            projectKey: "project-a",
            endUserKey: "end-user-1",
            mode: "capture",
        }),
        {
            "x-halo-sdk": "agihalo-node-sdk",
            "x-halo-sdk-version": HALO_SDK_VERSION,
            "x-halo-project-key": "project-a",
            "x-halo-end-user-key": "end-user-1",
            "x-halo-memory": "capture",
        }
    );
});

test("Memory OAuth helpers keep the project and end user scope explicit", async () => {
    await withMockFetch(
        async (_url, options) =>
            jsonResponse(options.method === "POST" ? 201 : 200, { ok: true }),
        async (calls) => {
            const client = new HaloMemoryClient({
                apiKey: "sk-test",
                projectKey: "oem project",
                haloUrl: "https://halo.test",
            });

            await client.listConnectors();
            await client.registerOAuthProvider({
                providerKey: "google",
                clientId: "google-client",
                clientSecret: "google-secret",
                redirectUri:
                    "https://connect.oem.test/api/v1/memory/oauth/callback/google",
            });
            await client.registerOAuthReturnUri({
                returnUri: "oemapp://oauth/complete",
                completionMode: "mobile_deep_link",
            });
            await client.startOAuth({
                scopeId: "scope-1",
                connectorId: "google.calendar",
                completionMode: "mobile_deep_link",
                returnUri: "oemapp://oauth/complete",
            });
            await client.getOAuthSession("session-1");
            await client.listConnections("scope-1");
            await client.refreshConnection("scope-1", "connection-1");

            assert.equal(
                calls[0].url,
                "https://halo.test/api/v1/memory/projects/oem%20project/connectors"
            );
            assert.equal(calls[0].options.method, "GET");
            assert.equal(calls[1].options.method, "PUT");
            assert.deepEqual(JSON.parse(calls[1].options.body), {
                clientId: "google-client",
                clientSecret: "google-secret",
                redirectUri:
                    "https://connect.oem.test/api/v1/memory/oauth/callback/google",
            });
            assert.equal(calls[3].options.method, "POST");
            assert.deepEqual(JSON.parse(calls[3].options.body), {
                connectorId: "google.calendar",
                completionMode: "mobile_deep_link",
                returnUri: "oemapp://oauth/complete",
            });
            assert.equal(
                calls[6].url,
                "https://halo.test/api/v1/memory/projects/oem%20project/scopes/scope-1/connections/connection-1/refresh"
            );
        }
    );
});
