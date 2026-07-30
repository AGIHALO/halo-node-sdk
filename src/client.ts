import {
    HaloAuthClient,
    HaloAuthSessionResponse,
    HaloAuthSignupConfirmationResponse,
    HaloAuthSignupInput,
    HaloAuthProvider,
    HaloAuthUser,
    generateOAuthState,
    generatePkcePair,
} from "./auth";

export type HaloAuthChangeEvent =
    | "INITIAL_SESSION"
    | "SIGNED_IN"
    | "TOKEN_REFRESHED"
    | "SIGNED_OUT";

export interface HaloAuthStorage {
    getItem(key: string): string | null | Promise<string | null>;
    setItem(key: string, value: string): void | Promise<void>;
    removeItem(key: string): void | Promise<void>;
}

export interface HaloClientOptions {
    auth?: {
        autoRefreshToken?: boolean;
        persistSession?: boolean;
        detectSessionInUrl?: boolean;
        storage?: HaloAuthStorage;
        storageKey?: string;
    };
    timeoutMs?: number;
}

export interface HaloSignUpCredentials {
    email: string;
    password: string;
    options?: {
        data?: Record<string, unknown>;
        emailRedirectTo?: string;
        displayName?: string;
    };
}

export interface HaloPasswordCredentials {
    email: string;
    password: string;
}

export interface HaloPasswordRecoveryOptions {
    redirectTo?: string;
}

export interface HaloRefreshSessionInput {
    refresh_token?: string;
}

export interface HaloOAuthCredentials {
    provider: HaloAuthProvider;
    options: {
        redirectTo: string;
        skipBrowserRedirect?: boolean;
    };
}

export interface HaloAuthSubscription {
    id: string;
    unsubscribe(): void;
}

export type HaloAuthResult<T> =
    | { data: T; error: null }
    | { data: null; error: Error };

export interface HaloAuthSessionData {
    user: HaloAuthUser;
    session: HaloAuthSessionResponse;
}

export interface HaloAuthSignupData {
    user: HaloAuthUser;
    session: HaloAuthSessionResponse | null;
}

type AuthStateCallback = (
    event: HaloAuthChangeEvent,
    session: HaloAuthSessionResponse | null
) => void;

const AUTO_REFRESH_MARGIN_MS = 60_000;
const OAUTH_FLOW_MAX_AGE_MS = 10 * 60_000;

interface HaloOAuthFlow {
    verifier: string;
    state: string;
    redirectTo: string;
    createdAt: number;
}

const isStoredSession = (
    value: unknown
): value is HaloAuthSessionResponse => {
    if (!value || typeof value !== "object") return false;
    const session = value as Partial<HaloAuthSessionResponse>;
    return (
        typeof session.access_token === "string" &&
        session.access_token.length > 0 &&
        typeof session.refresh_token === "string" &&
        session.refresh_token.length > 0 &&
        Boolean(session.user && typeof session.user === "object")
    );
};

const defaultStorage = (): HaloAuthStorage | undefined => {
    if (typeof globalThis === "undefined") return undefined;
    try {
        const storage = globalThis.localStorage;
        if (!storage) return undefined;
        return storage;
    } catch {
        return undefined;
    }
};

const defaultStorageKey = (publishableKey: string) => {
    const suffix = publishableKey
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(-24);
    return `halo-auth-token-${suffix || "default"}`;
};

const toError = (error: unknown) =>
    error instanceof Error ? error : new Error(String(error));

const success = <T>(data: T): HaloAuthResult<T> => ({
    data,
    error: null,
});

const failure = <T>(error: unknown): HaloAuthResult<T> => ({
    data: null,
    error: toError(error),
});

export class HaloManagedAuthClient {
    private readonly client: HaloAuthClient;
    private readonly persistSession: boolean;
    private readonly autoRefreshToken: boolean;
    private readonly detectSessionInUrl: boolean;
    private readonly storage?: HaloAuthStorage;
    private readonly storageKey: string;
    private readonly oauthFlowStorageKey: string;
    private readonly listeners = new Map<string, AuthStateCallback>();
    private readonly initialization: Promise<void>;
    private currentSession: HaloAuthSessionResponse | null = null;
    private oauthFlow: HaloOAuthFlow | null = null;
    private refreshTimer?: ReturnType<typeof setTimeout>;
    private refreshPromise?: Promise<HaloAuthSessionResponse>;
    private listenerSequence = 0;

