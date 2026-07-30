const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
    HALO_SDK_VERSION,
    HaloAPIError,
    HaloAuthClient,
    HaloOAuthClient,
    createClient,
    generateOAuthState,
    generatePkcePair,
} = require("../dist/index.js");

const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
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

test("HaloAuthClient sends project publishable auth requests", async () => {
    await withMockFetch(
        async () => jsonResponse(200, { access_token: "access-1" }),
        async (calls) => {
            const auth = new HaloAuthClient({
                publishableKey: "pk-project",
                haloUrl: "https://halo.test/",
            });

            await auth.signUp({
                email: "user@example.com",
                password: "Secret123!",
                displayName: "Ada",
                redirectTo: "https://app.example.com/auth/confirmed",
                data: { locale: "ko" },
            });
            await auth.signInWithPassword(
                "user@example.com",
                "Secret123!"
            );
            await auth.refreshSession("refresh-1");
            await auth.getUser("access-1");
            await auth.logout("access-1");

            assert.equal(calls[0].url, "https://halo.test/api/v1/auth/signup");
            assert.equal(calls[0].options.headers.apikey, "pk-project");
            assert.equal(
                calls[0].options.headers["x-halo-sdk"],
                "agihalo-node-sdk"
            );
            assert.equal(
                calls[0].options.headers["x-halo-sdk-version"],
                HALO_SDK_VERSION
            );
            assert.deepEqual(JSON.parse(calls[0].options.body), {
                email: "user@example.com",
                password: "Secret123!",
                display_name: "Ada",
                redirect_to: "https://app.example.com/auth/confirmed",
                data: { locale: "ko" },
            });
            assert.equal(
                calls[1].url,
                "https://halo.test/api/v1/auth/token?grant_type=password"
            );
            assert.deepEqual(JSON.parse(calls[2].options.body), {
                refresh_token: "refresh-1",
            });
            assert.equal(
                calls[3].options.headers.Authorization,
                "Bearer access-1"
            );
            assert.equal(calls[4].options.method, "POST");
        }
    );
});

test("HaloAuthClient builds and exchanges provider PKCE flows", async () => {
    await withMockFetch(
        async () => jsonResponse(200, { access_token: "access-1" }),
        async (calls) => {
            const auth = new HaloAuthClient({
                publishableKey: "pk-project",
                haloUrl: "https://halo.test",
            });
            const pkce = generatePkcePair();
            const state = generateOAuthState();

            const authorizeUrl = new URL(
                auth.buildProviderAuthorizeUrl({
                    provider: "google",
                    redirectTo: "https://app.example.com/auth/callback",
                    codeChallenge: pkce.challenge,
                    state,
                })
            );

            assert.equal(
                authorizeUrl.pathname,
                "/api/v1/auth/providers/google/authorize"
            );
            assert.equal(authorizeUrl.searchParams.get("apikey"), "pk-project");
            assert.equal(
                authorizeUrl.searchParams.get("code_challenge_method"),
                "S256"
            );
            assert.equal(authorizeUrl.searchParams.get("state"), state);

            await auth.exchangeProviderCode({
                code: "provider-code",
                codeVerifier: pkce.verifier,
                redirectTo: "https://app.example.com/auth/callback",
            });

            assert.equal(
                calls[0].url,
                "https://halo.test/api/v1/auth/providers/token"
            );
            assert.deepEqual(JSON.parse(calls[0].options.body), {
                code: "provider-code",
                code_verifier: pkce.verifier,
                redirect_to: "https://app.example.com/auth/callback",
            });
        }
    );
});

test("HaloOAuthClient keeps service authorization and token exchange explicit", async () => {
    await withMockFetch(
        async () => jsonResponse(200, { ok: true }),
        async (calls) => {
            const oauth = new HaloOAuthClient({
                clientId: "halo_client_1",
                clientSecret: "secret-1",
                haloUrl: "https://halo.test",
            });
            const pkce = generatePkcePair();

            const authorizeUrl = new URL(
                oauth.buildAuthorizeUrl({
                    redirectUri: "https://service.example.com/callback",
                    scopes: ["profile", "email"],
                    state: "state-1",
                    codeChallenge: pkce.challenge,
                })
            );
            assert.equal(
                authorizeUrl.searchParams.get("scope"),
                "profile email"
            );

            await oauth.authorize("project-user-token", {
                redirectUri: "https://service.example.com/callback",
                scopes: ["profile", "email"],
                state: "state-1",
                codeChallenge: pkce.challenge,
            });
            await oauth.exchangeCode(
                "halo-code",
                "https://service.example.com/callback",
                pkce.verifier
            );
            await oauth.refreshToken("oauth-refresh");
            await oauth.getUserInfo("oauth-access");

            assert.equal(
                calls[0].url,
                "https://halo.test/api/v1/auth/oauth/authorize"
            );
            assert.equal(
                calls[0].options.headers.Authorization,
                "Bearer project-user-token"
            );
            assert.deepEqual(JSON.parse(calls[1].options.body), {
                grant_type: "authorization_code",
                client_id: "halo_client_1",
                code: "halo-code",
                redirect_uri: "https://service.example.com/callback",
                client_secret: "secret-1",
                code_verifier: pkce.verifier,
            });
            assert.deepEqual(JSON.parse(calls[2].options.body), {
                grant_type: "refresh_token",
                client_id: "halo_client_1",
                refresh_token: "oauth-refresh",
                client_secret: "secret-1",
            });
            assert.equal(
                calls[3].options.headers.Authorization,
                "Bearer oauth-access"
            );
        }
    );
});

