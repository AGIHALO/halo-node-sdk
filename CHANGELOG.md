# Changelog

## 0.2.0 - 2026-07-29

- Added production Project Authentication and upstream identity-provider
  clients.
- Added OAuth App authorization-code, PKCE, refresh, and user-info clients.
- Added direct long-term Memory capture, retrieve, delete, function, and
  connection-preview helpers.
- Added secure PKCE and OAuth state generators.
- Added HALO error-code preservation and SDK version request headers.
- Updated x402 signing for CAIP-2 networks and both normalized and nested price
  requirements.
- Changed automatic x402 retries to preserve the original model request and to
  use the server-provided payment recipient instead of a hardcoded model retry.
- Updated product examples to the production OpenAI-compatible endpoint and
  current dashboard URL.

## 0.1.0

- Published the initial x402 payment helper release.
