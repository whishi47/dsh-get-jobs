# dsh-get-jobs（求职投递）

把求职自动投递后端（Boss / 猎聘 / 51job / 智联）接进 DeepSeek Harness：**打开面板即用**，不再需要手动起后端、开浏览器。

> 状态：M0–M4 完成。Node 半边（后端托管 + 自动重启 + 状态路由 + 2 个工具）、浏览器半边（6 个页面，原生面板）、Java 侧 5 个新接口均已落地并端到端验证。
> 剩余：装进 desktop profile 做一次真机确认。
> 文档索引：[`docs/README.md`](docs/README.md)。

---

## 它做什么

| 能力 | 说明 |
| --- | --- |
| 一键后端 | 探测 `http://127.0.0.1:9527`，未就绪则优先 `java -jar` 直启（约 3 秒），缺失时回退 `gradlew bootRun` |
| 自动重启 | 进程意外退出后按 3s / 10s / 30s 退避重试，最多 3 次；成功就绪后计数归零 |
| 自动清理 | 只终止**本插件拉起**的进程；外部已运行的实例不动 |
| 状态可见 | `GET /dsh-get-jobs/health` 给面板读取；日志尾部自动脱敏后供诊断 |
| 对话可用 | `getjobs_status` / `getjobs_backend` 两个工具，聊天里就能启停（受 `mutations` 闸门约束） |
| 原生面板 | 概览 / 投递配置 / 运行 / 数据 / 简历 / 设置 六页，无 iframe、无额外端口 |
| 数据导出 | 12 列归一化岗位表，支持单平台与四平台合并，xlsx 流式写出 |
| 简历解析 | 文本型 PDF / DOCX / TXT / MD → 大模型出 AI 配置草稿 → 预览编辑 → 一键写回 |

数据库是 SQLite 单文件 `db/getjobs.db`，**不需要安装任何数据库服务**。

---

## 前置条件

1. JDK 21（`JAVA_HOME` 或插件配置 `javaHome`）
2. 后端仓库已就绪：`db/getjobs.db` 存在
3. 建议先构建一次 jar（启动从分钟级降到秒级）：

```bash
cd <后端仓库> && export JAVA_HOME="C:/Program Files/Java/jdk-21" && ./gradlew bootJar -x buildFrontend
```

没有 jar 也能用，只是首次启动走 Gradle，较慢。

---

## 在别的电脑上用（公开安装模式）

没有后端源码也能跑：插件只需要 **JDK 21** 和一个**后端 jar 下载地址**。首次启动会自动把 jar 和 SQLite 模板库下载到本地数据目录，之后离线复用。

```bash
# 1) 安装插件（git 源示例）
dsh plugin --profile web add "github:<owner>/dsh-get-jobs#main"

# 2) 配置 jarUrl 指向后端 jar 的下载直链（ Releases 资产、网盘直链均可）
#    编辑 ~/.dsh/profiles/web/cordis.patch.yml：
- id: dsh-get-jobs
  name: dsh-get-jobs
  config:
    jarUrl: 'https://github.com/<owner>/dsh-get-jobs/releases/latest/download/backend.jar'
```

首次启动流程：下载 jar（约 280MB，进度显示在面板横幅）→ 下载 SQLite 模板库 → `java -jar` 拉起 → 面板自动转「就绪」。求职功能还需要 Node ≥ 18（插件自动探测）与 Playwright 浏览器（后端首次投递时自动下载）。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `jarUrl` | 无 | 后端 jar 下载直链；无本地 jar 时首次启动自动下载并缓存 |
| `dbUrl` | 默认模板库 | SQLite 模板下载直链（工作目录缺 `db/getjobs.db` 时自动下载） |
| `dataDir` | `<DSH_HOME\|~>/.dsh/get-jobs` | 下载产物（jar/db）存放目录 |
| `jarPath` | 自动 | 本地 jar 直指；存在时优先于 jarUrl |
| `projectDir` | 自动向上发现 | 后端源码目录；公开安装模式无需配置 |

更新后端：换 `jarUrl`（或删掉 `dataDir` 里已缓存的 jar）后重新点「启动」。若后端 jar 由你自行构建，优先用 `jarPath`/`projectDir`（开发者模式，见下节）。

---

## 安装（开发者模式）

```bash
dsh plugin --profile <profile> add H:/CodeHome_2/getjob/dsh-get-jobs
dsh --profile <profile> --dump-config | grep dsh-get-jobs   # 期望看到 "# == dsh-get-jobs"
```

包内 `cordis.patch.yml` 会把插件行插进配置层；`package.json` 的 `dsh.bundle.patch` 指向它。

没有 `dsh` CLI 时的手动装法与三个已知坑见 [`docs/development.md`](docs/development.md) 第 7 节。

---

## 配置

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
| `projectDir` | 插件目录的上一级 | 后端仓库位置 |
| `javaHome` | 自动探测 JDK 21 | 启动后端使用的 JDK |
| `jarPath` | `build/libs/get-jobs-*.jar` 最新 | 显式指定 jar |
| `autostart` | `true` | 插件挂载时自动拉起后端 |
| `timeoutMs` | `15000` | 单次 HTTP 超时 |
| `mutations` | `confirm` | 启停后端的策略：`confirm` 需带 `confirm: true`，`deny` 直接拒绝，`allow` 放行 |

---

## 开发

```bash
npm install --legacy-peer-deps
npm run build      # tsc（Node 半边）+ esbuild（浏览器半边）
npm run gates      # 7 项：包名 / patch / exports / 依赖 / 产物 / client / README
npm test           # 48 项断言：28 Node + 20 浏览器真实挂载
npm run check      # build + gates + test 一次跑完
```

约定（来自实际事故）：

- 客户端面板必须有**真实挂载测试**，只做构建检查等于没测。
- 面板必须有错误边界，且边界要在面板**之上**（写在内部捕不到自己的错误）。
- slot 注册用 `ctx.inject(['slots'], …)`，失败只丢面板、不阻断 boot。
- 改写任何 `package.json` 一律用无 BOM 的 UTF-8（BOM 会让 DSH 起不来）。

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/README.md`](docs/README.md) | 索引与快速事实 |
| [`docs/PRD.md`](docs/PRD.md) | 产品需求与决策依据 |
| [`docs/design.md`](docs/design.md) | 架构设计与关键取舍 |
| [`docs/technical.md`](docs/technical.md) | 技术实现：状态机、错误边界、为什么这么写 |
| [`docs/api.md`](docs/api.md) | 接口契约（精确到状态码与响应示例） |
| [`docs/development.md`](docs/development.md) | 构建、测试、门禁、安装、发版、排错 |
