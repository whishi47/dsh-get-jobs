# 更新日志（Changelog）

本项目所有重要变更均记录于此。

> 格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

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