test("PKCE and OAuth state helpers match the production contract", async () => {
    const pkce = generatePkcePair();
    const expectedChallenge = createHash("sha256")
        .update(pkce.verifier, "ascii")
        .digest("base64url");

    assert.ok(pkce.verifier.length >= 43);
    assert.ok(pkce.verifier.length <= 128);
    assert.equal(pkce.challenge.length, 43);
    assert.equal(pkce.challenge, expectedChallenge);
    assert.ok(generateOAuthState().length >= 22);
    assert.throws(() => generateOAuthState(15), /between 16 and 128/);

    const auth = new HaloAuthClient({ publishableKey: "pk-project" });
    assert.throws(
        () =>
            auth.buildProviderAuthorizeUrl({
                provider: "google",
                redirectTo: "https://app.example.com/auth/callback",
                codeChallenge: "not-a-valid-challenge",
            }),
        /43-character/
    );
    await assert.rejects(
        () =>
            auth.exchangeProviderCode({
                code: "provider-code",
                codeVerifier: "too-short",
                redirectTo: "https://app.example.com/auth/callback",
            }),
        /43-128/
    );
});

test("Authentication errors retain HALO error codes", async () => {
    await withMockFetch(
        async () =>
            jsonResponse(429, {
                error: "Too many authentication requests",
                code: "AUTH_RATE_LIMIT_EXCEEDED",
            }),
        async () => {
            const auth = new HaloAuthClient({
                publishableKey: "pk-project",
            });

            await assert.rejects(
                () => auth.signInWithPassword("user@example.com", "secret"),
                (error) => {
                    assert.ok(error instanceof HaloAPIError);
                    assert.equal(error.statusCode, 429);
                    assert.equal(error.code, "AUTH_RATE_LIMIT_EXCEEDED");
                    return true;
                }
            );
        }
    );
});

test("createClient manages a Supabase-style auth session", async () => {
    const user = {
        id: "user-1",
        projectId: "project-1",
        email: "user@example.com",
        displayName: "Ada",
        status: "active",
        providers: ["email"],
        emailConfirmedAt: "2026-07-30T00:00:00.000Z",
        userMetadata: {},
        appMetadata: {},
        createdAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:00.000Z",
    };
    const makeSession = (suffix) => ({
        access_token: `access-${suffix}`,
        refresh_token: `refresh-${suffix}`,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: "2099-07-30T01:00:00.000Z",
        user,
        session: {
            id: `session-${suffix}`,
            projectId: "project-1",
            authUserId: "user-1",
            expiresAt: "2099-07-30T01:00:00.000Z",
            lastSeenAt: "2026-07-30T00:00:00.000Z",
            revokedAt: null,
            createdAt: "2026-07-30T00:00:00.000Z",
        },
    });
    const stored = new Map();
    const storage = {
        getItem: async (key) => stored.get(key) ?? null,
        setItem: async (key, value) => stored.set(key, value),
        removeItem: async (key) => stored.delete(key),
    };
    let refreshCount = 0;

    await withMockFetch(
        async (url, options) => {
            if (url.includes("grant_type=password")) {
                return jsonResponse(200, makeSession("1"));
            }
            if (url.includes("grant_type=refresh_token")) {
                refreshCount += 1;
                return jsonResponse(200, makeSession("2"));
            }
            if (url.endsWith("/api/v1/auth/user")) {
                return jsonResponse(200, { user });
            }
            if (url.endsWith("/api/v1/auth/logout")) {
                return jsonResponse(200, {});
            }
            return jsonResponse(500, { error: "unexpected request" });
        },
        async (calls) => {
            const halo = createClient(
                "https://halo.test/",
                "pk-project",
                {
                    auth: {
                        autoRefreshToken: false,
                        storage,
                        storageKey: "test-halo-session",
                    },
                }
            );
            const events = [];
            const { data: listener } = halo.auth.onAuthStateChange(
                (event) => events.push(event)
            );

            const signedIn = await halo.auth.signInWithPassword({
                email: "user@example.com",
                password: "Secret123!",
            });
            assert.equal(signedIn.error, null);
            assert.equal(signedIn.data.session.access_token, "access-1");
            assert.equal(
                JSON.parse(stored.get("test-halo-session")).refresh_token,
                "refresh-1"
            );

            const current = await halo.auth.getSession();
            assert.equal(current.data.session.access_token, "access-1");

            const currentUser = await halo.auth.getUser();
            assert.equal(currentUser.data.user.id, "user-1");

            const refreshed = await halo.auth.refreshSession();
            assert.equal(refreshed.data.session.refresh_token, "refresh-2");
            assert.equal(refreshCount, 1);

            const signedOut = await halo.auth.signOut();
            assert.equal(signedOut.error, null);
            assert.equal(stored.has("test-halo-session"), false);
            assert.deepEqual(
                events,
                [
                    "INITIAL_SESSION",
                    "SIGNED_IN",
                    "TOKEN_REFRESHED",
                    "SIGNED_OUT",
                ]
            );
            listener.subscription.unsubscribe();

            const userCall = calls.find(({ url }) =>
                url.endsWith("/api/v1/auth/user")
            );
            assert.equal(userCall.options.headers.apikey, "pk-project");
            assert.equal(
                userCall.options.headers.Authorization,
                "Bearer access-1"
            );
            const logoutCall = calls.find(({ url }) =>
                url.endsWith("/api/v1/auth/logout")
            );
            assert.equal(logoutCall.options.headers.apikey, "pk-project");
            assert.equal(
                logoutCall.options.headers.Authorization,
                "Bearer access-2"
            );
        }
    );
});

