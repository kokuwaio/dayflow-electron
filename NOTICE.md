# Third-party notices

This project reuses code and prompts from two MIT-licensed projects. Their
copyright notices are kept here as the MIT license requires.

## Dayflow (macOS)

- Source: https://github.com/JerryZLiu/Dayflow
- Copyright (c) 2025 Jerry Liu
- Used: prompts, feature design, data model ideas.

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
