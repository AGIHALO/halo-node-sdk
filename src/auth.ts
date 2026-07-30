import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "@noble/hashes/utils";

import { HaloAPIError } from "./errors";
import { HALO_SDK_VERSION } from "./version";

const DEFAULT_HALO_URL = "https://api.agihalo.com";
const HALO_NODE_SDK_NAME = "agihalo-node-sdk";
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const BASE64_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const encodeBase64Url = (bytes: Uint8Array) => {
    let encoded = "";
    for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index];
        const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
        const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
        const value = (first << 16) | (second << 8) | third;
        encoded += BASE64_ALPHABET[(value >> 18) & 63];
        encoded += BASE64_ALPHABET[(value >> 12) & 63];
        if (index + 1 < bytes.length) {
            encoded += BASE64_ALPHABET[(value >> 6) & 63];
        }
        if (index + 2 < bytes.length) {
            encoded += BASE64_ALPHABET[value & 63];
        }
    }
    return encoded.replace(/\+/g, "-").replace(/\//g, "_");
};

export interface HaloPkcePair {
    verifier: string;
    challenge: string;
}

export function generatePkcePair(): HaloPkcePair {
    const verifier = encodeBase64Url(randomBytes(64));
    const challenge = encodeBase64Url(
        sha256(new TextEncoder().encode(verifier))
    );
    return { verifier, challenge };
}

export function generateOAuthState(byteLength = 32): string {
    if (
        !Number.isInteger(byteLength) ||
        byteLength < 16 ||
        byteLength > 128
    ) {
        throw new Error("byteLength must be an integer between 16 and 128");
    }
    return encodeBase64Url(randomBytes(byteLength));
}