test("createClient returns authentication failures as data and error", async () => {
    await withMockFetch(
        async () =>
            jsonResponse(401, {
                error: "Invalid login credentials",
                code: "INVALID_CREDENTIALS",
            }),
        async () => {
            const halo = createClient(
                "https://halo.test",
                "pk-project",
                {
                    auth: {
                        autoRefreshToken: false,
                        persistSession: false,
                    },
                }
            );
            const result = await halo.auth.signInWithPassword({
                email: "user@example.com",
                password: "wrong",
            });
            assert.equal(result.data, null);
            assert.ok(result.error instanceof HaloAPIError);
            assert.equal(result.error.code, "INVALID_CREDENTIALS");
        }
    );
});

test("createClient manages provider PKCE without exposing a client secret", async () => {
    const user = {
        id: "user-1",
        projectId: "project-1",
        email: "user@example.com",
    };
    const session = {
        access_token: "provider-access",
        refresh_token: "provider-refresh",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: "2099-07-30T01:00:00.000Z",
        user,
        session: {
            id: "session-provider",
            projectId: "project-1",
            authUserId: "user-1",
            expiresAt: "2099-07-30T01:00:00.000Z",
            lastSeenAt: "2026-07-30T00:00:00.000Z",
            revokedAt: null,
            createdAt: "2026-07-30T00:00:00.000Z",
        },
    };
    const stored = new Map();
    const storage = {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, value),
        removeItem: (key) => stored.delete(key),
    };

    await withMockFetch(
        async () => jsonResponse(200, session),
        async (calls) => {
            const halo = createClient(
                "https://halo.test",
                "pk-project",
                {
                    auth: {
                        autoRefreshToken: false,
                        storage,
                        storageKey: "test-provider-session",
                    },
                }
            );
            const started = await halo.auth.signInWithOAuth({
                provider: "google",
                options: {
                    redirectTo:
                        "https://app.example.com/auth/callback",
                    skipBrowserRedirect: true,
                },
            });
            assert.equal(started.error, null);
            const authorizationUrl = new URL(started.data.url);
            const state = authorizationUrl.searchParams.get("state");
            assert.equal(
                authorizationUrl.searchParams.get("apikey"),
                "pk-project"
            );
            assert.equal(
                authorizationUrl.searchParams.get(
                    "code_challenge_method"
                ),
                "S256"
            );
            assert.ok(stored.has("test-provider-session-pkce"));

            const exchanged =
                await halo.auth.exchangeCodeForSession(
                    "one-time-code",
                    state
                );
            assert.equal(exchanged.error, null);
            assert.equal(
                exchanged.data.session.access_token,
                "provider-access"
            );
            assert.equal(
                stored.has("test-provider-session-pkce"),
                false
            );
            const body = JSON.parse(calls[0].options.body);
            assert.equal(body.code, "one-time-code");
            assert.match(body.code_verifier, /^[A-Za-z0-9_-]{43,128}$/);
            assert.equal(
                body.redirect_to,
                "https://app.example.com/auth/callback"
            );
            assert.equal(calls[0].options.headers.apikey, "pk-project");
            assert.equal("client_secret" in body, false);
        }
    );
});
