# Third-party software notices

ARMPIT is proprietary software (see [LICENSE](LICENSE)). It is built on open-source components that stay under their own licences. This file lists the production dependencies as installed on 2026-11-16 and is provided for attribution; it does not grant any right to ARMPIT's own code.

Nothing in the licences below requires the ARMPIT source code to be published: every component is permissive, or is used in a way that does not extend its licence to ARMPIT (see the notes).

## Direct dependencies

| Package | Version | Licence |
|---|---|---|
| @supabase/ssr | 0.5.2 | MIT |
| @supabase/supabase-js | 2.119.0 | MIT |
| imapflow | 1.7.8 | MIT |
| mailparser | 3.14.5 | MIT |
| next | 15.5.29 | MIT |
| nodemailer | 6.10.1 | MIT-0 |
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| zod | 3.25.76 | MIT |

## Notes

- **LGPL-3.0-or-later** (`@img/sharp-libvips-*`, `@img/sharp-wasm32`): prebuilt image-processing libraries (libvips) that Next.js loads through `sharp`. They are used unmodified, as separate dynamically loaded binaries, which the LGPL permits in proprietary software. Their source and licence are available from the sharp / libvips projects.
- **CC-BY-4.0**: data package `caniuse-lite` (browser support tables). Attribution: "Can I use" data by Alexis Deveria and contributors, licensed CC BY 4.0.
- **(MIT OR EUPL-1.1+)**: dual-licensed; ARMPIT uses these under the MIT option.
- **Singular**: the Singular adapter was written from the documented behaviour of Singular's public Reporting API and the Apache-2.0 licensed client at github.com/singular-labs/singular_api_client (Copyright 2018 Singular Labs, Inc.). No code from that client is included.
- Fonts are loaded from Google Fonts (Inter, SIL Open Font Licence 1.1) at runtime and are not bundled.
- Development-only tools (TypeScript, type definitions, the test SMTP server) are not shipped and are not listed.

## All production packages by licence

### MIT (61)

@emnapi/runtime@1.11.3, @img/colour@1.1.0, @next/env@15.5.29, @next/swc-linux-x64-gnu@15.5.29, @next/swc-linux-x64-musl@15.5.29, @pinojs/redact@0.4.0, @selderee/plugin-htmlparser2@0.12.0, @supabase/auth-js@2.119.0, @supabase/functions-js@2.119.0, @supabase/phoenix@0.4.5, @supabase/postgrest-js@2.119.0, @supabase/realtime-js@2.119.0, @supabase/ssr@0.5.2, @supabase/storage-js@2.119.0, @supabase/supabase-js@2.119.0, @types/cookie@0.6.0, atomic-sleep@1.0.0, client-only@0.0.1, cookie@0.7.2, dom-serializer@2.0.0, encoding-japanese@2.5.0, he@1.2.0, html-to-text@10.0.1, htmlparser2@10.1.0, iceberg-js@0.8.1, iconv-lite@0.7.3, imapflow@1.7.8, ip-address@10.7.6, leac@0.7.0, libbase64@1.4.1, libmime@5.6.5, libqp@3.0.2, linkify-it@6.1.0, mailparser@3.14.5, nanoid@3.3.20, next@15.5.29, on-exit-leak-free@2.1.2, parseley@0.13.1, peberminta@0.10.0, pino@10.3.1, pino-abstract-transport@3.0.0, pino-std-serializers@7.1.0, postcss@8.4.31, process-warning@5.1.1, punycode.js@2.3.1, quick-format-unescaped@4.0.4, react@19.3.1, react-dom@19.3.1, real-require@1.0.0, safe-stable-stringify@2.5.0, safer-buffer@2.1.2, scheduler@0.28.0, selderee@0.12.0, smart-buffer@4.2.0, socks@2.8.9, sonic-boom@4.2.1, styled-jsx@5.1.6, thread-stream@4.2.1, tlds@1.261.0, uc.micro@3.0.0, zod@3.25.76

### Apache-2.0 (5)

@img/sharp-linux-x64@0.35.5, @img/sharp-linuxmusl-x64@0.35.5, @swc/helpers@0.5.15, detect-libc@2.1.2, sharp@0.35.5

### BSD-2-Clause (4)

domelementtype@2.3.0, domhandler@5.0.3, domutils@3.2.2, entities@7.0.1

### ISC (3)

picocolors@1.1.1, semver@7.8.6, split2@4.2.0

### BSD-3-Clause (2)

deepmerge-ts@8.0.2, source-map-js@1.2.2

### LGPL-3.0-or-later (2)

@img/sharp-libvips-linux-x64@1.3.4, @img/sharp-libvips-linuxmusl-x64@1.3.4

### (MIT OR EUPL-1.1+) (1)

@zone-eu/mailsplit@5.4.31

### 0BSD (1)

tslib@2.8.1

### Apache-2.0 AND LGPL-3.0-or-later AND MIT (1)

@img/sharp-wasm32@0.35.5

### CC-BY-4.0 (1)

caniuse-lite@1.0.30001826

### MIT-0 (1)

nodemailer@6.10.1
