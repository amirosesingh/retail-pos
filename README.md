# Retail POS

Cross-platform point of sale and shop management for sales, shifts, inventory,
membership, receipts, cash drawers, reporting, Windows terminals, and Android.

## Development

The sideloaded iPhone beta build and self-hosted OTA instructions are in
[docs/ios-ota.md](docs/ios-ota.md). Building an IPA does not publish an update.

Use Node.js 22 and npm 11.4.2.

```sh
npm install
npm run dev
```

Validation before release:

```sh
npx tsc --noEmit
npm test
npm run lint
npm run build
```

Supabase is resolved through the operator-configured runtime connection. Device
packages intentionally do not embed web deployment credentials.
