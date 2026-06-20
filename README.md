# FacadeFlow

BOQ and quotation system for a glass and aluminium fabrication company in Dubai.

## Getting Started

```bash
npm install
npm run dev
```

## How to start the website locally

**Option 1 — Double-click (Windows)**

1. Double-click `start-website.bat` in the project root.
2. Wait for the dev server to start.
3. Open [http://localhost:3000](http://localhost:3000) in your browser.

**Option 2 — Command line**

```bash
npm.cmd run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

**Option 3 — VS Code / Cursor**

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Run **Tasks: Run Task**.
3. Choose **Start Facade Takeoff Website**.
4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard — overview stats and recent quotations |
| `/quotations/create` | Create Quotation — BOQ form |
| `/products` | Products — product catalogue |
| `/quotations` | Quotations List — all quotations |

## Project Structure

```
src/
├── app/                  # Next.js App Router pages
│   ├── page.tsx          # Dashboard
│   ├── products/
│   └── quotations/
├── components/
│   ├── layout/           # Sidebar, Header, AppShell
│   ├── dashboard/
│   ├── products/
│   ├── quotations/
│   └── ui/               # Button, Badge
└── data/
    ├── models/           # TypeScript types (Product, Quotation)
    ├── sample-products.ts
    └── sample-quotations.ts
```

## Tech Stack

- **Next.js 15** (App Router)
- **TypeScript**
- **Tailwind CSS 4**

No database or AI integration yet — frontend structure and navigation only.

## Deployment Notes

- Auto-deploy verification heartbeat commit: 2026-06-21.
