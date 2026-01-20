# TrueSpec

**Keep your API specs honest.**

TrueSpec detects drift between your code and your API documentation (OpenAPI / Swagger) and reports breaking changes **before they reach production**.

> This repository contains the **landing page, waitlist, and backend API** for the early access program.

---

## 🚀 What is TrueSpec?

APIs evolve fast. Documentation often doesn’t.

TrueSpec helps teams:
- detect mismatches between code and specs
- catch breaking changes early
- keep OpenAPI documentation aligned with reality

The long-term vision is a **CI-friendly tool** (CLI + GitHub Action) that runs on every pull request.

---

## 🧩 Current features (v0)

- ⚡ Static landing page (Astro)
- 🎨 Brand & marketing pages
- 📬 Waitlist form
- 🔌 Azure Function backend (`/api/waitlist`)
- ☁️ Deployed on Azure Static Web Apps

---

## 🛠 Tech stack

### Frontend
- [Astro](https://astro.build/)
- TypeScript (strict)
- pnpm

### Backend
- Azure Functions (Node.js / TypeScript)
- Azure Static Web Apps integration

### Infrastructure
- Azure Static Web Apps
- GitHub Actions CI/CD

---

## 📁 Project structure

```text
/
├─ src/                # Astro frontend
│  ├─ pages/
│  ├─ components/
│  ├─ layouts/
│  └─ styles/
│
├─ public/             # Static assets (logo, favicon, OG images)
│
├─ api/                # Azure Functions
│  └─ waitlist/        # POST /api/waitlist
│
├─ .github/workflows/  # CI/CD
└─ astro.config.mjs
````

---

## 🧪 Local development

### Prerequisites

* Node.js 18+
* pnpm
* Azure SWA CLI (optional)

```bash
pnpm install
pnpm dev
```

Frontend will be available at:

```
http://localhost:4321
```

### Run frontend + API together (recommended)

```bash
pnpm add -g @azure/static-web-apps-cli
swa start http://localhost:4321 --api-location api
```

---

## 📬 Waitlist API

**Endpoint**

```
POST /api/waitlist
```

**Form fields**

* `email` (required)

The current implementation stores emails locally for MVP purposes.
This will be replaced by a persistent storage (Blob / DB) in later versions.

---

## 🚧 Roadmap (short)

* [ ] OpenAPI diff engine (CLI)
* [ ] GitHub Action
* [ ] CI annotations for breaking changes
* [ ] Dashboard (later)
* [ ] Spec history & reports

---

## 🧠 Philosophy

* Dev-first
* No lock-in
* CI-friendly
* Opinionated but transparent

---

## 🔐 Security & privacy

* Emails are used **only** for early access communication
* No tracking, no ads
* GDPR-friendly by design

---

## 📄 License

TBD (likely MIT / Apache-2.0 for tooling, commercial for hosted services).

---

## ✉️ Contact / Early access

👉 Join the waitlist at
**[https://truespec-app.com](https://truespec-app.com)**

---

Built with ❤️ for developers who are tired of broken docs.
