# Get Jobs Backend

> Java / Spring Boot 后端服务：为 [dsh-get-jobs](../README.md) 插件提供求职自动投递能力的 HTTP API。
> **本目录只包含后端工程源码，不含任何前端页面、GUI 或构建产物。**

## 这是什么

一个独立可构建的 Spring Boot 3.5 服务（JDK 21 / Gradle），默认监听 `127.0.0.1:9527`。
插件通过 REST API 调用它，完成 Boss 直聘、猎聘、51job、智联四大平台的岗位抓取与自动投递。

| 组件 | 版本 / 说明 |
| --- | --- |
| JDK | 21 |
| Spring Boot | 3.5.16 |
| 构建 | Gradle Wrapper（`gradlew` / `gradlew.bat`） |
| 数据库 | SQLite（`db/getjobs.db`）+ MyBatis-Plus |
| 浏览器自动化 | Playwright Java 1.62 + Patchright driver 1.62.1 |
| 文档解析 | Apache POI（xlsx / docx）、PDFBox（pdf） |

主要能力：岗位抓取与过滤、AI 岗位匹配与打招呼语生成、图片简历、黑名单、企业微信通知、岗位数据导出、简历文本抽取。

## 目录结构

```
backend/
├── src/main/java/com/getjobs/
│   ├── application/    # Spring Web 层：Controller / Service / 配置
│   └── worker/         # 四个平台的投递实现与 Playwright 管理
├── src/main/resources/
│   ├── application.yaml
│   ├── banner.txt
│   └── defaults/       # 默认页面配置
├── src/test/java/      # 单元测试
├── assets/
│   └── getjobs.db.template   # 仅含表结构的空库模板（无业务数据）
├── gradle/             # Gradle Wrapper
├── build.gradle.kts
├── start-local.ps1     # Windows 一键启动（纯后端）
└── LICENSE
```

## 快速开始

前置条件：**JDK 21**、**Node.js 20+**（Patchright driver 由 `npm` 装配，首次构建自动执行）。

```bash
# 1) 准备数据库：模板只含表结构，不含任何账号 / Cookie / API Key
cp assets/getjobs.db.template db/getjobs.db

# 2) 启动（Windows PowerShell）
./start-local.ps1

# 或直接用 Gradle
./gradlew bootRun          # macOS / Linux
./gradlew.bat bootRun      # Windows
```

健康检查：`http://127.0.0.1:9527/actuator/health`

打包可执行 jar：

```bash
./gradlew bootJar --no-daemon
# 产物：build/libs/get_jobs-2.0.1.jar
java -jar build/libs/get_jobs-2.0.1.jar
```

> 首次运行会自动下载 patchright-core 并装配 Playwright driver；首次投递时按需下载浏览器内核。

## 配置

- 端口、日志、数据源等默认值在 `src/main/resources/application.yaml`，可用环境变量或 Spring 配置覆盖。
- AI 服务的 API Key、企业微信 Webhook 等敏感项在运行时由应用设置接口写入本地数据库，**不要写进代码或提交到仓库**。
- 各平台登录态保存在本地浏览器用户数据目录，`.gitignore` 已排除。

## 安全说明

- `assets/getjobs.db.template` 是清空业务数据后的空库模板；`db/getjobs.db` 由本地生成并已被忽略。
- `cookies/`、`browser-data/`、`.env`、`*.log`、`data/` 均不入库。
- 使用前请自行评估目标平台的服务条款与账号风险，由此产生的后果由使用者自行承担。

## 许可证

[PolyForm Noncommercial License 1.0.0](LICENSE)：**仅限非商业用途**，允许个人学习、技术参考与辅助求职投递场景下的使用、修改与再分发；商业使用须另行取得书面授权。

Copyright © 2026 mattan.
