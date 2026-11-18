# Third-party notices

This project reuses code and prompts from two MIT-licensed projects. Their
copyright notices are kept here as the MIT license requires.

## Dayflow (macOS)

- Source: https://github.com/JerryZLiu/Dayflow
- Copyright (c) 2025 Jerry Liu
- Used: prompts, feature design, data model ideas, and the translations of
  its string catalog (`Localizable.xcstrings`), which the UI translations in
  `src/shared/locales` start from.
- Also used: its Codex plugin (`plugins/dayflow`, MIT), whose skills and MCP
  launcher `plugins/dayflow-electron/` adapts.

## dayflow-windows

- Source: https://github.com/shawkatdidar/dayflow-windows
- Copyright (c) 2026 Shawkat Muslimwal
- Used: analysis loop, providers, settings and key storage.

Both are licensed under the MIT License; the full license text is in
[LICENSE](LICENSE).

## BIP-0039 English word list

- Source: https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt
- Copyright (c) 2013 Marek Palatinus, Pavol Rusnak, Aaron Voisine, Sean Bowe
- Used: the 2,048-word list in `src/main/privacy/bip39-english.ts`, to spot
  wallet recovery phrases when hiding secrets in screenshots.
- License: MIT (as stated in BIP-0039).

## Bundled fonts and icons

The window bundles these, each under its own license; the full texts are in
[licenses/](licenses/) and ship with the app.

| What | Source | License | Text |
| --- | --- | --- | --- |
| Figtree (variable) | `@fontsource-variable/figtree` 5.3.0, https://github.com/erikdkennedy/figtree, Copyright 2022 The Figtree Project Authors | SIL Open Font License 1.1 | [licenses/Figtree-OFL.txt](licenses/Figtree-OFL.txt) |
| Inter (variable), Modern theme | `@fontsource-variable/inter` 5.3.0, https://github.com/rsms/inter, Copyright 2016 The Inter Project Authors | SIL Open Font License 1.1 | [licenses/Inter-OFL.txt](licenses/Inter-OFL.txt) |
| Instrument Serif | `@fontsource/instrument-serif` 5.3.0, https://github.com/Instrument/instrument-serif, Copyright 2022 The Instrument Serif Project Authors | SIL Open Font License 1.1 | [licenses/InstrumentSerif-OFL.txt](licenses/InstrumentSerif-OFL.txt) |
| Lucide icons | `lucide-react` 1.66.0, https://lucide.dev, Copyright (c) 2026 Lucide Icons and Contributors; some icons derived from Feather, Copyright (c) 2013-present Cole Bemis | ISC (Feather-derived icons: MIT) | [licenses/Lucide-ISC.txt](licenses/Lucide-ISC.txt) |

Upstream Dayflow's own artwork (name, logo, icons, illustrations, videos) is
not used; the look is rebuilt with these icons and CSS.
