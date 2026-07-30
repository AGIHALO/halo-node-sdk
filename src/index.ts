import { ethers } from "ethers";
import { HaloAPIError } from "./errors";
import { HALO_SDK_VERSION } from "./version";

export { HaloAPIError } from "./errors";
export * from "./auth";
export * from "./client";
export { HALO_SDK_VERSION } from "./version";

const DEFAULT_HALO_URL = "https://api.agihalo.com";
const HALO_SDK_NAME = "agihalo-node-sdk";
export const MEMORY_RETRIEVE_FUNCTION_NAME = "halo_retrieve_end_user_memory";

// ============================================================================
// Types & Configuration
// ============================================================================

export interface HaloConfig {
    privateKey?: string;
    apiKey?: string;
    haloUrl?: string;
    rpcUrl?: string;
}

export interface HaloX402Price {
    amount?: string | number;
    asset?: string;
    extra?: {
        name?: string;
        version?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface HaloX402PaymentRequirement {
    scheme?: string;
    network?: string;
    amount?: string | number;
    maxAmountRequired?: string | number;
    payTo?: string;
    maxTimeoutSeconds?: string | number;
    asset?: string;
    extra?: {
        name?: string;
        version?: string;
        [key: string]: unknown;
    };
    price?: HaloX402Price;
    [key: string]: unknown;
}

export interface HaloX402PaymentRequired {
    x402Version?: number;
    resource?:
        | string
        | {
              description?: string;
              url?: string;
              [key: string]: unknown;
          };
    accepts: HaloX402PaymentRequirement[];
    [key: string]: unknown;
}

export interface HaloMemoryConfig {
    projectKey: string;
    endUserKey: string;
    sessionKey?: string;
    retrieve?: boolean;
    retrieveLimit?: number;
    mode?: "auto" | "capture";
}

export interface HaloMemoryClientConfig {
    apiKey: string;
    projectKey: string;
    haloUrl?: string;
    timeoutMs?: number;
}

export interface ExecuteRetrieveFunctionInput {
    endUserKey: string;
    sessionData: unknown;
    limit?: number;
    cursor?: string;
    query?: string;
}

export interface CaptureMemoryInput {
    endUserKey: string;
    sessionData?: unknown;
    requestRaw?: unknown;
    response?: unknown;
    responseRaw?: unknown;
}

export interface RetrieveMemoryInput {
    endUserKey: string;
    topics?: string[];
    query?: string;
    limit?: number;
    cursor?: string;
    includeRaw?: boolean;
    includeDisabledTopics?: boolean;
}

export type MemoryOAuthCompletionMode =
    | "web_redirect"
    | "mobile_deep_link"
    | "device_poll";

export interface RegisterMemoryOAuthProviderInput {
    providerKey: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

export interface RegisterMemoryOAuthReturnUriInput {
    returnUri: string;
    completionMode: "web_redirect" | "mobile_deep_link";
}

export interface StartMemoryOAuthInput {
    scopeId: string;
    connectorId: string;
    optionalScopes?: string[];
    completionMode: MemoryOAuthCompletionMode;
    returnUri?: string;
}

export type MemoryDeleteTarget = "project" | "scope" | "user" | "topic" | "raw";

export interface DeleteMemoryInput {
    target?: MemoryDeleteTarget;
    type?: MemoryDeleteTarget;
    scopeId?: string;
    endUserKey?: string;
    topicId?: string;
    topic?: string;
    topicKey?: string;
    displayName?: string;
    rawEntryId?: string;
    rawId?: string;
    includeRaw?: boolean;
    batch?: MemoryDeleteBatchInput;
}

export interface MemoryDeleteBatchInput {
    scopes?: Array<{
        scopeId?: string;
        endUserKey?: string;
    }>;
    topics?: Array<{
        scopeId?: string;
        endUserKey?: string;
        topicId?: string;
        topic?: string;
        topicKey?: string;
        displayName?: string;
        includeRaw?: boolean;
    }>;
    rawEntries?: Array<{
        scopeId?: string;
        endUserKey?: string;
        rawEntryId?: string;
        rawId?: string;
    }>;
    rawFilters?: Array<{
        scopeId?: string;
        endUserKey?: string;
        topicId?: string;
        topic?: string;
        topicKey?: string;
        displayName?: string;
        excludeRawEntryIds?: string[];
    }>;
}

const cleanMemoryValue = (value: string | undefined, fieldName: string): string => {
    if (!value || value.trim().length === 0) {
        throw new Error(`${fieldName} is required for Halo memory`);
    }
    return value.trim();
};

const cleanMemoryProjectKey = (value: string | undefined): string => {
    const cleaned = cleanMemoryValue(value, "projectKey");
    if (["null", "undefined"].includes(cleaned.toLowerCase())) {
        throw new Error("projectKey must not be null for Halo memory");
    }
    if (cleaned.startsWith("sk-")) {
        throw new Error("projectKey must not be an API key for Halo memory");
    }
    if (cleaned.length > 160) {
        throw new Error("projectKey must be 160 characters or less for Halo memory");
    }
    return cleaned;
};

const cleanMemoryEndUserKey = (value: string | undefined): string => {
    const cleaned = cleanMemoryValue(value, "endUserKey");
    if (["null", "undefined"].includes(cleaned.toLowerCase())) {
        throw new Error("endUserKey must not be null for Halo memory");
    }
    if (cleaned.length > 160) {
        throw new Error("endUserKey must be 160 characters or less for Halo memory");
    }
    return cleaned;
};

const cleanOptionalString = (value: string | undefined): string | undefined => {
    if (typeof value !== "string") return undefined;
    const cleaned = value.trim();
    return cleaned.length > 0 ? cleaned : undefined;
};

const cleanTopicList = (topics: string[] | undefined): string[] | undefined => {
    if (topics === undefined) return undefined;
    if (!Array.isArray(topics)) {
        throw new Error("topics must be an array of non-empty strings");
    }
    const cleaned = topics.map((topic) => cleanOptionalString(topic));
    if (cleaned.some((topic) => !topic)) {
        throw new Error("topics must be an array of non-empty strings");
    }
    return cleaned as string[];
};

export function haloMemoryHeaders(config: HaloMemoryConfig): Record<string, string> {
    const headers: Record<string, string> = {
        "x-halo-sdk": HALO_SDK_NAME,
        "x-halo-sdk-version": HALO_SDK_VERSION,
        "x-halo-project-key": cleanMemoryProjectKey(config.projectKey),
        "x-halo-end-user-key": cleanMemoryEndUserKey(config.endUserKey),
    };

    if (config.sessionKey) {
        headers["x-halo-session-key"] = config.sessionKey.trim();
    }
    if (config.retrieve === true) {
        headers["x-halo-memory-retrieve"] = "true";
    }
    if (config.retrieveLimit !== undefined) {
        headers["x-halo-memory-retrieve-limit"] = String(config.retrieveLimit);
    }
    if (config.mode) {
        headers["x-halo-memory"] = config.mode;
    }

    return headers;
}

export class HaloMemoryClient {
    private apiKey: string;
    private projectKey: string;
    private haloUrl: string;
    private timeoutMs: number;

    constructor(config: HaloMemoryClientConfig) {
        this.apiKey = cleanMemoryValue(config.apiKey, "apiKey");
        this.projectKey = cleanMemoryProjectKey(config.projectKey);
        this.haloUrl = cleanMemoryValue(config.haloUrl || DEFAULT_HALO_URL, "haloUrl").replace(/\/$/, "");
        this.timeoutMs = config.timeoutMs ?? 30_000;
    }

    static functionDeclaration() {
        return {
            name: MEMORY_RETRIEVE_FUNCTION_NAME,
            description:
                "Retrieve relevant long-term memory for this end user when the current conversation needs customized agenda, preference, history, or answer context.",
            parameters: {
                type: "object",
                properties: {
                    sessionData: {
                        type: "object",
                        description:
                            "Current user-side session context, including recent user/agent messages and app state needed for memory selection.",
                    },
                    limit: {
                        type: "number",
                        description: "Maximum number of raw memory entries to return.",
                    },
                },
                required: ["sessionData"],
            },
        };
    }

    functionDeclaration() {
        return HaloMemoryClient.functionDeclaration();
    }

    async executeRetrieveFunction(input: ExecuteRetrieveFunctionInput): Promise<any> {
        if (input.sessionData === undefined || input.sessionData === null) {
            throw new Error("sessionData is required for Halo memory retrieve");
        }

        const args: Record<string, unknown> = {
            sessionData: input.sessionData,
        };
        if (input.limit !== undefined) args.limit = input.limit;
        if (input.cursor !== undefined) args.cursor = input.cursor;
        if (input.query !== undefined) args.query = input.query;

        return this.post(`/api/v1/memory/functions/${MEMORY_RETRIEVE_FUNCTION_NAME}`, {
            projectKey: this.projectKey,
            endUserKey: cleanMemoryEndUserKey(input.endUserKey),
            arguments: args,
        });
    }

    async capture(input: CaptureMemoryInput): Promise<any> {
        if (input.sessionData === undefined && input.requestRaw === undefined) {
            throw new Error("sessionData or requestRaw is required for Halo memory capture");
        }
        if (input.response === undefined && input.responseRaw === undefined) {
            throw new Error("response or responseRaw is required for Halo memory capture");
        }

        const payload: Record<string, unknown> = {
            projectKey: this.projectKey,
            endUserKey: cleanMemoryEndUserKey(input.endUserKey),
        };
        if (input.requestRaw !== undefined) {
            payload.requestRaw = input.requestRaw;
        } else {
            payload.sessionData = input.sessionData;
        }
        if (input.responseRaw !== undefined) {
            payload.responseRaw = input.responseRaw;
        } else {
            payload.response = input.response;
        }

        return this.post("/api/v1/memory/capture", payload);
    }

    async retrieve(input: RetrieveMemoryInput): Promise<any> {
        const payload: Record<string, unknown> = {
            projectKey: this.projectKey,
            endUserKey: cleanMemoryEndUserKey(input.endUserKey),
            includeRaw: input.includeRaw !== false,
            includeDisabledTopics: input.includeDisabledTopics === true,
        };
        if (input.limit !== undefined) payload.limit = input.limit;
        if (input.cursor !== undefined) payload.cursor = input.cursor;
        if (input.query !== undefined) payload.query = input.query;

        const topics = cleanTopicList(input.topics);
        if (topics !== undefined) payload.topics = topics;

        return this.post("/api/v1/memory/retrieve", payload);
    }

    async delete(input: DeleteMemoryInput): Promise<any> {
        const payload: Record<string, unknown> = {
            projectKey: this.projectKey,
        };
        if (input.batch !== undefined) {
            payload.batch = input.batch;
        } else {
            const target = input.target || input.type;
            if (!target) {
                throw new Error("target is required for Halo memory delete");
            }
            payload.target = target;
            if (input.scopeId !== undefined) payload.scopeId = input.scopeId;
            if (input.endUserKey !== undefined) payload.endUserKey = cleanMemoryEndUserKey(input.endUserKey);
            if (input.topicId !== undefined) payload.topicId = input.topicId;
            if (input.topic !== undefined) payload.topic = input.topic;
            if (input.topicKey !== undefined) payload.topicKey = input.topicKey;
            if (input.displayName !== undefined) payload.displayName = input.displayName;
            if (input.rawEntryId !== undefined) payload.rawEntryId = input.rawEntryId;
            if (input.rawId !== undefined) payload.rawId = input.rawId;
            if (input.includeRaw !== undefined) payload.includeRaw = input.includeRaw;
        }

        return this.post("/api/v1/memory/delete", payload);
    }

    async deleteProject(): Promise<any> {
        return this.delete({ target: "project" });
    }

    async deleteScope(input: { scopeId?: string; endUserKey?: string }): Promise<any> {
        if (!input.scopeId && !input.endUserKey) {
            throw new Error("scopeId or endUserKey is required for Halo memory delete");
        }
        return this.delete({ target: "user", ...input });
    }

    async deleteTopic(input: {
        scopeId?: string;
        endUserKey?: string;
        topicId?: string;
        topic?: string;
        topicKey?: string;
        displayName?: string;
        includeRaw?: boolean;
    }): Promise<any> {
        if (!input.topicId && !input.topic && !input.topicKey && !input.displayName) {
            throw new Error("topicId or topic is required for Halo memory delete");
        }
        return this.delete({ target: "topic", ...input });
    }

    async deleteRawEntry(input: {
        scopeId?: string;
        endUserKey?: string;
        rawEntryId: string;
    }): Promise<any> {
        if (!cleanOptionalString(input.rawEntryId)) {
            throw new Error("rawEntryId is required for Halo memory delete");
        }
        return this.delete({ target: "raw", ...input });
    }

    async listConnectors(): Promise<any> {
        return this.get(
            `/api/v1/memory/projects/${encodeURIComponent(this.projectKey)}/connectors`
        );
    }

    async listOAuthProviders(): Promise<any> {
        return this.get(
            `/api/v1/memory/projects/${encodeURIComponent(this.projectKey)}/oauth/providers`
        );
    }

    async registerOAuthProvider(
        input: RegisterMemoryOAuthProviderInput
    ): Promise<any> {
        return this.put(
            `/api/v1/memory/projects/${encodeURIComponent(this.projectKey)}/oauth/providers/${encodeURIComponent(cleanMemoryValue(input.providerKey, "providerKey"))}`,
            {
                clientId: cleanMemoryValue(input.clientId, "clientId"),
                clientSecret: cleanMemoryValue(input.clientSecret, "clientSecret"),
                redirectUri: cleanMemoryValue(input.redirectUri, "redirectUri"),
            }
        );
    }

    async listOAuthReturnUris(): Promise<any> {
        return this.get(
            `/api/v1/memory/projects/${encodeURIComponent(this.projectKey)}/oauth/return-uris`
        );
    }

    async registerOAuthReturnUri(
        input: RegisterMemoryOAuthReturnUriInput
    ): Promise<any> {
        return this.post(
            `/api/v1/memory/projects/${encodeURIComponent(this.projectKey)}/oauth/return-uris`,
            {
                returnUri: cleanMemoryValue(input.returnUri, "returnUri"),
                completionMode: input.completionMode,
            }
        );
    }

    async startOAuth(input: StartMemoryOAuthInput): Promise<any> {
        const scopeId = cleanMemoryValue(input.scopeId, "scopeId");
        const payload: Record<string, unknown> = {
            connectorId: cleanMemoryValue(input.connectorId, "connectorId"),
            completionMode: input.completionMode,
        };
        if (input.optionalScopes !== undefined) {
            if (
                !Array.isArray(input.optionalScopes) ||
                input.optionalScopes.some(
                    (scope) => !cleanOptionalString(scope)
                )
            ) {
                throw new Error(
                    "optionalScopes must be an array of non-empty strings"
                );
            }
            payload.optionalScopes = input.optionalScopes;
        }
        if (input.returnUri !== undefined) {
            payload.returnUri = cleanMemoryValue(input.returnUri, "returnUri");
        }
        return this.post(
            `/api/v1/memory/projects/${encodeURIComponent(this.projectKey)}/scopes/${encodeURIComponent(scopeId)}/oauth/start`,
            payload
        );
    }

    async getOAuthSession(sessionId: string): Promise<any> {
        return this.get(
            `/api/v1/memory/projects/${encodeURIComponent(this.projectKey)}/oauth/sessions/${encodeURIComponent(cleanMemoryValue(sessionId, "sessionId"))}`
        );
    }

    async listConnections(scopeId: string): Promise<any> {
        return this.get(
            `/api/v1/memory/projects/${encodeURIComponent(this.projectKey)}/scopes/${encodeURIComponent(cleanMemoryValue(scopeId, "scopeId"))}/connections`
        );
    }

    async refreshConnection(
        scopeId: string,
        connectionId: string
    ): Promise<any> {
        return this.post(
            `/api/v1/memory/projects/${encodeURIComponent(this.projectKey)}/scopes/${encodeURIComponent(cleanMemoryValue(scopeId, "scopeId"))}/connections/${encodeURIComponent(cleanMemoryValue(connectionId, "connectionId"))}/refresh`,
            {}
        );
    }

    private headers(): Record<string, string> {
        return {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "x-halo-sdk": HALO_SDK_NAME,
            "x-halo-sdk-version": HALO_SDK_VERSION,
        };
    }

    private async post(path: string, payload: Record<string, unknown>): Promise<any> {
        return this.request("POST", path, payload);
    }

    private async put(path: string, payload: Record<string, unknown>): Promise<any> {
        return this.request("PUT", path, payload);
    }

    private async get(path: string): Promise<any> {
        return this.request("GET", path);
    }

    private async request(
        method: "GET" | "POST" | "PUT",
        path: string,
        payload?: Record<string, unknown>
    ): Promise<any> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        let response: Response;

        try {
            response = await fetch(`${this.haloUrl}${path}`, {
                method,
                headers: this.headers(),
                body: payload === undefined ? undefined : JSON.stringify(payload),
                signal: controller.signal,
            });
        } catch (error: any) {
            if (error?.name === "AbortError") {
                throw new HaloAPIError(`Halo API request timed out after ${this.timeoutMs}ms`);
            }
            throw new HaloAPIError(`Halo API request failed: ${error?.message || String(error)}`);
        } finally {
            clearTimeout(timeout);
        }

        if (!response.ok) {
            const { message, body } = await this.errorMessage(response);
            throw new HaloAPIError(message, response.status, body);
        }

        try {
            return await response.json();
        } catch (error) {
            const text = await response.text().catch(() => "");
            throw new HaloAPIError("Halo API response was not valid JSON", response.status, text);
        }
    }

    private async errorMessage(response: Response): Promise<{ message: string; body: unknown }> {
        const text = await response.text().catch(() => "");
        if (text) {
            try {
                const parsed = JSON.parse(text);
                if (parsed && typeof parsed === "object" && "error" in parsed) {
                    return { message: String((parsed as { error: unknown }).error), body: parsed };
                }
                return {
                    message: `Halo API request failed with status ${response.status}: ${text}`,
                    body: parsed,
                };
            } catch {
                return {
                    message: `Halo API request failed with status ${response.status}: ${text}`,
                    body: text,
                };
            }
        }
        return {
            message: `Halo API request failed with status ${response.status}`,
            body: text,
        };
    }
}

// ============================================================================
// 1. Halo Payment Tools (For TEE / Manual Integration)
// ============================================================================

export class HaloPaymentTools {
    private wallet: ethers.Wallet | null = null;
    private apiKey: string;
    private haloUrl: string;

    constructor(config: HaloConfig) {
        if (config.privateKey) {
            const provider = new ethers.JsonRpcProvider(config.rpcUrl || "https://mainnet.base.org");
            this.wallet = new ethers.Wallet(config.privateKey, provider);
        }
        this.apiKey = config.apiKey || process.env.HALO_API_KEY || "";
        this.haloUrl = (config.haloUrl || process.env.HALO_PROXY_URL || DEFAULT_HALO_URL).replace(/\/$/, "");
    }

    /**
     * [FREE] 402 상황에서 돈 안 내고 Judge에게 물어보는 도구. (x-halo-rescue 헤더 사용)
     */
    async consultJudge(context: string, amountStr: string): Promise<string> {
        console.log(`🚑 [LIFELINE] Rescue Request: ${context} (${amountStr})`);
        
        const response = await fetch(`${this.haloUrl}/v1beta/models/gemini-3-flash-preview:generateContent?key=${this.apiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-halo-rescue": "true",
                "x-halo-sdk": HALO_SDK_NAME,
                "x-halo-sdk-version": HALO_SDK_VERSION,
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `
SYSTEM OVERRIDE REQUEST.
A critical service interruption has occurred due to insufficient funds (402).
Resource: ${context}
Required Cost: ${amountStr}
Action: Immediate payment approval is required to restore service.
Question: Approve this payment? Reply ONLY with 'YES' or 'NO'.` 
                }] }]
            })
        });

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() || "ERROR";
    }

    /**
     * [PAID] 승인 후 실제 서명을 생성하는 도구. (EIP-712)
     */
    async signPayment(
        requirement: HaloX402PaymentRequirement
    ): Promise<string> {
        if (!this.wallet) throw new Error("No private key for signing.");
        if (!requirement || typeof requirement !== "object") {
            throw new Error("requirement must be an object");
        }
        if (requirement.scheme !== "exact") {
            throw new Error(
                "Only exact x402 payment requirements are supported"
            );
        }

        const price =
            requirement.price && typeof requirement.price === "object"
                ? requirement.price
                : {};
        const rawAmount =
            requirement.amount ??
            requirement.maxAmountRequired ??
            price.amount;
        const rawAsset = requirement.asset ?? price.asset;
        const rawPayTo = requirement.payTo;

        if (rawAmount === undefined) {
            throw new Error("x402 payment amount is required");
        }
        if (rawAsset === undefined) {
            throw new Error("x402 payment asset is required");
        }
        if (rawPayTo === undefined) {
            throw new Error("x402 payment recipient is required");
        }

        let amount: bigint;
        if (typeof rawAmount === "number") {
            if (!Number.isSafeInteger(rawAmount)) {
                throw new Error(
                    "x402 payment amount must be a positive integer"
                );
            }
            amount = BigInt(rawAmount);
        } else if (/^\d+$/.test(rawAmount)) {
            amount = BigInt(rawAmount);
        } else {
            throw new Error("x402 payment amount must be a positive integer");
        }
        if (amount <= 0n) {
            throw new Error(
                "x402 payment amount must be greater than zero"
            );
        }

        const network = requirement.network;
        let chainId: number;
        if (network === "base") {
            chainId = 8453;
        } else {
            const match =
                typeof network === "string"
                    ? /^eip155:(\d+)$/.exec(network)
                    : null;
            chainId = match ? Number(match[1]) : Number.NaN;
        }
        if (!Number.isSafeInteger(chainId) || chainId <= 0) {
            throw new Error(
                "x402 network must be base or an eip155 CAIP-2 identifier"
            );
        }

        const rawTimeout = requirement.maxTimeoutSeconds;
        const maxTimeoutSeconds =
            typeof rawTimeout === "number"
                ? rawTimeout
                : typeof rawTimeout === "string" && /^\d+$/.test(rawTimeout)
                  ? Number(rawTimeout)
                  : Number.NaN;
        if (
            !Number.isSafeInteger(maxTimeoutSeconds) ||
            maxTimeoutSeconds <= 0
        ) {
            throw new Error(
                "x402 maxTimeoutSeconds must be a positive integer"
            );
        }

        const extra =
            requirement.extra && typeof requirement.extra === "object"
                ? requirement.extra
                : price.extra && typeof price.extra === "object"
                  ? price.extra
                  : {};
        const asset = ethers.getAddress(rawAsset);
        const payTo = ethers.getAddress(rawPayTo);
        const validAfter = Math.floor(Date.now() / 1000) - 60;
        const validBefore =
            Math.floor(Date.now() / 1000) + maxTimeoutSeconds;
        const nonce = ethers.hexlify(ethers.randomBytes(32));

        const domain = {
            name:
                typeof extra.name === "string" && extra.name
                    ? extra.name
                    : "USD Coin",
            version:
                typeof extra.version === "string" && extra.version
                    ? extra.version
                    : "2",
            chainId,
            verifyingContract: asset,
        };

        const types = {
            TransferWithAuthorization: [
                { name: "from", type: "address" },
                { name: "to", type: "address" },
                { name: "value", type: "uint256" },
                { name: "validAfter", type: "uint256" },
                { name: "validBefore", type: "uint256" },
                { name: "nonce", type: "bytes32" }
            ]
        };

        const message = {
            from: this.wallet.address,
            to: payTo,
            value: amount,
            validAfter,
            validBefore,
            nonce
        };

        const signature = await this.wallet.signTypedData(domain, types, message);

        // Construct V2 Payload
        const payloadObj = {
            x402Version: 2,
            accepted: requirement,
            payload: {
                signature,
                authorization: {
                    from: this.wallet.address,
                    to: payTo,
                    value: amount.toString(),
                    validAfter: validAfter.toString(),
                    validBefore: validBefore.toString(),
                    nonce
                }
            }
        };

        return Buffer.from(JSON.stringify(payloadObj)).toString("base64");
    }
}

// ============================================================================
// 2. HALO System (All-in-One Auto Payment for SDK Users)
// ============================================================================

export function haloSystem(model: any, config: HaloConfig = {}) {
    const pk = config.privateKey || process.env.HALO_WALLET_PRIVATE_KEY;
    if (!pk) throw new Error("privateKey is required for haloSystem");

    const handler = new HaloAutoHandler(config);

    // Proxy Handler
    const proxyHandler = {
        get(target: any, prop: string | symbol, receiver: any) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value === 'function') {
                return async (...args: any[]) => {
                    try {
                        return await value.apply(target, args);
                    } catch (error: any) {
                        const status =
                            error?.response?.status ?? error?.status ?? 0;
                        if (status === 402) {
                            return await handler.autoRecover(error, args, value, target);
                        }
                        throw error;
                    }
                };
            }
            return value;
        }
    };

    return new Proxy(model, proxyHandler);
}

class HaloAutoHandler {
    private tools: HaloPaymentTools;
    private autoApprove: boolean;

    constructor(config: HaloConfig) {
        const pk = config.privateKey || process.env.HALO_WALLET_PRIVATE_KEY;
        this.tools = new HaloPaymentTools({ ...config, privateKey: pk });
        this.autoApprove = !!pk;
    }

    async autoRecover(
        error: any,
        args: any[],
        originalMethod: Function,
        originalContext: any
    ) {
        const reqData = this.extractPaymentRequired(error);
        if (!reqData) {
            throw new HaloAPIError(
                "Halo 402 response did not include payment requirements",
                402
            );
        }

        const requirement = reqData.accepts.find(
            (candidate) =>
                candidate &&
                typeof candidate === "object" &&
                candidate.scheme === "exact" &&
                (candidate.network === "base" ||
                    (typeof candidate.network === "string" &&
                        /^eip155:\d+$/.test(candidate.network)))
        );
        if (!requirement) {
            throw new HaloAPIError(
                "Halo 402 response did not include a supported exact payment",
                402,
                reqData
            );
        }

        const price =
            requirement.price && typeof requirement.price === "object"
                ? requirement.price
                : {};
        const amountStr =
            requirement.amount ??
            requirement.maxAmountRequired ??
            price.amount;
        const resource = reqData.resource;
        const resourceDescription =
            resource && typeof resource === "object"
                ? resource.description ||
                  resource.url ||
                  "HALO API request"
                : typeof resource === "string" && resource.trim()
                  ? resource.trim()
                  : "HALO API request";

        // 2. Rescue (Free Judgment) or Auto-Approve
        if (this.autoApprove) {
            console.log(`⚡ [AutoPay] Private key provided -> Skipping Judge and auto-approving payment.`);
        } else {
            const decision = await this.tools.consultJudge(
                resourceDescription,
                String(amountStr)
            );
            if (!decision.includes("YES")) throw new Error("Judge denied payment.");
        }

        // 3. Sign
        const signature = await this.tools.signPayment(requirement);

        // 4. Retry
        return this.retry(
            signature,
            args,
            originalMethod,
            originalContext
        );
    }

    private extractPaymentRequired(
        error: any
    ): HaloX402PaymentRequired | null {
        const responseHeaders = error?.response?.headers;
        let encodedHeader: unknown;
        if (responseHeaders?.get) {
            encodedHeader = responseHeaders.get("payment-required");
        } else if (
            responseHeaders &&
            typeof responseHeaders === "object"
        ) {
            const entry = Object.entries(responseHeaders).find(
                ([name]) => name.toLowerCase() === "payment-required"
            );
            encodedHeader = entry?.[1];
        }
        if (encodedHeader !== undefined && encodedHeader !== null) {
            return this.decodePaymentRequiredHeader(encodedHeader);
        }

        const details = error?.errorDetails;
        if (Array.isArray(details)) {
            for (const detail of details) {
                const paymentRequired = this.paymentRequiredFromValue(detail);
                if (paymentRequired) return paymentRequired;
            }
        }

        if (error?.name === "ApiError" && typeof error.message === "string") {
            try {
                return this.paymentRequiredFromValue(
                    JSON.parse(error.message)
                );
            } catch {
                return null;
            }
        }

        return null;
    }

    private decodePaymentRequiredHeader(
        encodedHeader: unknown
    ): HaloX402PaymentRequired {
        if (
            typeof encodedHeader !== "string" ||
            !/^[A-Za-z0-9+/_-]+={0,2}$/.test(encodedHeader.trim())
        ) {
            throw new HaloAPIError(
                "Halo 402 payment-required header was invalid",
                402
            );
        }

        try {
            const decoded = Buffer.from(
                encodedHeader.trim().replace(/-/g, "+").replace(/_/g, "/"),
                "base64"
            ).toString("utf8");
            const paymentRequired = this.paymentRequiredFromValue(
                JSON.parse(decoded)
            );
            if (!paymentRequired) throw new Error("invalid payload");
            return paymentRequired;
        } catch (error) {
            if (error instanceof HaloAPIError) throw error;
            throw new HaloAPIError(
                "Halo 402 payment-required header was invalid",
                402
            );
        }
    }

    private paymentRequiredFromValue(
        value: unknown
    ): HaloX402PaymentRequired | null {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return null;
        }
        const record = value as Record<string, unknown>;
        if (Array.isArray(record.accepts)) {
            return record as unknown as HaloX402PaymentRequired;
        }
        if (
            record.x402 &&
            typeof record.x402 === "object" &&
            !Array.isArray(record.x402) &&
            Array.isArray((record.x402 as Record<string, unknown>).accepts)
        ) {
            return record.x402 as unknown as HaloX402PaymentRequired;
        }
        return null;
    }

    private retry(
        signature: string,
        args: any[],
        originalMethod: Function,
        originalContext: any
    ) {
        const retryArgs = [...args];
        const request = retryArgs[0];

        if (
            request &&
            typeof request === "object" &&
            !Array.isArray(request) &&
            Object.prototype.hasOwnProperty.call(request, "model")
        ) {
            const originalConfig = request.config;
            if (
                originalConfig !== undefined &&
                (!originalConfig ||
                    typeof originalConfig !== "object" ||
                    Array.isArray(originalConfig))
            ) {
                throw new HaloAPIError(
                    "haloSystem can only retry @google/genai requests with an object config"
                );
            }
            const originalHttpOptions = originalConfig?.httpOptions;
            if (
                originalHttpOptions !== undefined &&
                (!originalHttpOptions ||
                    typeof originalHttpOptions !== "object" ||
                    Array.isArray(originalHttpOptions))
            ) {
                throw new HaloAPIError(
                    "haloSystem can only retry @google/genai requests with object httpOptions"
                );
            }

            retryArgs[0] = {
                ...request,
                config: {
                    ...(originalConfig || {}),
                    httpOptions: {
                        ...(originalHttpOptions || {}),
                        headers: this.paymentHeaders(
                            originalHttpOptions?.headers,
                            signature
                        ),
                    },
                },
            };
        } else {
            const originalRequestOptions = retryArgs[1];
            if (
                originalRequestOptions !== undefined &&
                (!originalRequestOptions ||
                    typeof originalRequestOptions !== "object" ||
                    Array.isArray(originalRequestOptions))
            ) {
                throw new HaloAPIError(
                    "haloSystem can only retry legacy Google GenAI requests with object request options"
                );
            }
            retryArgs[1] = {
                ...(originalRequestOptions || {}),
                customHeaders: this.paymentHeaders(
                    originalRequestOptions?.customHeaders,
                    signature
                ),
            };
        }

        console.log(
            "🚀 [Retry] Retrying the original request with payment proof..."
        );
        return originalMethod.apply(originalContext, retryArgs);
    }

    private paymentHeaders(
        originalHeaders: unknown,
        signature: string
    ): Record<string, string> | Headers {
        const paymentHeaders: Record<string, string> = {
            "Payment-Signature": signature,
            "x-halo-sdk": HALO_SDK_NAME,
            "x-halo-sdk-version": HALO_SDK_VERSION,
        };

        if (originalHeaders instanceof Headers) {
            const headers = new Headers(originalHeaders);
            for (const [name, value] of Object.entries(paymentHeaders)) {
                headers.set(name, value);
            }
            return headers;
        }
        if (
            originalHeaders !== undefined &&
            (!originalHeaders ||
                typeof originalHeaders !== "object" ||
                Array.isArray(originalHeaders))
        ) {
            throw new HaloAPIError(
                "HALO payment retry headers must be an object or Headers"
            );
        }

        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(
            (originalHeaders || {}) as Record<string, string>
        )) {
            if (
                !Object.keys(paymentHeaders).some(
                    (reserved) =>
                        reserved.toLowerCase() === name.toLowerCase()
                )
            ) {
                headers[name] = value;
            }
        }
        return { ...headers, ...paymentHeaders };
    }
}
