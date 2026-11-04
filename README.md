> **项目声明**
> 本项目为个人开源，**仅供个人学习交流、参考研究与辅助求职投递使用，禁止任何商业用途**。
> 协议与转载要求详见 [许可证](#许可证)；二次发布请保留本声明与作者署名。

# dsh-get-jobs · 求职自动投递插件

> **把 Boss / 猎聘 / 51job / 智联 的自动投递后端接进 DeepSeek Harness，打开面板即用。**
> 不再需要手动起后端、开浏览器、配环境。

![PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)
![JDK](https://img.shields.io/badge/JDK-21-orange.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Spring Boot](https://img.shields.io/badge/Spring%20Boot-6DB33F?logo=springboot&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?logo=sqlite&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?logo=playwright&logoColor=white)
![DSH](https://img.shields.io/badge/DeepSeek%20Harness-集成-9cf.svg)

---

## ⚠️ 使用须知

- 🚫 **禁止商用**：本项目仅限个人学习交流、技术参考与辅助求职投递，**不得用于任何商业目的**。
- 📚 **学习参考**：代码与文档供研究、学习之用，使用风险由使用者自行承担。
- 🤝 **辅助投递**：旨在帮助求职者更高效地管理投递流程，请遵守各招聘平台规则，合理使用、避免滥用。
- ⚖️ **责任声明**：因使用本项目产生的任何后果（含账号风控、投递纠纷）由使用者自行承担，作者不承担责任。

## 📑 目录

- [使用须知](#使用须知)
- [功能特性](#功能特性)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [配置](#配置)
- [开发](#开发)
- [参与贡献](#参与贡献)
- [更新日志](#更新日志)
- [许可证](#许可证)

---

## ✨ 功能特性

| 能力 | 说明 |
| --- | --- |
| 🚀 一键后端 | 探测后端健康，未就绪则自动 `java -jar` 拉起；缺失 jar 时回退 `gradlew` 构建 |
| 🔄 自动重启 | 进程意外退出按 3s / 10s / 30s 退避重试，最多 3 次，成功就绪后计数归零 |
| 🧹 干净清理 | 只终止**本插件拉起**的进程，外部已运行实例不受影响 |
| 📊 状态可见 | `/api/health` 供面板读取，日志尾部自动脱敏后供诊断 |
| 💬 对话启停 | 提供后端状态 / 启停工具，聊天里即可操作（受 `mutations` 闸门约束） |
| 🖥️ 原生面板 | 概览 / 投递配置 / 运行 / 数据 / 简历 / 设置 六页，无 iframe、无额外端口 |
| 📤 数据导出 | 归一化岗位表，支持单平台与四平台合并，xlsx 流式写出 |
| 📄 简历解析 | PDF / DOCX / TXT / MD → 大模型出 AI 配置草稿 → 预览编辑 → 一键写回 |

> 🗄️ 数据库为 SQLite 单文件 `db/getjobs.db`，**无需安装任何数据库服务**。

---

## 📂 项目结构

```text
dsh-get-jobs/
├── src/
│   ├── client/              # 浏览器半边：React 原生面板（6 页）
│   │   ├── App.tsx
│   │   ├── theme.ts
│   │   └── pages/           # 概览 / 投递配置 / 运行 / 数据 / 简历 / 设置
│   ├── backend/             # 后端托管：探测 / 拉起 / 重启 / 下载
│   │   ├── provision.ts     # jarUrl / dbUrl 三级来源 + 下载
│   │   ├── supervisor.ts    # 进程监管与自动重启
│   │   └── jdk.ts           # JDK 21 探测
│   ├── config.ts            # 插件配置 schema
│   ├── layout.ts            # 后端项目自动发现
│   └── api/                 # 前后端接口封装
├── test/                    # Node + 浏览器真实挂载测试
├── cordis.patch.yml         # 插件行注入配置层
├── CONTRIBUTING.md          # 贡献指南（PR 流程 / 提交规范）
├── CHANGELOG.md             # 更新日志
├── package.json
└── README.md
```

---

## 🚀 快速开始

### 前置条件

- **JDK 21**（`JAVA_HOME` 或插件配置 `javaHome`）
- **Node ≥ 18**（Playwright 驱动由插件自动探测）
- 网络通畅（首次启动需下载后端 jar 与数据库模板）

> 💡 **公开安装模式无需任何后端源码与手动构建**：插件会在首次启动时自动从 GitHub Release 拉取 `backend.jar`（约 265MB）与 SQLite 模板库，下载后离线复用。

### 公开安装（推荐）

```bash
# 1) 安装插件（git 源）
dsh plugin --profile web add "github:whishi47/dsh-get-jobs#master"

# 2) （可选）如需覆盖默认后端下载地址，编辑 profile 的 cordis.patch.yml：
- id: dsh-get-jobs
  name: dsh-get-jobs
  config:
    jarUrl: 'https://github.com/whishi47/dsh-get-jobs/releases/latest/download/backend.jar'
```

首次启动流程：下载 jar → 下载 SQLite 模板库 → `java -jar` 拉起 → 面板自动转「就绪」。求职功能还需 Playwright 浏览器（后端首次投递时自动下载）。

### 开发者模式

```bash
dsh plugin --profile <profile> add H:/CodeHome_2/getjob/dsh-get-jobs
dsh --profile <profile> --dump-config | grep dsh-get-jobs   # 期望看到 "# == dsh-get-jobs"
```

包内 `cordis.patch.yml` 会把插件行插进配置层；`package.json` 的 `dsh.bundle.patch` 指向它。

---

## ⚙️ 配置

在 profile 的 `cordis.patch.yml` 中按 id 覆盖：

```yaml
- id: dsh-get-jobs
  name: dsh-get-jobs
  config:
    baseUrl: 'http://127.0.0.1:9527'
    javaHome: 'C:/Program Files/Java/jdk-21'
    autostart: true
    mutations: confirm
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:9527` | 后端地址 |
| `jarUrl` | GitHub Release `backend.jar` | 后端 jar 下载直链；无本地 jar 时首次启动自动下载并缓存 |
| `dbUrl` | 默认模板库 | SQLite 模板下载直链（工作目录缺 `db/getjobs.db` 时自动下载） |
| `dataDir` | `<DSH_HOME\|~>/.dsh/get-jobs` | 下载产物（jar/db）存放目录 |
| `jarPath` | 自动 | 本地 jar 直指；存在时优先于 `jarUrl` |
| `projectDir` | 自动向上发现 | 后端源码目录；公开安装模式无需配置 |
| `javaHome` | 自动探测 JDK 21 | 启动后端使用的 JDK |
| `autostart` | `true` | 插件挂载时自动拉起后端 |
| `timeoutMs` | `15000` | 单次 HTTP 超时 |
| `mutations` | `confirm` | 启停策略：`confirm` 需带 `confirm: true`，`deny` 拒绝，`allow` 放行 |

---

## 🛠️ 开发

```bash
npm install --legacy-peer-deps
npm run build      # tsc（Node 半边）+ esbuild（浏览器半边）
npm run gates      # 包名 / patch / exports / 依赖 / 产物 / client / README 门禁
npm test           # 断言：Node + 浏览器真实挂载
npm run check      # build + gates + test 一次跑完
```

> 📌 **约定（来自实际事故）**：面板必须有**真实挂载测试**，只做构建检查等于没测；面板必须有错误边界且边界在面板**之上**；slot 注册用 `ctx.inject(['slots'], …)`，失败只丢面板、不阻断 boot；改写 `package.json` 一律用无 BOM 的 UTF-8。

---

## 🤝 参与贡献

欢迎 Issue 反馈与 Pull Request。流程与提交规范详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 📑 更新日志

所有重要变更见 [CHANGELOG.md](CHANGELOG.md)。

---

## 🤝 许可证

- **协议文件**：本项目采用 [PolyForm Noncommercial 1.0.0](LICENSE) 协议，**明确禁止任何商业用途**，仅允许个人学习交流、技术参考与辅助求职投递之非商业使用、复制、修改与再分发。
- **使用边界**：如将本项目用于任何商业目的，须事先取得作者书面授权。
- **署名要求**：再分发须保留原作者署名（mattan）与许可证声明，不得移除。

---

Copyright © 2026 mattan. All Rights Reserved.
