const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
    HALO_SDK_VERSION,
    HaloAPIError,
    HaloAuthClient,
    HaloOAuthClient,
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
