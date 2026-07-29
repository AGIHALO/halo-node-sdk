const assert = require("node:assert/strict");
const test = require("node:test");

const {
    HALO_SDK_VERSION,
    HaloPaymentTools,
    haloSystem,
} = require("../dist/index.js");

const PRIVATE_KEY = `0x${"01".repeat(32)}`;
const ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const FIRST_RECIPIENT = "0x2b8f0ba618170512a64C2E422c6e9C5B3Ed293E2";
const NEXT_RECIPIENT = "0x1111111111111111111111111111111111111111";

const paymentRequirement = (payTo = FIRST_RECIPIENT) => ({
    scheme: "exact",
    network: "eip155:8453",
    payTo,
    maxTimeoutSeconds: 60,
    price: {
        amount: "1000000",
        asset: ASSET,
        extra: {
            name: "USD Coin",
            version: "2",
        },
    },
});

const paymentRequired = (requirement = paymentRequirement()) => ({
    x402Version: 2,
    resource: {
        url: "https://api.agihalo.com/v1beta/models/example",
        description: "HALO model request",
    },
    accepts: [requirement],
});

const decodePayment = (value) =>
    JSON.parse(Buffer.from(value, "base64").toString("utf8"));

test("signPayment uses the server recipient and nested price contract", async () => {
    const tools = new HaloPaymentTools({
        privateKey: PRIVATE_KEY,
        apiKey: "sk-test",
    });
    const firstRequirement = paymentRequirement();
    const firstPayload = decodePayment(
        await tools.signPayment(firstRequirement)
    );

    assert.deepEqual(firstPayload.accepted, firstRequirement);
    assert.equal(
        firstPayload.payload.authorization.to,
        FIRST_RECIPIENT
    );
    assert.equal(firstPayload.payload.authorization.value, "1000000");
    assert.ok(
        Number(firstPayload.payload.authorization.validBefore) -
            Number(firstPayload.payload.authorization.validAfter) >=
            119
    );

    const nextPayload = decodePayment(
        await tools.signPayment(paymentRequirement(NEXT_RECIPIENT))
    );
    assert.equal(
        nextPayload.payload.authorization.to,
        NEXT_RECIPIENT
    );
});

test("haloSystem retries the original @google/genai request", async () => {
    const required = paymentRequired();
    const captured = [];
    const model = {
        async generateContent(request) {
            captured.push(request);
            if (captured.length === 1) {
                const error = new Error(
                    JSON.stringify({
                        error: {
                            code: 402,
                            message: "Payment Required",
                        },
                        x402: required,
                    })
                );
                error.name = "ApiError";
                error.status = 402;
                throw error;
            }
            return { text: "paid" };
        },
    };
    const wrapped = haloSystem(model, {
        privateKey: PRIVATE_KEY,
        apiKey: "sk-test",
    });
    const request = {
        model: "gemini-3.5-flash",
        contents: "Keep the original request",
        config: {
            temperature: 0.2,
            httpOptions: {
                headers: {
                    "X-Request-ID": "request-1",
                },
            },
        },
    };

    const result = await wrapped.generateContent(request);

    assert.deepEqual(result, { text: "paid" });
    assert.equal(captured[1].model, "gemini-3.5-flash");
    assert.equal(captured[1].contents, "Keep the original request");
    assert.equal(captured[1].config.temperature, 0.2);
    assert.equal(
        captured[1].config.httpOptions.headers["X-Request-ID"],
        "request-1"
    );
    assert.equal(
        captured[1].config.httpOptions.headers["x-halo-sdk-version"],
        HALO_SDK_VERSION
    );
    const signed = decodePayment(
        captured[1].config.httpOptions.headers["Payment-Signature"]
    );
    assert.equal(signed.payload.authorization.to, FIRST_RECIPIENT);
    assert.equal(
        request.config.httpOptions.headers["Payment-Signature"],
        undefined
    );
});

test("haloSystem accepts payment-required header casing for legacy requests", async () => {
    const encoded = Buffer.from(
        JSON.stringify(paymentRequired())
    ).toString("base64");
    const captured = [];
    const model = {
        async generateContent(request, options) {
            captured.push({ request, options });
            if (captured.length === 1) {
                const error = new Error("Payment Required");
                error.response = {
                    status: 402,
                    headers: {
                        "Payment-Required": encoded,
                    },
                };
                throw error;
            }
            return { response: { text: () => "paid" } };
        },
    };
    const wrapped = haloSystem(model, {
        privateKey: PRIVATE_KEY,
        apiKey: "sk-test",
    });

    const result = await wrapped.generateContent("Original prompt", {
        customHeaders: {
            "X-Request-ID": "request-2",
        },
    });

    assert.equal(result.response.text(), "paid");
    assert.equal(captured[1].request, "Original prompt");
    assert.equal(
        captured[1].options.customHeaders["X-Request-ID"],
        "request-2"
    );
    assert.ok(
        captured[1].options.customHeaders["Payment-Signature"]
    );
});

test("signPayment rejects unsupported networks and invalid timeouts", async () => {
    const tools = new HaloPaymentTools({
        privateKey: PRIVATE_KEY,
        apiKey: "sk-test",
    });

    await assert.rejects(
        () =>
            tools.signPayment({
                ...paymentRequirement(),
                network: "not-an-eip155-network",
            }),
        /eip155/
    );
    await assert.rejects(
        () =>
            tools.signPayment({
                ...paymentRequirement(),
                maxTimeoutSeconds: 0,
            }),
        /positive integer/
    );
});
