# HALO Node.js SDK

The official Node.js client for HALO Project Authentication, OAuth Apps,
long-term Memory, and server-driven x402 payments.

> **👼 proper noun [HALO (Hyper-Available Lifeline Oracle)]**:
> A protocol where a dormant agent receives a temporary intelligence boost ("HALO") to survive a resource crunch (402 Error).

## Installation

```bash
npm install agihalo-node-sdk
```

Node.js 18 or newer is required.

## What's included in 0.3.0

- Supabase-style `createClient(url, publishableKey).auth` session management
- Project user signup, password sessions, rotating refresh tokens, recovery,
  JWKS, and upstream provider login
- OAuth App authorization-code, PKCE, refresh-token, and user-info flows
- Direct Memory capture, retrieve, deletion, and function execution
- Server-driven x402 signing that uses the `payTo`, network, asset, amount, and
  timeout returned by `https://api.agihalo.com`

## Model Gateway

HALO exposes an OpenAI-compatible production endpoint. Use the OpenAI package
for model calls and this package for HALO Authentication, Memory, and x402
helpers.

```bash
npm install openai
```

```typescript
import OpenAI from "openai";

const halo = new OpenAI({
    apiKey: process.env.HALO_API_KEY,
    baseURL: "https://api.agihalo.com/openai/v1",
});

const response = await halo.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: "Reply with one word: ready" }],
});
console.log(response.choices[0].message.content);
```

## x402 Auto-Payment

Wrap a current `@google/genai` Models client with `haloSystem`. When the HALO
API returns 402, the wrapper signs the server-provided payment requirement and
retries the original model, contents, config, and request headers with the
payment proof.

```bash
npm install @google/genai
```

```typescript
import { GoogleGenAI } from "@google/genai";
import { haloSystem } from "agihalo-node-sdk";

const apiKey = process.env.HALO_API_KEY!;
const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
        baseUrl: "https://api.agihalo.com",
    },
});

const haloModels = haloSystem(ai.models, {
    privateKey: process.env.HALO_WALLET_PRIVATE_KEY!,
    apiKey,
});

const response = await haloModels.generateContent({
    model: "gemini-3.5-flash",
    contents: "Hello, HALO!",
});
console.log(response.text);
```

The SDK does not contain a platform receive-wallet constant. It signs the
`payTo` value delivered by the trusted HALO 402 response, so a server-side
wallet rotation does not require a Node package update.

## Project Authentication

Create the client once with the Project publishable key. The managed Auth
client stores the browser session, rotates refresh tokens, emits authentication
state changes, and automatically sends both `apikey` and the current bearer
access token.

```typescript
import { createClient } from "agihalo-node-sdk/auth";

const halo = createClient(
    "https://api.agihalo.com",
    "pk-project"
);

const { data, error } = await halo.auth.signInWithPassword({
    email: "user@example.com",
    password: "Secret123!",
});
if (error) throw error;

const { data: userData } = await halo.auth.getUser();
console.log(userData?.user);
```

The browser entry point is isolated from the model, Memory, payment, and Node
runtime modules. Browser sessions persist and auto-refresh by default. Use
`persistSession: false` for a BFF-managed cookie session.

```typescript
const halo = createClient(
    "https://api.agihalo.com",
    "pk-project",
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    }
);
```

Google, Apple, GitHub, and Microsoft sign-in use PKCE without a client secret.
The managed client retains the verifier, validates state, exchanges the
one-time callback code, and stores the resulting Project session.

```typescript
const { data, error } = await halo.auth.signInWithOAuth({
    provider: "google",
    options: {
        redirectTo: "https://app.example.com/auth/callback",
    },
});
if (error) throw error;
```

The publishable key is public application identity, not a secret. Access and
refresh tokens are bearer credentials. Keep frontend dependencies and CSP
tight; for the strongest isolation, disable SDK persistence and keep tokens in
a Secure, HttpOnly, SameSite-protected cookie behind a BFF.

The lower-level `HaloAuthClient` remains available for explicit server-side
token handling.

Services registered as HALO OAuth Apps use `HaloOAuthClient`. Keep a
confidential client secret in a trusted server runtime; public clients use PKCE
without a secret.

```typescript
import {
    HaloOAuthClient,
    generateOAuthState,
} from "agihalo-node-sdk";

const oauth = new HaloOAuthClient({
    clientId: "halo_client_...",
    clientSecret: "server-only-secret",
});

const state = generateOAuthState();
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
    haloUrl: "https://api.agihalo.com",
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
        // Parse requirement from the trusted payment-required response header.
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
    *   Uses the payment recipient and settlement parameters returned by the HALO API instead of a wallet embedded in the SDK.
    *   Retries the original model request with `Payment-Signature`; it does not replace the requested model.
    *   Signs immediately with the explicitly configured private key.

2.  **Halo Payment Tools (Manual Mode)**:
    *   `consultJudge(context, amount)`: Uses `x-halo-rescue` header to access the Judge model for free.
    *   `signPayment(requirement)`: Generates an EIP-712 signature for USDC TransferWithAuthorization.

Create API keys and manage projects at [app.agihalo.com](https://app.agihalo.com/).