    constructor(
        haloUrl: string,
        publishableKey: string,
        options: HaloClientOptions = {}
    ) {
        this.client = new HaloAuthClient({
            haloUrl,
            publishableKey,
            timeoutMs: options.timeoutMs,
        });
        this.persistSession = options.auth?.persistSession ?? true;
        this.autoRefreshToken = options.auth?.autoRefreshToken ?? true;
        this.detectSessionInUrl =
            options.auth?.detectSessionInUrl ?? true;
        this.storage = options.auth?.storage ?? defaultStorage();
        this.storageKey =
            options.auth?.storageKey ?? defaultStorageKey(publishableKey);
        this.oauthFlowStorageKey = `${this.storageKey}-pkce`;
        this.initialization = this.initialize();
    }

    async signUp(
        credentials: HaloSignUpCredentials
    ): Promise<HaloAuthResult<HaloAuthSignupData>> {
        await this.initialization;
        try {
            const input: HaloAuthSignupInput = {
                email: credentials.email,
                password: credentials.password,
                data: credentials.options?.data,
                redirectTo: credentials.options?.emailRedirectTo,
                displayName: credentials.options?.displayName,
            };
            const response = await this.client.signUp<
                HaloAuthSessionResponse | HaloAuthSignupConfirmationResponse
            >(input);
            if (isStoredSession(response)) {
                await this.saveSession(response, "SIGNED_IN");
                return success({
                    user: response.user,
                    session: response,
                });
            }
            return success({
                user: response.user,
                session: null,
            });
        } catch (error) {
            return failure(error);
        }
    }

    async signInWithPassword(
        credentials: HaloPasswordCredentials
    ): Promise<HaloAuthResult<HaloAuthSessionData>> {
        await this.initialization;
        try {
            const session = await this.client.signInWithPassword(
                credentials.email,
                credentials.password
            );
            await this.saveSession(session, "SIGNED_IN");
            return success({ user: session.user, session });
        } catch (error) {
            return failure(error);
        }
    }

    async getSession(): Promise<
        HaloAuthResult<{ session: HaloAuthSessionResponse | null }>
    > {
        await this.initialization;
        try {
            await this.refreshIfNeeded();
            return success({ session: this.currentSession });
        } catch (error) {
            return failure(error);
        }
    }

    async getUser(
        jwt?: string
    ): Promise<HaloAuthResult<{ user: HaloAuthUser }>> {
        await this.initialization;
        try {
            if (!jwt) await this.refreshIfNeeded();
            const accessToken = jwt ?? this.currentSession?.access_token;
            if (!accessToken) {
                throw new Error("No active HALO Auth session");
            }
            return success(await this.client.getUser(accessToken));
        } catch (error) {
            return failure(error);
        }
    }

    async refreshSession(
        input: HaloRefreshSessionInput = {}
    ): Promise<HaloAuthResult<HaloAuthSessionData>> {
        await this.initialization;
        try {
            const session = await this.refresh(
                input.refresh_token ?? this.currentSession?.refresh_token
            );
            return success({ user: session.user, session });
        } catch (error) {
            return failure(error);
        }
    }

    async signOut(): Promise<HaloAuthResult<Record<string, never>>> {
        await this.initialization;
        try {
            if (this.currentSession?.access_token) {
                await this.client.logout(this.currentSession.access_token);
            }
            await this.clearSession();
            return success({});
        } catch (error) {
            return failure(error);
        }
    }

    async resetPasswordForEmail(
        email: string,
        options: HaloPasswordRecoveryOptions = {}
    ): Promise<HaloAuthResult<unknown>> {
        await this.initialization;
        try {
            return success(
                await this.client.requestPasswordRecovery(
                    email,
                    options.redirectTo
                )
            );
        } catch (error) {
            return failure(error);
        }
    }

