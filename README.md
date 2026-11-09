# Koban (小判) for Windows

A modern, minimalist paper-and-ink budgeting and business expense application for **Home Budgets** and **Freelancers**, oriented on the design system of **ZenPDF**. Built with **Tauri v2 (Rust + SQLite)** and **React 19 + TypeScript + Tailwind CSS v4**.

> 🍎 The native **macOS version (Swift + SwiftUI)** lives in its own repository, [koban-mac](https://github.com/duck28/koban-mac). It reads and writes the same encrypted `koban.db`; the shared WebDAV sync format is specified in [docs/WEBDAV-SPEC.md](docs/WEBDAV-SPEC.md).

---

## ✨ Features

- **🎨 Zen Paper & Ink Design**:
  - Warm "Washi" light mode and "Sumi" dark mode with vermilion seal (`#b9432f`), moss green (`#3f704d`), and indigo dye (`#3f6e8c`) accents.
  - Collapsible sidebar (`Ctrl+B`), tabular financial typography, and keyboard-first navigation (`1`–`7`).
- **🏠 Home Budget + 💼 Freelancer Business Modes**:
  - Interactive setup wizard to choose **Home Budget**, **Freelancer / Business**, or **Both**.
  - Instant top-bar switching between **Home**, **Freelancer**, and **Combined** views.
  - Freelancer support for **VAT / Sales Tax rates**, **Tax-Deductible %** (`100%`, `50%`, `0%`), **Client / Project**, and **Invoice references**.
- **✅ Interactive Category Selection & Customization**:
  - Core categories across all 10 Home groups and 8 Freelancer groups come **pre-checked** during setup so you can easily deselect any you don't need.
  - Additional curated categories are available alongside them to check with one click, plus inline custom category creation.
  - Full **Categories & Structure** view to add, rename, recolor, reorder, or remove groups and categories anytime.
- **📊 2-Column Monthly Budget Worksheet**:
  - Edit **Budget** and **Actual** amounts directly inline in a 2-column worksheet layout, or log itemized transactions that automatically roll up into your monthly actuals.
- **📈 Reports, Breakdowns & Charts**:
  - Outflow Breakdown Donut Chart, Budget vs. Actual Horizontal Comparison Bars, 12-Month Annual Cashflow Trajectory, Top Expense Drivers, and Freelancer VAT & Tax Reserve Summary.
- **🔒 AES-256-GCM Encrypted SQLite Database & Automatic Backups**:
  - Every financial record in `koban.db` (`encrypted_vault` and `encrypted_records`) is encrypted at rest using **AES-256-GCM** with unique 96-bit random nonces per row and salted SHA-256 key derivation, plus an optional custom vault passphrase.
  - Automatic background backups (`koban-latest.db` + rolling `.db` snapshots) to any user-chosen folder path remain fully encrypted at rest.
- **📥 Import Data & 📤 External Excel (`.xlsx`) / CSV (`.csv`) Exports**:
  - Dedicated **Import Data** workflow (`Ctrl+I`) supporting:
    - **Monthly Budget Sheets** (`.xlsx`, `.xls`, `.csv` — both 2-column and flat category layouts)
    - **Transactions & Bank Statements** (`.csv`, `.xlsx`, `.xls` with smart column matching)
    - **Encrypted Database Backups** (`.db`, `.sqlite`, `.json` with optional passphrase)
  - Export multi-sheet `.xlsx` Excel workbooks, 2-column `.csv` monthly budget sheets, or full transaction & tax `.csv` files anywhere on disk.

---

## 🚀 Quick Start

```bash
cd koban
npm install
npm run tauri dev
```

---

## 📦 Releases

Pushing a version tag builds the Windows installers on GitHub Actions and publishes them as a GitHub Release ([`.github/workflows/release.yml`](.github/workflows/release.yml)):

```bash
git tag v1.2.0
git push origin v1.2.0
```

The tag sets the app version (plain `vMAJOR.MINOR.PATCH`, as required by MSI).
