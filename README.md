# Retail POS

Cross-platform point of sale and shop management for sales, shifts, inventory,
membership, receipts, cash drawers, reporting, Windows terminals, and Android.

## Development

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
