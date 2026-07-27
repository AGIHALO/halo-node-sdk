# HALO Node.js SDK: Automated X402 Payments for Decentralized Agents

Implementing Automated X402 Payments via Halo SDK Wrapper for Gemini LLM. Designed for **Decentralized Agents** and AI Services.

The official Node.js client for Halo API, featuring **x402 auto-payment middleware** that seamlessly handles payment requirements for AI models.

> **👼 proper noun [HALO (Hyper-Available Lifeline Oracle)]**: 
> A protocol where a dormant agent receives a temporary intelligence boost ("HALO") to survive a resource crunch (402 Error).

## Installation

```bash
npm install agihalo-node-sdk ethers
```

## Quick Start: Auto-Payment (Recommended)

The easiest way to use HALO. Just wrap your existing model with `haloSystem`. If a 402 error occurs, it automatically signs the payment using your private key and retries.

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import { haloSystem } from "agihalo-node-sdk";

// 1. Setup Client
const genAI = new GoogleGenerativeAI("sk-..."); // Get your key at www.apihalo.com
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp" 
}, {
    baseUrl: "https://api.agihalo.com"
});

// 2. Attach HALO System (The Magic ✨)
// Just pass your private key. 402 errors will be auto-resolved.
const haloModel = haloSystem(model, {
    privateKey: "0xYOUR_PRIVATE_KEY",
    apiKey: "sk-..." // Get your key at www.apihalo.com
});

// 3. Use as usual
// If credits run out, it automatically pays 1 USDC and returns the result.
async function run() {
    const result = await haloModel.generateContent("Hello, Halo!");
    console.log(result.response.text());
}
run();
```

## Project Authentication

Use `HaloAuthClient` in an OEM or application frontend with the Project
publishable key. The client returns tokens to your application but never stores
them.

```typescript
import { HaloAuthClient } from "agihalo-node-sdk";

const auth = new HaloAuthClient({
    publishableKey: "pk-project",
});

const session = await auth.signInWithPassword(
    "user@example.com",
    "Secret123!"
);

const refreshed = await auth.refreshSession(session.refresh_token);
const user = await auth.getUser(refreshed.access_token);
```

For Google, Apple, GitHub, or Microsoft sign-in, create an S256 PKCE pair in
your app and open the returned URL:

```typescript
const authorizationUrl = auth.buildProviderAuthorizeUrl({
    provider: "google",
    redirectTo: "https://app.example.com/auth/callback",
    codeChallenge,
    state,
});

// After HALO redirects back with a one-time code:
const providerSession = await auth.exchangeProviderCode({
    code,
    codeVerifier,
    redirectTo: "https://app.example.com/auth/callback",
});
```

Services registered as HALO OAuth Apps use `HaloOAuthClient`. Keep a
confidential client secret in a trusted server runtime; public clients use PKCE
without a secret.

```typescript
import { HaloOAuthClient } from "agihalo-node-sdk";

const oauth = new HaloOAuthClient({
    clientId: "halo_client_...",
    clientSecret: "server-only-secret",
});

const authorizeUrl = oauth.buildAuthorizeUrl({
    redirectUri: "https://service.example.com/callback",
    scopes: ["profile", "email"],
    state,
});

const tokens = await oauth.exchangeCode(
    code,
    "https://service.example.com/callback"
);
const profile = await oauth.getUserInfo(tokens.access_token);
```

## Long-Term Memory

For new integrations, use `HaloMemoryClient` directly. The memory client does not read API keys or project keys from environment variables; pass them explicitly from your server configuration.

The memory project must already exist in Halo. `projectKey` is the memory project key, not the Halo API key. `endUserKey` is your customer-side end-user id and is required.

```typescript
import { HaloMemoryClient } from "agihalo-node-sdk";

const memory = new HaloMemoryClient({
    apiKey: "sk-...",
    projectKey: "customer-project-a",
});

// Add this declaration to your own LLM request tools/functions.
const memoryFunction = memory.functionDeclaration();
```

When your model returns a `halo_retrieve_end_user_memory` function call, execute it with Halo:

```typescript
const haloResult = await memory.executeRetrieveFunction({
    endUserKey: "end-user-123",
    sessionData: {
        messages: [
            { role: "user", content: "What should I follow up on today?" }
        ],
        currentTask: "answering user question",
    },
    limit: 5,
});

// Feed this back to your LLM as the tool/function response.
const toolResponse = haloResult.functionResponse;
```

After your LLM produces the final assistant answer, capture the exchange:

```typescript
await memory.capture({
    endUserKey: "end-user-123",
    sessionData: {
        messages: [
            { role: "user", content: "What should I follow up on today?" }
        ],
    },
    response: {
        role: "assistant",
        content: "You asked me to follow up on your weekly report draft.",
    },
});
```

You can also inspect or delete memory directly:

```typescript
await memory.retrieve({
    endUserKey: "end-user-123",
    topics: ["report_preferences"],
    limit: 5,
});

