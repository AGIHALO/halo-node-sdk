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
import { haloSystem } from "halo-sdk";

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

## Advanced: TEE / Autonomous Agent Integration

For agents running in a Trusted Execution Environment (TEE) or those who want manual control over payments. You can use `HaloPaymentTools` as a toolset for your agent.

This enables the **Rescue Protocol**:
1. Agent hits 402.
2. Agent calls `consultJudge` (Free) to ask if it should pay.
3. If Judge says "YES", Agent calls `signPayment` (Paid) to generate a signature.
4. Agent retries the request with the signature.

```typescript
import { HaloPaymentTools } from "halo-sdk";

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
