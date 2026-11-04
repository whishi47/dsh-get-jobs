> **项目声明**
> 本项目为个人开源，遵循 MIT 协议，供学习交流，可自由分发、修改与二次发布。

# dsh-get-jobs · 求职自动投递插件

> **把 Boss / 猎聘 / 51job / 智联 的自动投递后端接进 DeepSeek Harness，打开面板即用。**
> 不再需要手动起后端、开浏览器、配环境。

![MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)
![JDK](https://img.shields.io/badge/JDK-21-orange.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Spring Boot](https://img.shields.io/badge/Spring%20Boot-6DB33F?logo=springboot&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?logo=sqlite&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?logo=playwright&logoColor=white)
![DSH](https://img.shields.io/badge/DeepSeek%20Harness-集成-9cf.svg)

---

## 📑 目录

- [功能特性](#功能特性)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [配置](#配置)
- [开发](#开发)
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
dsh plugin --profile web add "github:whishi47/dsh-get-jobs#main"

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

## 🤝 许可证

本项目采用 [MIT](LICENSE) 开源许可证，允许自由使用、复制、修改、合并、发布、分发、再许可及销售本软件副本。

---

Copyright © 2026 mattan (邱高华). All Rights Reserved.