await memory.deleteTopic({
    endUserKey: "end-user-123",
    topicKey: "report_preferences",
    includeRaw: false,
});

await memory.deleteRawEntry({
    endUserKey: "end-user-123",
    rawEntryId: "raw_entry_id",
});
```

Legacy router/proxy integrations can still use `haloMemoryHeaders` on proxied model requests:

```typescript
import { haloMemoryHeaders } from "agihalo-node-sdk";

const headers = haloMemoryHeaders({
    projectKey: "customer-project-a",
    endUserKey: "end-user-123",
    mode: "capture"
});

// Pass `headers` through your provider client's per-request headers option.
```

`retrieve: true` is the legacy router mode. It asks Halo to inject compact memory context and the function declaration into the proxied model request. New integrations should prefer user-side function declaration plus direct function API execution.

### OEM Service connections (Preview)

The same Memory Project can manage resource connections for each end-user
scope. Register one fixed provider callback for the project; do not generate a
callback URL per end user. Confirm that the connector rollout is enabled for
your project before exposing this flow.

```typescript
await memory.registerOAuthProvider({
    providerKey: "google",
    clientId: "google-oauth-client-id",
    clientSecret: "google-oauth-client-secret",
    redirectUri:
        "https://connect.your-oem.com/api/v1/memory/oauth/callback/google",
});

await memory.registerOAuthReturnUri({
    returnUri: "your-oem-app://oauth/complete",
    completionMode: "mobile_deep_link",
});

const { authorizationUrl, session } = await memory.startOAuth({
    scopeId: "memory-scope-uuid",
    connectorId: "google.calendar",
    completionMode: "mobile_deep_link",
    returnUri: "your-oem-app://oauth/complete",
});

// Open authorizationUrl in the system browser. For a headless device, use
// completionMode: "device_poll" and poll with:
await memory.getOAuthSession(session.id);
```

`listConnectors()` reports which public OAuth connectors are configured for
the project and which catalog entries require an upstream partnership.
`listConnections(scopeId)` returns capability ids derived from the granted
scopes. `refreshConnection(scopeId, connectionId)` rotates the server-held
access token without returning provider tokens to the OEM or hardware.

See the complete guides at [docs.agihalo.com](https://docs.agihalo.com/).

## Advanced: TEE / Autonomous Agent Integration

For agents running in a Trusted Execution Environment (TEE) or those who want manual control over payments. You can use `HaloPaymentTools` as a toolset for your agent.

This enables the **Rescue Protocol**:
1. Agent hits 402.
2. Agent calls `consultJudge` (Free) to ask if it should pay.
3. If Judge says "YES", Agent calls `signPayment` (Paid) to generate a signature.
4. Agent retries the request with the signature.

```typescript
import { HaloPaymentTools } from "agihalo-node-sdk";

// 1. Initialize Tools inside TEE
const tools = new HaloPaymentTools({
    privateKey: "0xTEE_PRIVATE_KEY",
    apiKey: "sk-...",
    haloUrl: "https://api.agihalo.com"
});

// 2. Agent Logic (Simulation)
try {
    // ... make API call ...
    throw new Error("402 Payment Required"); // Simulated 402
} catch (error) {
    // 3. Agent decides to consult the Judge (Free Lifeline)
    console.log("Agent: 'I'm out of credits. Should I pay?'");
    
    const decision = await tools.consultJudge(
        "Calculating important physics data", 
        "1.00 USDC"
    );
    
    if (decision.includes("YES")) {
        console.log("Agent: 'Judge approved. Signing payment...'");
        
        // 4. Generate Payment Signature
        // (In real scenario, parse 'requirement' from 402 error header)
        const signature = await tools.signPayment(requirement);
        
        // 5. Retry with Proof
        // retryRequest({ headers: { "Payment-Signature": signature } });
        console.log("Success!");
    }
}
```

## Architecture

1.  **Halo System (Auto Mode)**:
    *   Wraps the model instance with a Proxy.
    *   Intercepts `402 Payment Required` errors.
    *   **Fast Track**: If `privateKey` is provided directly, it skips the Judge and immediately signs/pays (latency optimized).
    *   **Rescue Track**: If configured without a direct key, it consults the Judge first.

2.  **Halo Payment Tools (Manual Mode)**:
    *   `consultJudge(context, amount)`: Uses `x-halo-rescue` header to access the Judge model for free.
    *   `signPayment(requirement)`: Generates an EIP-712 signature for USDC TransferWithAuthorization.
# halo-node-sdk