    async signInWithOAuth(
        credentials: HaloOAuthCredentials
    ): Promise<
        HaloAuthResult<{ provider: HaloAuthProvider; url: string }>
    > {
        await this.initialization;
        try {
            const pkce = generatePkcePair();
            const state = generateOAuthState();
            const flow: HaloOAuthFlow = {
                verifier: pkce.verifier,
                state,
                redirectTo: credentials.options.redirectTo,
                createdAt: Date.now(),
            };
            await this.saveOAuthFlow(flow);
            const url = this.client.buildProviderAuthorizeUrl({
                provider: credentials.provider,
                redirectTo: credentials.options.redirectTo,
                codeChallenge: pkce.challenge,
                state,
            });
            if (
                !credentials.options.skipBrowserRedirect &&
                typeof window !== "undefined"
            ) {
                window.location.assign(url);
            }
            return success({ provider: credentials.provider, url });
        } catch (error) {
            return failure(error);
        }
    }

    async exchangeCodeForSession(
        code: string,
        state?: string
    ): Promise<HaloAuthResult<HaloAuthSessionData>> {
        await this.initialization;
        try {
            const session = await this.exchangeOAuthCode(code, state);
            return success({ user: session.user, session });
        } catch (error) {
            return failure(error);
        }
    }

    onAuthStateChange(callback: AuthStateCallback): {
        data: { subscription: HaloAuthSubscription };
    } {
        const id = `halo-auth-listener-${++this.listenerSequence}`;
        this.listeners.set(id, callback);
        void this.initialization.then(() => {
            if (!this.listeners.has(id)) return;
            try {
                callback("INITIAL_SESSION", this.currentSession);
            } catch {
                // Listener failures must not change authentication state.
            }
        });
        return {
            data: {
                subscription: {
                    id,
                    unsubscribe: () => {
                        this.listeners.delete(id);
                    },
                },
            },
        };
    }

    private async initialize() {
        if (this.persistSession && this.storage) {
            try {
                const stored = await this.storage.getItem(this.storageKey);
                if (stored) {
                    const parsed = JSON.parse(stored) as unknown;
                    if (isStoredSession(parsed)) {
                        this.currentSession = parsed;
                    } else {
                        await this.storage.removeItem(this.storageKey);
                    }
                }
            } catch {
                await this.removeStoredSession();
            }
        }
        await this.restoreOAuthFlow();
        if (this.detectSessionInUrl) {
            await this.detectOAuthCallback();
        }
        this.scheduleAutoRefresh();
    }

    private async refreshIfNeeded() {
        if (!this.currentSession || !this.autoRefreshToken) return;
        const expiry = Date.parse(this.currentSession.expires_at);
        if (
            Number.isFinite(expiry) &&
            expiry - Date.now() <= AUTO_REFRESH_MARGIN_MS
        ) {
            await this.refresh(this.currentSession.refresh_token);
        }
    }

    private async refresh(refreshToken?: string) {
        if (!refreshToken) {
            throw new Error("No HALO Auth refresh token is available");
        }
        if (this.refreshPromise) return this.refreshPromise;
        this.refreshPromise = (async () => {
            const session =
                await this.client.refreshSession(refreshToken);
            await this.saveSession(session, "TOKEN_REFRESHED");
            return session;
        })();
        try {
            return await this.refreshPromise;
        } finally {
            this.refreshPromise = undefined;
        }
    }

    private async saveSession(
        session: HaloAuthSessionResponse,
        event: Exclude<HaloAuthChangeEvent, "INITIAL_SESSION" | "SIGNED_OUT">
    ) {
        this.currentSession = session;
        if (this.persistSession && this.storage) {
            await this.storage.setItem(
                this.storageKey,
                JSON.stringify(session)
            );
        }
        this.scheduleAutoRefresh();
        this.notify(event, session);
    }

