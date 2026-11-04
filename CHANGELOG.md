# 更新日志（Changelog）

本项目所有重要变更均记录于此。

> 格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [v0.2.0] - 2026-11-05

### ✨ Added
- **简历评估打分**：导入简历后一键让 AI 评分 —— 总分、五个维度（内容完整性 / 岗位匹配度 / 成果量化 / 表达清晰度 / 竞争力）、优势、待改进、修改建议、关键词命中与缺失；评估完成后可**导出独立 HTML 报告**（可直接打印成 PDF）
- **AI 用量可见**：设置页新增「AI 用量与预算」卡片，显示今日调用次数、输入/输出/总 token、本次运行用量与今日剩余额度；用量按天落库（`ai_usage_daily`），重启不丢
- **预算闸门**：`AI_RUN_LIMIT`（单次运行上限）与 `AI_DAILY_LIMIT`（每日上限）可调，超限自动回退固定招呼语并继续投递，不再"跑到天亮才发现账单爆了"
- **招呼语批量池化**：一次生成一批（默认 10 条）轮换使用，并按岗位指纹缓存；150 份投递的 AI 调用次数从 150 次降到个位数
- 设置页模型字段推荐 `deepseek-flash`，并提供「用推荐」一键填入

### 🔧 Changed
- `AiService` 请求默认携带 `max_tokens=300`，并尝试关闭思维链（接口不支持该参数时自动去掉重试一次，之后不再携带）
- 后端默认应用名改为 `dsh-get-jobs-backend`，源码中的原作者署名与外部链接已清理

### 🐛 Fixed
- **修复 AI 成本失控**：实测 150 份投递触发 150 次模型调用、共 505,340 token，其中输出 413,107（81.7%）、平均每次输出 2,754 token，而实际发出的招呼语只有 20-50 字。根因是每岗单次调用 + 未限制输出长度 + 推理模型把思维链计入输出计费。现在通过池化、`max_tokens` 和预算闸门三重约束解决

### 📝 Documentation
- README 重写为**大白话场景化中文文档**：先说清「这东西到底有什么用」、装好后的六个页面逐个解释、三步安装、首次使用清单、小白常见问题 FAQ、诚实的使用边界说明；徽章 Node 版本与 `engines` 对齐为 `>=20`
- 新增完整英文文档 [`README.en.md`](README.en.md)，中英双语互相挂链
- 新增项目图标 `assets/logo.png`（512×512 透明底）与 `assets/favicon.png`，README 中英双版顶部引用
- GitHub 仓库描述与 `package.json` 描述改为「说人话」的用途说明，不再只堆技术名词

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
