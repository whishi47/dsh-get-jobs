<div align="center">

<img src="assets/logo.png" width="132" alt="dsh-get-jobs logo" />

# Stop clicking "Say Hi" a hundred times a day.

**dsh-get-jobs** turns job applications on **Boss Zhipin / Liepin / 51job / Zhaopin**
into one visual dashboard inside DeepSeek Harness.

**One command to install · no database server · no build step · no manual backend startup · every application logged**

**English** · [简体中文](README.md) · [Changelog](CHANGELOG.md) · [FAQ](#-faq-read-this-first-if-youre-stuck)

</div>

![status](https://img.shields.io/badge/status-beta-orange.svg)
![build](https://img.shields.io/badge/build-none-brightgreen.svg)
![PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20-green.svg)
![JDK](https://img.shields.io/badge/JDK-21-orange.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Spring Boot](https://img.shields.io/badge/Spring%20Boot-6DB33F?logo=springboot&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?logo=sqlite&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?logo=playwright&logoColor=white)
![DSH](https://img.shields.io/badge/DeepSeek%20Harness-plugin-9cf.svg)

> This is the English documentation. The repository is a personal open-source project by **mattan**, published under **PolyForm Noncommercial 1.0.0**: personal learning, study and assisting your own job search are allowed; **commercial use is prohibited**. See [Disclaimer](#-before-you-use-read-these-four-lines).

---

## What does it actually do? (Plain English)

> You tell it *"these job titles, in this city, skip these companies"*. It scans four job boards, sends your greeting to matching positions, records every single application in a table, and lets you export that table to Excel.
> You can watch it, change it, and stop it at any time — all from one dashboard.

You do **not** write code. You do **not** install a database, compile Java, start a browser, or keep a terminal open. On first launch the plugin **downloads and starts the backend by itself**. When the status turns "Ready", you are good to go.

### Without this plugin

| Step | The annoying part |
| --- | --- |
| Find jobs | Switch between four apps, type the same keywords four times, skip companies you already applied to |
| Send greetings | Click one by one, copy-paste the same opening line, rewrite it manually if you want it to sound relevant |
| Track progress | Notes app, spreadsheet, or memory — two days later you cannot remember who replied |
| Change criteria | New city / keyword / salary? Start the whole search again |
| Run automation scripts | Install a JDK, a database, compile, launch a browser, debug errors… |

### With this plugin

| That task | Now |
| --- | --- |
| Find jobs | Fill in keywords + city + salary once in **Delivery Config**; all four platforms use the same criteria |
| Send greetings | Write one default greeting, or click **AI Polish**; optionally attach an image resume |
| Track progress | Every application lands in **Data** automatically; filter by platform, export to Excel |
| Change criteria | Edit one field and hit Start again |
| Run the environment | **Nothing to do.** It downloads, starts, and restarts itself |

---

## 🖥️ Six screens, explained without jargon

| Screen | What you do here |
| --- | --- |
| **Overview** | Is the backend alive? System healthy? Any errors? |
| **Delivery Config** | Job keywords, city, salary, which platforms; default greeting (with one-click **AI Polish**); upload an image resume; keep a company blacklist |
| **Run** | Press Start to apply with your criteria, press Stop whenever. Set **how many to send today** (one total, plus one per platform) and it stops by itself once reached; crashes auto-retry at 3s / 10s / 30s |
| **Data** | All applied positions in one table, filter by platform, export xlsx (single platform or all four merged) |
| **Resume** | Upload PDF / DOCX / TXT / MD, let an LLM draft your delivery config, preview, edit, save it back |
| **Settings** | AI key / endpoint / model, company blacklist with CSV export, system status and diagnostics |

> 🗄️ Everything is stored in **one local SQLite file** (`db/getjobs.db`). **No database server needed.** Your resume is not sent to any server of ours — AI requests go to the endpoint **you** configure.

---

## ✅ Is this for you? (Honest answer)

**Yes, if:** you are mass-applying and repeating the same search / click / note-taking every day; you already use DeepSeek Harness and want your job search in the same workspace; you are willing to spend a few minutes on one-time setup.

**No, if:** you expect "one click → job offer" (this is an **efficiency tool**, it does not guarantee interviews); you want zero configuration (**you must log in to the platforms yourself**, and supply your own AI key); you plan to use it for commercial services, mass-applying on behalf of others, or selling accounts (**explicitly prohibited**); or you cannot install JDK 21 and Node 20.

---

## ⚠️ Risk & disclaimer (read this first)

> **This tool applies to jobs by driving a real browser and simulating mouse clicks and keystrokes. It cannot guarantee that your account will not be rate-limited, restricted, or banned. If that is a problem for you, please do not install or use it.**

### Account risk — there is no "safe" setting

- Every application is a real browser session: open the job page → click "Say hi" → type text → send an image resume. That is **simulated clicking**, not an official platform API.
- Job platforms generally discourage automation. Possible consequences: more CAPTCHAs, rate-limited greetings, restricted features, temporary or permanent bans.
- Lower frequency only lowers the probability; **it does not remove the risk**. There is no safe threshold.
- If the account matters to you, **do not point any automation tool at it**.

### No guarantees about outcomes

- No guarantee of a successful application, a reply, an interview, or an offer.
- No guarantee that job data is complete or accurate — it comes from scraping pages and can break when a platform redesigns its UI.
- No guarantee that AI greetings, resume scores, or suggestions are correct or free of fabrication. **Review before sending.**

### Responsibility & affiliation

- Using this project means you accept these risks. Account penalties, data loss and disputes are your responsibility, not the author's.
- This project is **not affiliated with, endorsed by, or partnered with** Boss Zhipin, Liepin, 51job or Zhaopin. Names and trademarks belong to their owners.
- Follow platform terms and local law. **Commercial use is prohibited** (see [License](#-license)).

---

## 🔐 Security & privacy

### Where data lives (all on your machine)

| Data | Location | Note |
| --- | --- | --- |
| AI key & model config | `config` table in `db/getjobs.db` | **Plain text** — anyone who can read the file can read the key |
| Applications & job data | The same SQLite file | Company names, job titles, salaries |
| Image resume / long image | `data/boss/resume/resume.*` | Plain image files |
| Logs | `target/logs/get-jobs.log` | Redacted, but may still contain job/company names |
| Platform login state | `browser-data/` (Playwright profile) | **Equivalent to your account credentials** |

> ⚠️ Never share `db/getjobs.db`, `browser-data/` or `data/`. Screenshot the config instead.

### What goes over the network

| Target | When | Content |
| --- | --- | --- |
| The AI endpoint **you** configure (default `api.deepseek.com`) | AI greetings / resume parsing / evaluation / polish | Resume text, job description, your intro |
| Job platforms | Login, search, apply | Your account actions and chats |
| GitHub Release | First launch | No user data |

Nothing else is uploaded. No telemetry; the author cannot see your data.

### Local service boundary

- The backend binds `127.0.0.1:9527` only — not LAN, not the internet.
- It has **no authentication**: any local process can call it (including reading plaintext config). That is a common trade-off for local tools; evaluate it if your machine runs untrusted software.
- Never expose port 9527 through a reverse proxy or tunnel.

### The source is plain text

The plugin is plain TypeScript/JavaScript and the backend is plain Java. You can audit it — and so can anyone who can modify the files. Install only from this repository or the official release.

---

## 📌 Known limits

- **Beta**: the version is `0.x`; config keys and endpoints may change. Check [CHANGELOG](CHANGELOG.md) before upgrading.
- **Platform redesigns break it**: selectors and fields are page-dependent, not a stable API.
- **The long image is reflowed text**, not a designed resume template; very long resumes shrink or truncate.
- **AI output is advisory**: greetings, scores and suggestions can be wrong — read before sending.
- **Verified mainly on Windows + JDK 21 + Node 20**; macOS/Linux not fully regression-tested.

---

## 🚀 Install in three steps

### Step 0 — Check two things on your machine

```bash
java -version    # needs JDK 21
node -v          # needs Node 20 or newer
```

- No JDK? Install **JDK 21** and set `JAVA_HOME` (or set `javaHome` in config).
- No Node? Install **Node 20+** (`engines` in `package.json` is `>=20`).
- Network: first launch downloads the backend (~265MB) from GitHub Release — once only.

### Step 1 — One command

```bash
dsh plugin --profile web add "github:whishi47/dsh-get-jobs#master"
```

> 💡 **No clone, no `npm install`, no compile.** Prebuilt `lib/` ships with the repository, so the plugin loads even when the installer blocks build scripts; `scripts/prepare.mjs` only rebuilds if an artifact is missing.

### Step 2 — Wait for first-time setup

```text
download backend.jar (~265MB) → download SQLite template (136KB, schema only, no data)
→ cache locally → java -jar starts the backend → status becomes "Ready"
```

It is cached afterwards, so **later runs work offline**. Playwright's browser is downloaded by the backend on the first delivery run.

### Step 3 — First-use checklist (in this order)

1. **Settings → AI**: paste your own AI key / endpoint / model (without it, AI greetings and resume parsing do not work)
2. **Resume**: upload a PDF / Word resume, review the generated draft, save it back
3. **Delivery Config**: keywords, city, salary, platforms; write a default greeting (try **AI Polish**); upload an image resume here if you want to send one
4. **Run**: press Start, watch the status, stop whenever
5. **Data**: review what was sent, export Excel; add companies you want to skip under **Settings → Blacklist**

---

## ❓ FAQ (read this first if you're stuck)

| Question | Answer |
| --- | --- |
| Stuck on "Downloading backend" | First run pulls 265MB — give it time. If GitHub is slow, download `backend.jar` manually and set `jarPath`, or point `jarUrl` / `dbUrl` to a reachable mirror |
| Status never becomes "Ready" | Usually the JDK. Check `java -version` is 21, or set `javaHome` explicitly |
| "Backend jar not found" | It downloads from GitHub Release by default; you can also build `backend/` and set `jarPath` |
| AI greeting missing or weird | Verify key / endpoint / model under **Settings → AI**; try **AI Polish** on a short greeting in **Delivery Config** |
| "Send image resume" checked but nothing sent | You must **upload** the image first in **Delivery Config** (a thumbnail appears when it worked). The checkbox alone does nothing |
| Do I need MySQL / Redis? | No. One SQLite file, that's it |
| Is my resume / key uploaded somewhere? | Data stays local; AI calls go to **your** configured endpoint. Never share the runtime `db/getjobs.db` — it may contain your config |
| Why were some jobs not delivered? | The Run page shows "today N failed" plus the main reasons — usually the posting is closed (no chat button) or the send button never rendered. Open the Data page to see which jobs, and export them if you want to follow up manually |
| Why did it stop by itself? | Three cases: daily target reached, outside the allowed hours, or a platform security check (cooldown). The Run page always states the reason |
| How do I cap how many I send per day? | On the **Run** page, set a total (e.g. 30) and/or a number per platform (e.g. Boss 20, Liepin 10; `0` means no per-platform cap). **Whichever limit is hit first wins** — it stops there. Changes apply immediately, no restart |
| Will my account get banned? | There is a risk. Keep the frequency low, follow platform rules, do not use it for mass-applying on behalf of others |
| I want to modify the code | See **Developer mode** below; clone and run `npm install --legacy-peer-deps` |
| macOS / Linux? | The panel is a web UI and the backend is Java. JDK 21 + Node 20 are enough; adjust paths for your OS |

---

## ✨ Feature list (full)

| Group | Capability | Detail |
| --- | --- | --- |
| **Zero effort** | One-click backend | Probes `/api/health`, starts `java -jar` if down, falls back to `gradlew` build if the jar is missing |
| **Zero effort** | Auto restart | 3s / 10s / 30s backoff, up to 3 attempts, counter resets after a healthy start |
| **Zero effort** | Clean shutdown | Only kills processes **this plugin started**; your own running instance is untouched |
| **Zero effort** | Visible status | Health endpoint for the panel, redacted log tail for diagnostics |
| **Delivery** | Four platforms | Boss Zhipin / Liepin / 51job / Zhaopin, per-platform fields, single-column layout when a form is short |
| **Delivery** | AI greeting | One-click polish of the default greeting; backend can generate a job-aware greeting |
| **Delivery** | Image resume | Upload a resume image and send it along with the greeting |
| **Delivery** | Blacklist | Paginated company blacklist (10/page) + CSV export (with BOM, opens cleanly in Excel) |
| **Delivery** | Daily target | Two-level quota: a combined total plus per-platform caps; **any one reaching its limit stops the run**. Optional working-hours window (e.g. `9-23`). Today's progress and a reset button live on the Run page |
| **Delivery** | Company cooldown | Same company at most once every N days (`DELIVERY_COMPANY_COOLDOWN_DAYS`, 0 = off), so one employer doesn't get hit from five postings |
| **Delivery** | Failure reasons | Jobs that couldn't be delivered are grouped by reason (no chat button / no send button / bad link…); the Run page shows today's count and the top reasons |
| **Delivery** | Risk cooldown | If the platform throws a security check, it cools down for N minutes (30 by default) and refuses to start; the Run page shows the countdown and lets you clear it |
| **Settings** | Config backup | Export every setting as JSON (secrets blanked by default) and import it on another machine. Empty values never overwrite your existing key |
| **Settings** | Daily report | Pushes a short summary (how many sent, how many tokens spent) to WeCom at a fixed time, or on demand |
| **Data** | Job table | Normalized positions, single-platform or four-platform merge, streamed xlsx export |
| **Resume** | Parse & draft | PDF / DOCX / TXT / MD → LLM config draft → preview & edit → write back |
| **Panel** | Six native screens | Overview / Delivery Config / Run / Data / Resume / Settings — no iframe, no extra port, every screen scrolls |
| **Chat** | Start/stop in chat | Backend status and control tools, guarded by the `mutations` gate (confirmation required by default) |

---

## 📂 What's in the repository

```text
dsh-get-jobs/
├── assets/
│   └── logo.png             # project icon
├── src/
│   ├── client/              # browser half: React native panel (six screens)
│   │   ├── App.tsx
│   │   ├── theme.ts
│   │   └── pages/           # Overview / Delivery Config / Run / Data / Resume / Settings
│   ├── backend/             # backend hosting: probe / start / restart / download
│   │   ├── provision.ts     # jarUrl / dbUrl sources + download
│   │   ├── supervisor.ts    # process supervision + auto restart
│   │   └── jdk.ts           # JDK 21 detection
│   ├── config.ts            # plugin config schema
│   ├── layout.ts            # backend project auto-discovery
│   └── api/                 # backend API wrappers
├── backend/                 # Java / Spring Boot backend source (JDK 21)
├── lib/                     # prebuilt artifacts (shipped so public installs just work)
│   ├── index.js / index.d.ts
│   ├── client.js            # browser half (ModuleLoader wrapper)
│   └── backend/             # Node half compiled output
├── scripts/prepare.mjs      # install fallback: skip when artifacts exist, rebuild only if missing
├── test/                    # Node + real browser mount tests
├── cordis.patch.yml         # plugin row injection layer
├── CONTRIBUTING.md          # contribution guide (PR flow / commit convention)
├── CHANGELOG.md             # changelog
├── README.md                # Chinese documentation
├── README.en.md             # English documentation (this file)
├── package.json
└── LICENSE
```

---

## ⚙️ Configuration (most people never touch this)

Defaults just work. Change something only if your JDK is in a non-standard place, GitHub is unreachable, or your backend runs on another port.

Override by id in your profile's `cordis.patch.yml`:

```yaml
- id: dsh-get-jobs
  name: dsh-get-jobs
  config:
    baseUrl: 'http://127.0.0.1:9527'
    javaHome: 'C:/Program Files/Java/jdk-21'
    autostart: true
    mutations: confirm
```

| Field | Default | Change it when |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:9527` | Your backend uses another port |
| `jarUrl` | `backend.jar` on GitHub Release | GitHub is slow; point to a mirror |
| `dbUrl` | `getjobs.db.template` on GitHub Release | Same as above |
| `dataDir` | `<DSH_HOME\|~>/.dsh/get-jobs` | You want downloads elsewhere |
| `jarPath` | auto | You already have a local jar and want to skip downloading (easiest) |
| `projectDir` | auto-discovered | You want to pin the backend source directory |
| `javaHome` | auto-detected JDK 21 | JDK not found, or several versions installed |
| `autostart` | `true` | You don't want the backend to start as soon as the plugin loads |
| `timeoutMs` | `15000` | Backend is slow and requests time out |
| `mutations` | `confirm` | Start/stop policy: `confirm` needs `confirm: true`, `deny` blocks, `allow` permits |

> 🌏 Both the jar and the DB template are downloaded directly from **GitHub Release** and cached after the first run. If GitHub is unreliable, set `jarUrl` / `dbUrl` to a reachable address, or use `jarPath` to skip downloads entirely.

---

## 🛠️ Developer mode

```bash
dsh plugin --profile <profile> add /path/to/dsh-get-jobs   # absolute path to this repo
dsh --profile <profile> --dump-config | grep dsh-get-jobs   # expect "# == dsh-get-jobs"
```

`cordis.patch.yml` inserts the plugin row into the config layer; `dsh.bundle.patch` in `package.json` points to it.

```bash
npm install --legacy-peer-deps
npm run build      # tsc (Node half) + esbuild (browser half)
npm run gates      # package name / patch / exports / deps / artifacts / client / README checks
npm test           # Node + real browser mount assertions
npm run check      # build + gates + test in one go
```

> 📌 **Rules learned the hard way**: the panel must have a **real mount test** (a build check alone proves nothing); the error boundary must sit **above** the panel; register slots with `ctx.inject(['slots'], …)` so a failure only drops the panel and never blocks boot; always write `package.json` as UTF-8 without BOM.

---

## 🚀 Releasing a new backend

The Java / Spring Boot source (JDK 21) lives in this repository under [`backend/`](backend/README.md). For every backend change:

1. **Build** (JDK 21):
   ```bash
   cd backend
   ./gradlew bootJar --no-daemon
   ```
2. **Stage artifacts**: copy `backend/build/libs/*.jar` to `release-assets/backend.jar`. `backend/assets/getjobs.db.template` contains schema only — copy it as `release-assets/getjobs.db.template`. (**Never** use the runtime `db/getjobs.db`; it may contain API keys and login state.)
3. **Upload**: `gh release upload v0.1.0 release-assets/backend.jar release-assets/getjobs.db.template --clobber`
4. For a new version, tag it (e.g. `v0.3.1`) and update `CHANGELOG.md`.

> At runtime the plugin fetches both files from GitHub Release; override `jarUrl` / `dbUrl` for mirrors, or use `jarPath` for a local jar.

---

## 🤝 Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and commit convention.

## 📑 Changelog

All notable changes are in [CHANGELOG.md](CHANGELOG.md).

## 📜 License

- **License**: [PolyForm Noncommercial 1.0.0](LICENSE). **Commercial use is explicitly prohibited.** Non-commercial use, copying, modification and redistribution for personal learning, technical study, and assisting your own job search are permitted.
- **Commercial use** requires prior written permission from the author.
- **Attribution**: redistribution must keep the author credit (mattan) and the license notice.

---

<div align="center">

Copyright © 2026 mattan. All Rights Reserved.

</div>