    private async clearSession() {
        this.currentSession = null;
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = undefined;
        }
        await this.removeStoredSession();
        await this.removeOAuthFlow();
        this.notify("SIGNED_OUT", null);
    }

    private async removeStoredSession() {
        if (!this.persistSession || !this.storage) return;
        try {
            await this.storage.removeItem(this.storageKey);
        } catch {
            // Storage availability must not prevent an in-memory sign-out.
        }
    }

    private async saveOAuthFlow(flow: HaloOAuthFlow) {
        this.oauthFlow = flow;
        if (this.storage) {
            await this.storage.setItem(
                this.oauthFlowStorageKey,
                JSON.stringify(flow)
            );
        }
    }

    private async restoreOAuthFlow() {
        if (!this.storage) return;
        try {
            const stored = await this.storage.getItem(
                this.oauthFlowStorageKey
            );
            if (!stored) return;
            const flow = JSON.parse(stored) as Partial<HaloOAuthFlow>;
            if (
                typeof flow.verifier === "string" &&
                typeof flow.state === "string" &&
                typeof flow.redirectTo === "string" &&
                typeof flow.createdAt === "number" &&
                Date.now() - flow.createdAt <= OAUTH_FLOW_MAX_AGE_MS
            ) {
                this.oauthFlow = flow as HaloOAuthFlow;
                return;
            }
            await this.removeOAuthFlow();
        } catch {
            await this.removeOAuthFlow();
        }
    }

    private async removeOAuthFlow() {
        this.oauthFlow = null;
        if (!this.storage) return;
        try {
            await this.storage.removeItem(this.oauthFlowStorageKey);
        } catch {
            // An unavailable browser store must not invalidate a live session.
        }
    }

    private async exchangeOAuthCode(code: string, state?: string) {
        const flow = this.oauthFlow;
        if (!flow) {
            throw new Error("No pending HALO Auth PKCE flow");
        }
        if (Date.now() - flow.createdAt > OAUTH_FLOW_MAX_AGE_MS) {
            await this.removeOAuthFlow();
            throw new Error("The HALO Auth PKCE flow has expired");
        }
        if (state !== undefined && state !== flow.state) {
            throw new Error("HALO Auth OAuth state does not match");
        }
        const session = await this.client.exchangeProviderCode({
            code,
            codeVerifier: flow.verifier,
            redirectTo: flow.redirectTo,
        });
        await this.removeOAuthFlow();
        await this.saveSession(session, "SIGNED_IN");
        return session;
    }

    private async detectOAuthCallback() {
        if (
            !this.oauthFlow ||
            typeof window === "undefined" ||
            !window.location
        ) {
            return;
        }
        const callbackUrl = new URL(window.location.href);
        const code = callbackUrl.searchParams.get("code");
        if (!code) return;
        const state = callbackUrl.searchParams.get("state") ?? undefined;
        try {
            await this.exchangeOAuthCode(code, state);
            callbackUrl.searchParams.delete("code");
            callbackUrl.searchParams.delete("state");
            window.history.replaceState(
                window.history.state,
                "",
                callbackUrl.toString()
            );
        } catch {
            // The explicit exchangeCodeForSession call surfaces callback errors.
        }
    }

    private scheduleAutoRefresh() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = undefined;
        }
        if (
            !this.autoRefreshToken ||
            !this.currentSession ||
            typeof window === "undefined"
        ) {
            return;
        }
        const expiry = Date.parse(this.currentSession.expires_at);
        if (!Number.isFinite(expiry)) return;
        const delay = Math.max(
            0,
            expiry - Date.now() - AUTO_REFRESH_MARGIN_MS
        );
        this.refreshTimer = setTimeout(() => {
            void this.refresh(this.currentSession?.refresh_token).catch(
                () => undefined
            );
        }, delay);
    }

    private notify(
        event: HaloAuthChangeEvent,
        session: HaloAuthSessionResponse | null
    ) {
        for (const callback of this.listeners.values()) {
            try {
                callback(event, session);
            } catch {
                // Listener failures must not change authentication state.
            }
        }
    }
}

export class HaloClient {
    readonly auth: HaloManagedAuthClient;

    constructor(
        haloUrl: string,
        publishableKey: string,
        options: HaloClientOptions = {}
    ) {
        this.auth = new HaloManagedAuthClient(
            haloUrl,
            publishableKey,
            options
        );
    }
}

export const createClient = (
    haloUrl: string,
    publishableKey: string,
    options: HaloClientOptions = {}
) => new HaloClient(haloUrl, publishableKey, options);
