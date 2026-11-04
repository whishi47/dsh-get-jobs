<div align="center">

<img src="assets/logo.png" width="132" alt="dsh-get-jobs logo" />

# 每天手动点几百次「打招呼」？让它替你点。

**dsh-get-jobs** 把 **Boss 直聘 / 猎聘 / 51job / 智联招聘** 的求职投递，
做成了 DeepSeek Harness 里一个看得见、点得动的可视化面板。

**一条命令装好 · 不用装数据库 · 不用编译 · 不用手动开后端 · 投过哪家全给你记下来**

[English](README.en.md) · **简体中文** · [更新日志](CHANGELOG.md) · [常见问题](#-小白常见问题卡住先看这里)

</div>

![PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20-green.svg)
![JDK](https://img.shields.io/badge/JDK-21-orange.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Spring Boot](https://img.shields.io/badge/Spring%20Boot-6DB33F?logo=springboot&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?logo=sqlite&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?logo=playwright&logoColor=white)
![DSH](https://img.shields.io/badge/DeepSeek%20Harness-插件-9cf.svg)

---

## 一句话说清楚：这东西到底有什么用？

> 你告诉它「我想投什么岗位、在哪座城市、哪些公司别投」，它就替你把四个招聘平台上的岗位筛出来、按你的条件打招呼、把投过的每一条都记成一张表，最后还能导出 Excel。
> 整个过程，你在一个面板里看得见、随时停得下来。

不用写代码，不用反复敲命令，不用自己配 Java 环境、装 MySQL、起浏览器。
插件第一次启动会**自己把后端下载下来、自己拉起来**，面板变绿了就能用。

### 没装之前，你大概是这么投简历的

| 步骤 | 手动做有多烦 |
| --- | --- |
| 找岗位 | 四个 App 来回切，同样关键词搜四遍，还得躲开已投过的和不想去的公司 |
| 打招呼 | 一家家点，开场白复制粘贴，想写得贴切点还得一条条改 |
| 记进度 | 靠备忘录、Excel 或者脑子，过两天就忘了投过哪家、有没有回音 |
| 换条件 | 想换个城市 / 关键词 / 薪资范围，又得从头再来一遍 |
| 跑环境 | 想用自动化脚本？先装 JDK、装数据库、编译、开浏览器、处理报错…… |

### 装了之后

| 上面那件事 | 现在怎么做 |
| --- | --- |
| 找岗位 | 在「投递配置」里填一次关键词 + 城市 + 薪资，四个平台统一按这套条件筛 |
| 打招呼 | 写一句默认招呼语，或者点一下 **AI 润色** 让它替你改写；也可以上传图片简历一起发 |
| 记进度 | 投过的岗位自动进「数据」页，按平台筛、一键导出 Excel |
| 换条件 | 改一个输入框，重新点开始 |
| 跑环境 | **不用管**。插件自己下载、自己启动、挂了自己重启 |

---

## 🖥️ 装好之后，你会看到 6 个页面

每个页面说人话解释一遍，不用猜：

| 页面 | 你能在这儿干啥 |
| --- | --- |
| **概览** | 一眼看后端是不是活着、系统状态正不正常、有没有报错 |
| **投递配置** | 填岗位关键词、城市、薪资、要投哪几个平台；设默认打招呼语（可一键 AI 润色）；上传图片简历；把不想投的公司加进黑名单 |
| **运行** | 点「开始」就按你设的条件去投，随时能停；后端进程意外退出会自动按 3s / 10s / 30s 重试 |
| **数据** | 投过的岗位全在一张表里，按平台筛选、单平台或四平台合并导出 xlsx |
| **简历** | 上传 PDF / DOCX / TXT / MD 简历，AI 读出你的经历生成投递配置草稿，预览改一改，一键写回 |
| **设置** | 填 AI 的 Key / 接口地址 / 模型名、维护公司黑名单（可导出 CSV）、看系统状态和诊断日志 |

> 🗄️ 数据是本机一个 **SQLite 单文件**（`db/getjobs.db`），**不需要安装任何数据库服务**，也不会把你的简历传到别人的服务器（AI 接口由你自己配置）。

---

## ✅ 谁适合装 / ❌ 谁别装（说实话，不吹）

**适合你，如果：**
- 你正在海投，每天要重复搜岗位、点打招呼、记投递记录
- 你已经在用 DeepSeek Harness，想把求职流程也收进同一个工作台
- 你愿意花几分钟填一次 AI 配置和投递条件

**别装，如果：**
- 你想要「一键拿 offer」——这是**投递效率工具**，不保证面试和结果
- 你希望全程零配置——**平台的登录态需要你自己完成**，AI 打招呼也要你自己填 Key
- 你打算拿它做商业服务 / 批量代投 / 售卖账号——**明确禁止**，见下方使用须知
- 你电脑上装不了 JDK 21 和 Node 20

---

## ⚠️ 用之前，请先看完这四句

1. 🚫 **禁止商用**：本项目采用 [PolyForm Noncommercial 1.0.0](LICENSE)，**不得用于任何商业目的**，仅限个人学习交流、技术参考与辅助自己求职投递。
2. 📚 **学习参考**：代码与文档供研究和自学使用，二次发布请保留本声明与作者署名（mattan）。
3. 🛡️ **遵守平台规则**：请合理控制投递频率、尊重各招聘平台的用户协议。自动化操作可能触发平台风控，**账号风险由使用者自行承担**。
4. ⚖️ **责任自担**：因使用本项目产生的任何后果（含账号风控、投递纠纷）由使用者自行承担，作者不承担责任。

---

## 🚀 装，真的只要三步

### 第 0 步：先确认电脑上有这两个东西

打开终端，敲两行：

```bash
java -version    # 需要 JDK 21
node -v          # 需要 Node 20 或更高
```

- 缺 JDK：装一个 **JDK 21**，并把 `JAVA_HOME` 指过去（或在配置里写 `javaHome`）。
- 缺 Node：装 **Node 20+**（`package.json` 的 `engines` 就是 `>=20`）。
- 网络：第一次启动要下载后端，需能访问 GitHub Release（约 265MB，只下一次）。

### 第 1 步：一条命令装插件

```bash
dsh plugin --profile web add "github:whishi47/dsh-get-jobs#master"
```

> 💡 **不用先 clone、不用 npm install、不用编译**：编译好的 `lib/` 已随仓库发布，安装器即使拦截构建脚本也能直接加载；`scripts/prepare.mjs` 只在产物缺失时才兜底重建。

### 第 2 步：等它自己准备好（第一次要等一小会儿）

首次启动它会自动按顺序做完这些事，你不用插手：

```text
下载 backend.jar（约 265MB）→ 下载 SQLite 模板库（136KB，只有表结构、无数据）
→ 缓存到本地 → java -jar 拉起后端 → 面板状态变成「就绪」
```

下载过一次就缓存在本地，**之后离线也能用**。求职功能还需要 Playwright 浏览器，后端第一次投递时会自动下载。

### 第 3 步：打开面板，按这个顺序点一遍（首次使用清单）

1. **设置 → AI 设置**：填你自己的 AI Key / 接口地址 / 模型名（不填的话，AI 打招呼和简历解析用不了）
2. **简历**：上传一份 PDF / Word 简历，让 AI 生成投递配置草稿，检查后写回
3. **投递配置**：填关键词、城市、薪资，选平台；写一句默认招呼语（可点「AI 润色」）；要发图片简历就在这里上传
4. **运行**：点开始，看状态；想停随时停
5. **数据**：看看投了哪些，导出 Excel 存档；不想再投的公司在「设置 → 黑名单」里加掉

---

## ❓ 小白常见问题（卡住先看这里）

| 问题 | 怎么办 |
| --- | --- |
| 一直卡在「正在下载后端」 | 第一次要下 265MB，等一会儿。若网络访问 GitHub 慢，可手动下载 `backend.jar` 后用 `jarPath` 指定本地文件，或把 `jarUrl` / `dbUrl` 改成可达的镜像地址 |
| 面板一直显示「未就绪」 | 多半是 JDK 没找到。检查 `java -version` 是不是 21，或在配置里显式写 `javaHome` |
| 提示找不到后端 jar | 默认从 GitHub Release 下载；也可以自己构建 `backend/` 后用 `jarPath` 指过去 |
| AI 打招呼语没生成 / 写得很怪 | 先去「设置 → AI 设置」确认 Key、接口、模型填对了；招呼语太短可以在「投递配置」里点 **AI 润色** 让它改写 |
| 勾了「发送图片简历」但没发出去 | 需要在「投递配置」里**先上传**简历图片（有预览缩略图才算成功），不是只勾开关 |
| 要装 MySQL / Redis 吗？ | 都不用。数据就一个 SQLite 文件 |
| **AI 会不会很费钱？怎么控制？** | 默认已经开了三层保护：单次输出上限 300 token、单次运行/每日调用上限、招呼语批量池化（一批岗位共用一组，调用次数从「每岗一次」降到「每批一次」）。「设置 → AI 设置」能看到今日和本次运行用了多少 token，预算随时可调 |
| **为什么我的招呼语开始重复了？** | 默认开启了「批量生成招呼语」：一次生成一组轮换使用，用来压成本。想每个岗位都单独生成，去「设置 → AI 设置」关掉这个开关即可（更个性化，也更费钱） |
| 简历评估会额外花钱吗？ | 会消耗 1 次大模型调用（约为一次招呼语生成的量级）。不点「AI 评估打分」就不会产生这部分费用 |
| 简历长图是什么？有什么用？ | 把上传的简历按手机阅读排成一张 1080 宽的长图，并自动写成 Boss 的「图片简历」——HR 在聊天里直接看到内容，不用下载附件。生成后可下载到本地，也可以随时重新生成 |
| 会不会把我的简历 / Key 传到别人服务器？ | 数据存本机；AI 请求发往**你自己配置**的接口地址。别把运行时的 `db/getjobs.db` 上传或分享出去，里面可能有你的配置 |
| 会不会封号？ | 有风险。请控制频率、遵守平台规则，别用它做批量代投。风险自担 |
| 我想改代码 / 二次开发 | 看下面的「开发者模式」，克隆仓库后 `npm install --legacy-peer-deps` 即可 |
| 我是 Mac / Linux 能用吗？ | 面板是网页，后端是 Java；JDK 21 与 Node 20 到位即可，路径配置按你的系统来 |

---

## ✨ 功能清单（详细版）

| 分类 | 能力 | 说明 |
| --- | --- | --- |
| **省事** | 一键后端 | 自动探测 `/api/health`，没起来就 `java -jar` 拉起；缺 jar 时回退 `gradlew` 构建 |
| **省事** | 自动重启 | 进程意外退出按 3s / 10s / 30s 退避重试，最多 3 次，就绪后计数归零 |
| **省事** | 干净清理 | 只结束**本插件拉起**的进程，你原本在跑的实例不受影响 |
| **省事** | 状态可见 | 健康端点供面板读取，日志尾部脱敏后可看诊断信息 |
| **投递** | 四平台配置 | Boss 直聘 / 猎聘 / 51job / 智联，参数分平台填、字段少时自动单列排版 |
| **投递** | AI 打招呼 | 可一键润色默认招呼语；后端按岗位信息生成更贴切的开场白 |
| **投递** | 图片简历 | 上传简历图片并随打招呼一起发送 |
| **投递** | 黑名单 | 公司黑名单分页管理（每页 10 条）、CSV 导出（带 BOM，Excel 不乱码） |
| **数据** | 岗位表 | 归一化岗位数据，单平台 / 四平台合并，xlsx 流式写出 |
| **简历** | 解析与草稿 | PDF / DOCX / TXT / MD → 大模型出 AI 配置草稿 → 预览编辑 → 一键写回 |
| **面板** | 原生六页 | 概览 / 投递配置 / 运行 / 数据 / 简历 / 设置，无 iframe、无额外端口，每页都能滚动 |
| **简历** | AI 评估打分 | 总分 + 五维评分 + 优势 / 待改进 / 修改建议 + 关键词命中，可导出独立 HTML 报告（打印即成 PDF）|
| **简历** | 简历长图 | 把简历排成 1080 宽长图，一键同步为 Boss 图片简历，投递时直接发送；也可下载到本地 |
| **成本** | 用量与预算 | 今日 / 本次运行的调用次数与 token 可见；单次运行与每日限额可调，超限自动回退固定招呼语 |
| **对话** | 聊天里启停 | 提供后端状态 / 启停工具，受 `mutations` 闸门约束（默认需确认） |

---

## 📂 项目里都有啥

```text
dsh-get-jobs/
├── assets/
│   └── logo.png             # 项目图标
├── src/
│   ├── client/              # 浏览器半边：React 原生面板（六页）
│   │   ├── App.tsx
│   │   ├── theme.ts
│   │   └── pages/           # 概览 / 投递配置 / 运行 / 数据 / 简历 / 设置
│   ├── backend/             # 后端托管：探测 / 拉起 / 重启 / 下载
│   │   ├── provision.ts     # jarUrl / dbUrl 来源 + 下载
│   │   ├── supervisor.ts    # 进程监管与自动重启
│   │   └── jdk.ts           # JDK 21 探测
│   ├── config.ts            # 插件配置 schema
│   ├── layout.ts            # 后端项目自动发现
│   └── api/                 # 前后端接口封装
├── backend/                 # Java / Spring Boot 后端源码（JDK 21）
├── lib/                     # 预构建产物（随仓库发布，公开安装开箱即用）
│   ├── index.js / index.d.ts
│   ├── client.js            # 浏览器半边（ModuleLoader 包裹）
│   └── backend/             # Node 半边编译产物
├── scripts/prepare.mjs      # 安装兜底：产物齐全即跳过构建，缺失才尝试构建
├── test/                    # Node + 浏览器真实挂载测试
├── cordis.patch.yml         # 插件行注入配置层
├── CONTRIBUTING.md          # 贡献指南（PR 流程 / 提交规范）
├── CHANGELOG.md             # 更新日志
├── README.md                # 中文文档（本文件）
├── README.en.md             # English documentation
├── package.json
└── LICENSE
```

---

## ⚙️ 配置项（大多数人不用改）

默认配置就能跑。只有下面这些情况才需要改：JDK 不在标准位置、网络下不动 GitHub、或者后端已经跑在别的端口。

在 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: dsh-get-jobs
  name: dsh-get-jobs
  config:
    baseUrl: 'http://127.0.0.1:9527'
    javaHome: 'C:/Program Files/Java/jdk-21'
    autostart: true
    mutations: confirm
```

| 字段 | 默认 | 什么时候要动它 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:9527` | 你的后端跑在别的端口 |
| `jarUrl` | GitHub Release 的 `backend.jar` | 直连 GitHub 慢，换镜像地址 |
| `dbUrl` | GitHub Release 的 `getjobs.db.template` | 同上 |
| `dataDir` | `<DSH_HOME\|~>/.dsh/get-jobs` | 想换下载产物存放位置 |
| `jarPath` | 自动 | 已有本地 jar，跳过下载（最省事） |
| `projectDir` | 自动向上发现 | 想手动指定后端源码目录 |
| `javaHome` | 自动探测 JDK 21 | 系统找不到 JDK，或装了多个版本 |
| `autostart` | `true` | 不想插件一挂载就启动后端 |
| `timeoutMs` | `15000` | 后端响应慢、总超时 |
| `mutations` | `confirm` | 启停策略：`confirm` 需带 `confirm: true`，`deny` 拒绝，`allow` 放行 |

> 🌏 后端 jar 与数据库模板默认都从 **GitHub Release** 直连下载，首次拉一次后本地缓存复用。网络不便时可把 `jarUrl` / `dbUrl` 指向可达地址，或用 `jarPath` 指定本地 jar 完全跳过下载。

---

## 🛠️ 想改代码？开发者模式

```bash
dsh plugin --profile <profile> add /path/to/dsh-get-jobs   # 换成本仓库的本地绝对路径
dsh --profile <profile> --dump-config | grep dsh-get-jobs   # 期望看到 "# == dsh-get-jobs"
```

包内 `cordis.patch.yml` 会把插件行插进配置层；`package.json` 的 `dsh.bundle.patch` 指向它。

```bash
npm install --legacy-peer-deps
npm run build      # tsc（Node 半边）+ esbuild（浏览器半边）
npm run gates      # 包名 / patch / exports / 依赖 / 产物 / client / README 门禁
npm test           # 断言：Node + 浏览器真实挂载
npm run check      # build + gates + test 一次跑完
```

> 📌 **约定（来自实际事故）**：面板必须有**真实挂载测试**，只做构建检查等于没测；面板必须有错误边界且边界在面板**之上**；slot 注册用 `ctx.inject(['slots'], …)`，失败只丢面板、不阻断 boot；改写 `package.json` 一律用无 BOM 的 UTF-8。

---

## 🚀 后端有新版本怎么发布

后端源码随本仓库 [`backend/`](backend/README.md) 目录提供（纯 Java / Spring Boot，JDK 21）。每次后端有更新：

1. **打包**（JDK 21）：
   ```bash
   cd backend
   ./gradlew bootJar --no-daemon
   ```
2. **同步产物**：把 `backend/build/libs/*.jar` 复制为 `release-assets/backend.jar`；`backend/assets/getjobs.db.template` 已只含表结构，直接复制为 `release-assets/getjobs.db.template`（**切勿**用运行时的 `db/getjobs.db`，其中含 API Key 与登录态）。
3. **上传 GitHub Release**：`gh release upload v0.2.0 release-assets/backend.jar release-assets/getjobs.db.template --clobber`
4. 如需新版本，打新 tag（如 `v0.2.1`）并同步更新 `CHANGELOG.md`。

> 插件运行时默认从 GitHub Release 拉取这两个文件；网络不便可在配置里改 `jarUrl` / `dbUrl`，或用 `jarPath` 指向本地 jar。

---

## 🤝 参与贡献

欢迎 Issue 反馈与 Pull Request。流程与提交规范详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 📑 更新日志

所有重要变更见 [CHANGELOG.md](CHANGELOG.md)。

## 📜 许可证

- **协议文件**：[PolyForm Noncommercial 1.0.0](LICENSE)，**明确禁止任何商业用途**，仅允许个人学习交流、技术参考与辅助求职投递之非商业使用、复制、修改与再分发。
- **使用边界**：如用于任何商业目的，须事先取得作者书面授权。
- **署名要求**：再分发须保留原作者署名（mattan）与许可证声明，不得移除。

---

<div align="center">

Copyright © 2026 mattan. All Rights Reserved.

</div>
