# Vendored dependencies

| File | Source | SHA-256 | License |
|---|---|---|---|
| `xlsx-0.20.3.tgz` | <https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz> (SheetJS Community Edition) | `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8` | Apache-2.0 |

SheetJS stopped publishing to the npm registry after 0.18.5, which is affected by CVE-2023-30533 (prototype pollution, fixed in 0.19.3) and CVE-2024-22363 (ReDoS, fixed in 0.20.2). Koban parses user-supplied `.xlsx` / `.xls` / `.csv` files with it, so the patched build is vendored here and referenced from `package.json` as `file:vendor/xlsx-0.20.3.tgz`. This works with npm 12, which refuses remote tarball URLs by default.

To upgrade: download the new tarball from `https://cdn.sheetjs.com/`, check that its `package.json` has no install scripts, replace the file, update the table above, and run `npm install ./vendor/xlsx-<version>.tgz`.
