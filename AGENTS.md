This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## This project: Alerta Mendoza

Weather-risk app for Mendoza (Argentina): hail, storms, lightning, wind/Zonda. UI text is in Spanish (Argentina).

### Layout (npm workspaces)

- Root = the Expo app (`src/`). Keep it at the root: `npx expo start` and EAS run from here.
- `packages/core` (`@alerta/core`): all data parsing, storm tracking, the risk engine and notification rules. **No React Native imports** — it must run in Node (server, tests). App-specific wiring goes in `src/setup.ts` (storage, web proxy) and `src/sources.ts` (API vs direct).
- `mcp` (`@alerta/mcp`): MCP server (Streamable HTTP on port 8788, plus stdio). It is a thin client of the REST API — never fetch upstream sources from here. Every tool result must keep the source terms (`USAGE_TERMS`).
- `server` (`@alerta/server`): Hono API with OpenAPI generated from Zod schemas (`server/src/schemas.ts`). Response shapes are a public contract: change the schema, the serializer and the tests together.

### Verify every change

```bash
npm run check   # typecheck all workspaces + expo lint + vitest
```

### Fragile upstream sources (read before touching `packages/core/src`)

- **SMN CAP feed** (`smn.ts`): rate-limits with HTTP 429 when many files are fetched; times are labelled `-03:00` but are actually UTC; each alert is published twice in different batches. Tests in `packages/core/test/smn.test.ts` pin all three behaviours.
- **DCC radar** (`radar.ts`, `radarMath.ts`): 500 x 700 PNG mosaic, Web Mercator, bounds copied from the official viewer. The cordillera produces ground clutter: isolated pixels are filtered (`support`), and storm motion is only reported when two frame comparisons agree and match the regional flow (`stormMotion.ts`).
- Don't change risk thresholds or notification rules without updating `engine.test.ts` / `decide.test.ts`.
- Test fixtures under `packages/core/test/fixtures` are real radar frames and real-format CAP files; prefer adding fixtures over mocking internals.