const requiredString = (value: string | undefined, fieldName: string) => {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${fieldName} is required`);
    }
    return value.trim();
};

const optionalString = (value: string | undefined) => {
    if (typeof value !== "string") return undefined;
    const cleaned = value.trim();
    return cleaned.length > 0 ? cleaned : undefined;
};

const optionalBoundedString = (
    value: string | undefined,
    fieldName: string,
    maxLength: number
) => {
    const cleaned = optionalString(value);
    if (cleaned !== undefined && cleaned.length > maxLength) {
        throw new Error(`${fieldName} must be ${maxLength} characters or less`);
    }
    return cleaned;
};

const requiredPkceChallenge = (value: string | undefined) => {
    const challenge = requiredString(value, "codeChallenge");
    if (!PKCE_CHALLENGE_PATTERN.test(challenge)) {
        throw new Error(
            "codeChallenge must be a 43-character S256 base64url value"
        );
    }
    return challenge;
};

const requiredPkceVerifier = (value: string | undefined) => {
    const verifier = requiredString(value, "codeVerifier");
    if (!PKCE_VERIFIER_PATTERN.test(verifier)) {
        throw new Error(
            "codeVerifier must be 43-128 RFC 7636 unreserved characters"
        );
    }
    return verifier;
};

const cleanScopes = (scopes: string[] | undefined) => {
    if (scopes === undefined) return undefined;
    if (
        !Array.isArray(scopes) ||
        scopes.length === 0 ||
        scopes.some((scope) => !optionalString(scope))
    ) {
        throw new Error("scopes must be a non-empty array of non-empty strings");
    }
    return scopes.map((scope) => scope.trim());
};

export interface HaloAuthClientConfig {
    publishableKey: string;
    haloUrl?: string;
    timeoutMs?: number;
}

export interface HaloAuthSignupInput {
    email: string;
    password: string;
    displayName?: string;
    redirectTo?: string;
    data?: Record<string, unknown>;
}

export type HaloAuthProvider =
    | "google"
    | "apple"
    | "github"
    | "microsoft"
    | (string & {});

export interface HaloAuthProviderAuthorizeInput {
    provider: HaloAuthProvider;
    redirectTo: string;
    codeChallenge: string;
    state?: string;
}

export interface HaloAuthProviderTokenInput {
    code: string;
    codeVerifier: string;
    redirectTo: string;
}

export interface HaloAuthUser {
    id: string;
    projectId: string;
    email: string;
    displayName: string | null;
    status: "active" | "invited" | "banned";
    providers: string[];
    emailConfirmedAt: string | null;
    userMetadata: Record<string, unknown>;
    appMetadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

export interface HaloAuthSession {
    id: string;
    projectId: string;
    authUserId: string;
    expiresAt: string;
    lastSeenAt: string;
    revokedAt: string | null;
    createdAt: string;
}

export interface HaloAuthSessionResponse {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    expires_at: string;
    user: HaloAuthUser;
    session: HaloAuthSession;
}

export interface HaloAuthSignupConfirmationResponse {
    user: HaloAuthUser;
    session: null;
    confirmation_required: true;
}

export interface HaloAuthSettingsResponse {
    project_id: string;
    email: {
        enabled: boolean;
        signup_enabled: boolean;
        confirm_required: boolean;
        min_password_length: number;
        password_requirements: {
            uppercase: boolean;
            lowercase: boolean;
            number: boolean;
            symbol: boolean;
        };
    };
    site_url: string | null;
    identity_providers: Array<{
        provider: string;
        label: string;
    }>;
}

interface HaloRequestOptions {
    body?: Record<string, unknown>;
    accessToken?: string;
}

class HaloJsonClient {
    protected readonly haloUrl: string;
    protected readonly timeoutMs: number;

    constructor(haloUrl: string | undefined, timeoutMs: number | undefined) {
        this.haloUrl = requiredString(
            haloUrl || DEFAULT_HALO_URL,
            "haloUrl"
        ).replace(/\/+$/, "");
        this.timeoutMs = timeoutMs ?? 30_000;
        if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
            throw new Error("timeoutMs must be greater than zero");
        }
    }

    protected async request<T>(
        method: "GET" | "POST",
        path: string,
        headers: Record<string, string>,
        body?: Record<string, unknown>
    ): Promise<T> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        let response: Response;
        try {
            response = await fetch(`${this.haloUrl}${path}`, {
                method,
                headers: {
                    Accept: "application/json",
                    "x-halo-sdk": HALO_NODE_SDK_NAME,
                    "x-halo-sdk-version": HALO_SDK_VERSION,
                    ...headers,
                    ...(body ? { "Content-Type": "application/json" } : {}),
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
        } catch (error: any) {
            if (error?.name === "AbortError") {
                throw new HaloAPIError(
                    `Halo API request timed out after ${this.timeoutMs}ms`
                );
            }
            throw new HaloAPIError(
                `Halo API request failed: ${error?.message || String(error)}`
            );
        } finally {
            clearTimeout(timeout);
        }

        const text = await response.text().catch(() => "");
        let parsed: unknown = null;
        if (text) {
            try {
                parsed = JSON.parse(text);
            } catch {
                if (response.ok) {
                    throw new HaloAPIError(
                        "Halo API response was not valid JSON",
                        response.status,
                        text
                    );
                }
            }
        }

        if (!response.ok) {
            const errorBody =
                parsed && typeof parsed === "object"
                    ? (parsed as { error?: unknown; code?: unknown })
                    : null;
            const message =
                errorBody?.error !== undefined
                    ? String(errorBody.error)
                    : text
                      ? `Halo API request failed with status ${response.status}: ${text}`
                      : `Halo API request failed with status ${response.status}`;
            throw new HaloAPIError(
                message,
                response.status,
                parsed ?? text,
                errorBody?.code !== undefined
                    ? String(errorBody.code)
                    : undefined
            );
        }

        return parsed as T;
    }
}

export class HaloAuthClient extends HaloJsonClient {
    private readonly publishableKey: string;

    constructor(config: HaloAuthClientConfig) {
        super(config.haloUrl, config.timeoutMs);
        this.publishableKey = requiredString(
            config.publishableKey,
            "publishableKey"
        );
    }

    async getSettings<T = HaloAuthSettingsResponse>(): Promise<T> {
        return this.authRequest<T>("GET", "/api/v1/auth/settings");
    }

    async getJwks<T = unknown>(): Promise<T> {
        return this.authRequest<T>(
            "GET",
            "/api/v1/auth/.well-known/jwks.json"
        );
    }

    async signUp<
        T = HaloAuthSessionResponse | HaloAuthSignupConfirmationResponse
    >(
        input: HaloAuthSignupInput
    ): Promise<T> {
        const body: Record<string, unknown> = {
            email: requiredString(input.email, "email"),
            password: requiredString(input.password, "password"),
        };
        if (optionalString(input.displayName)) {
            body.display_name = input.displayName!.trim();
        }
        if (optionalString(input.redirectTo)) {
            body.redirect_to = input.redirectTo!.trim();
        }
        if (input.data !== undefined) body.data = input.data;
        return this.authRequest<T>("POST", "/api/v1/auth/signup", { body });
    }

    async signInWithPassword<T = HaloAuthSessionResponse>(
        email: string,
        password: string
    ): Promise<T> {
        return this.authRequest<T>(
            "POST",
            "/api/v1/auth/token?grant_type=password",
            {
                body: {
                    email: requiredString(email, "email"),
                    password: requiredString(password, "password"),
                },
            }
        );
    }

    async refreshSession<T = HaloAuthSessionResponse>(
        refreshToken: string
    ): Promise<T> {
        return this.authRequest<T>(
            "POST",
            "/api/v1/auth/token?grant_type=refresh_token",
            {
                body: {
                    refresh_token: requiredString(
                        refreshToken,
                        "refreshToken"
                    ),
                },
            }
        );
    }

    async getUser<T = { user: HaloAuthUser }>(
        accessToken: string
    ): Promise<T> {
        return this.authRequest<T>("GET", "/api/v1/auth/user", {
            accessToken,
        });
    }

    async logout<T = unknown>(accessToken: string): Promise<T> {
        return this.authRequest<T>("POST", "/api/v1/auth/logout", {
            accessToken,
            body: {},
        });
    }

    async requestPasswordRecovery<T = unknown>(
        email: string,
        redirectTo?: string
    ): Promise<T> {
        const body: Record<string, unknown> = {
            email: requiredString(email, "email"),
        };
        if (optionalString(redirectTo)) {
            body.redirect_to = redirectTo!.trim();
        }
        return this.authRequest<T>("POST", "/api/v1/auth/recover", { body });
    }

    async resetPassword<T = unknown>(
        token: string,
        password: string
    ): Promise<T> {
        return this.authRequest<T>("POST", "/api/v1/auth/password/reset", {
            body: {
                token: requiredString(token, "token"),
                password: requiredString(password, "password"),
            },
        });
    }

    buildProviderAuthorizeUrl(input: HaloAuthProviderAuthorizeInput): string {
        const provider = requiredString(input.provider, "provider");
        const url = new URL(
            `${this.haloUrl}/api/v1/auth/providers/${encodeURIComponent(provider)}/authorize`
        );
        url.searchParams.set("apikey", this.publishableKey);
        url.searchParams.set(
            "redirect_to",
            requiredString(input.redirectTo, "redirectTo")
        );
        url.searchParams.set(
            "code_challenge",
            requiredPkceChallenge(input.codeChallenge)
        );
        url.searchParams.set("code_challenge_method", "S256");
        const state = optionalBoundedString(input.state, "state", 1024);
        if (state !== undefined) {
            url.searchParams.set("state", state);
        }
        return url.toString();
    }

    async exchangeProviderCode<T = HaloAuthSessionResponse>(
        input: HaloAuthProviderTokenInput
    ): Promise<T> {
        return this.authRequest<T>("POST", "/api/v1/auth/providers/token", {
            body: {
                code: requiredString(input.code, "code"),
                code_verifier: requiredPkceVerifier(input.codeVerifier),
                redirect_to: requiredString(
                    input.redirectTo,
                    "redirectTo"
                ),
            },
        });
    }

    private async authRequest<T>(
        method: "GET" | "POST",
        path: string,
        options: HaloRequestOptions = {}
    ): Promise<T> {
        const headers: Record<string, string> = {
            apikey: this.publishableKey,
        };
        if (options.accessToken) {
            headers.Authorization = `Bearer ${requiredString(
                options.accessToken,
                "accessToken"
            )}`;
        }
        return this.request<T>(method, path, headers, options.body);
    }
}

export interface HaloOAuthClientConfig {
    clientId: string;
    clientSecret?: string;
    haloUrl?: string;
    timeoutMs?: number;
}

export interface HaloOAuthAuthorizeInput {
    redirectUri: string;
    scopes: string[];
    state?: string;
    codeChallenge?: string;
}

export interface HaloOAuthTokenResponse {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
}

export class HaloOAuthClient extends HaloJsonClient {
    private readonly clientId: string;
    private readonly clientSecret?: string;

    constructor(config: HaloOAuthClientConfig) {
        super(config.haloUrl, config.timeoutMs);
        this.clientId = requiredString(config.clientId, "clientId");
        this.clientSecret = optionalString(config.clientSecret);
    }

    buildAuthorizeUrl(input: HaloOAuthAuthorizeInput): string {
        const url = new URL(`${this.haloUrl}/api/v1/auth/oauth/authorize`);
        url.searchParams.set("client_id", this.clientId);
        url.searchParams.set(
            "redirect_uri",
            requiredString(input.redirectUri, "redirectUri")
        );
        url.searchParams.set("scope", cleanScopes(input.scopes)!.join(" "));
        const state = optionalBoundedString(input.state, "state", 512);
        if (state !== undefined) {
            url.searchParams.set("state", state);
        }
        if (optionalString(input.codeChallenge)) {
            url.searchParams.set(
                "code_challenge",
                requiredPkceChallenge(input.codeChallenge)
            );
            url.searchParams.set("code_challenge_method", "S256");
        }
        return url.toString();
    }

    async getAuthorizationDetails<T = unknown>(
        input: Pick<HaloOAuthAuthorizeInput, "redirectUri" | "scopes">
    ): Promise<T> {
        const url = new URL(`${this.haloUrl}/api/v1/auth/oauth/authorize`);
        url.searchParams.set("client_id", this.clientId);
        url.searchParams.set(
            "redirect_uri",
            requiredString(input.redirectUri, "redirectUri")
        );
        url.searchParams.set("scope", cleanScopes(input.scopes)!.join(" "));
        return this.request<T>("GET", `${url.pathname}${url.search}`, {});
    }

    async authorize<T = unknown>(
        accessToken: string,
        input: HaloOAuthAuthorizeInput
    ): Promise<T> {
        const body: Record<string, unknown> = {
            client_id: this.clientId,
            redirect_uri: requiredString(input.redirectUri, "redirectUri"),
            scopes: cleanScopes(input.scopes),
        };
        const state = optionalBoundedString(input.state, "state", 512);
        if (state !== undefined) body.state = state;
        if (optionalString(input.codeChallenge)) {
            body.code_challenge = requiredPkceChallenge(input.codeChallenge);
            body.code_challenge_method = "S256";
        }
        return this.request<T>(
            "POST",
            "/api/v1/auth/oauth/authorize",
            {
                Authorization: `Bearer ${requiredString(
                    accessToken,
                    "accessToken"
                )}`,
            },
            body
        );
    }

    async exchangeCode<T = HaloOAuthTokenResponse>(
        code: string,
        redirectUri: string,
        codeVerifier?: string
    ): Promise<T> {
        const body: Record<string, unknown> = {
            grant_type: "authorization_code",
            client_id: this.clientId,
            code: requiredString(code, "code"),
            redirect_uri: requiredString(redirectUri, "redirectUri"),
        };
        if (this.clientSecret) body.client_secret = this.clientSecret;
        if (optionalString(codeVerifier)) {
            body.code_verifier = requiredPkceVerifier(codeVerifier);
        }
        return this.request<T>(
            "POST",
            "/api/v1/auth/oauth/token",
            {},
            body
        );
    }

    async refreshToken<T = HaloOAuthTokenResponse>(
        refreshToken: string
    ): Promise<T> {
        const body: Record<string, unknown> = {
            grant_type: "refresh_token",
            client_id: this.clientId,
            refresh_token: requiredString(refreshToken, "refreshToken"),
        };
        if (this.clientSecret) body.client_secret = this.clientSecret;
        return this.request<T>(
            "POST",
            "/api/v1/auth/oauth/token",
            {},
            body
        );
    }

    async getUserInfo<T = unknown>(accessToken: string): Promise<T> {
        return this.request<T>(
            "GET",
            "/api/v1/auth/oauth/userinfo",
            {
                Authorization: `Bearer ${requiredString(
                    accessToken,
                    "accessToken"
                )}`,
            }
        );
    }
}
