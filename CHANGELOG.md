# 更新日志（Changelog）

本项目所有重要变更均记录于此。

> 格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

### 🐛 Fixed
- **修复公开安装无法加载插件**：`package.json` 的 `main` / `exports` 指向 `lib/`，但 `lib/` 此前被 `.gitignore` 排除且从未入库，且缺少 `prepare` 构建钩子，导致从 GitHub / Gitee clone 安装后入口文件缺失。现采用双保险：① 预构建产物 `lib/` 随仓库发布；② 新增 `scripts/prepare.mjs` 安装兜底（产物齐全即跳过，仅在缺失时尝试构建，不依赖 devDependencies）。已用干净 clone 实测验证。

### 🔧 Changed
- 后端 jar 与数据库模板下载**统一指向 GitHub Release 直链**（移除此前尝试的镜像集群与 Gitee 兜底）：`jarUrl` 默认 `https://github.com/whishi47/dsh-get-jobs/releases/latest/download/backend.jar`，`dbUrl` 同理指向 `getjobs.db.template`；用户仍可在配置中自定义 `jarUrl` / `dbUrl` 或 `jarPath` 本地 jar。
- 项目署名统一为 **mattan**，npm 元数据与 Release 说明的许可证表述与 **PolyForm Noncommercial 1.0.0** 对齐
- 许可证由 MIT 调整为 **PolyForm Noncommercial 1.0.0**，明确禁止任何商业用途（仅供个人学习交流与辅助求职投递）

## [v0.1.0] - 2026-11-04

首个公开发布版本：将求职自动投递后端以 DeepSeek Harness 插件形式集成，安装即用。

### ✨ Added
- 一键后端：探测健康，未就绪自动 `java -jar` 拉起，缺失 jar 回退 `gradlew` 构建
- 自动重启：进程退出按 3s / 10s / 30s 退避重试，最多 3 次
- 原生面板：概览 / 投递配置 / 运行 / 数据 / 简历 / 设置 六页（无 iframe、无额外端口）
- 数据导出：归一化岗位表，支持单平台与四平台合并，xlsx 流式写出
- 简历解析：PDF / DOCX / TXT / MD → AI 草稿 → 预览编辑 → 写回
- 后端 jar 与 SQLite 模板库首次启动自动从 GitHub Release 下载（公开安装开箱即用）
- AI 润色打招呼语、图片简历上传、黑名单分页与 CSV 导出、设置子标签页

### 🔧 Changed
- 后端数据库模板仅保留表结构、清空业务数据，避免密钥与登录态泄露
- 文档体系收敛，仅保留仓库根文件，内部资料不再随仓库发布

### 🧹 Cleanup
- 重写提交历史，作为独立项目发布
