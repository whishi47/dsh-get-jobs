# 参与贡献（Contributing）

感谢你关注 **dsh-get-jobs**！本项目欢迎 Issue 反馈与 Pull Request。为保持质量与一致性，请先阅读以下规范。

## 🌿 分支策略

| 分支 | 用途 | 说明 |
| --- | --- | --- |
| `master` | 稳定 / 发布分支 | tag 从这里打；只接受 `develop` 与 `hotfix/*` 的合并 |
| `develop` | 开发集成分支 | 日常开发与 **PR 的默认目标** |
| `feature/<topic>` | 新功能 | 从 `develop` 拉，完成后 PR 回 `develop` |
| `fix/<topic>` | 普通修复 | 从 `develop` 拉，完成后 PR 回 `develop` |
| `hotfix/<topic>` | 线上紧急修复 | 从 `master` 拉，修完合 `master` 并回流 `develop` |
| `docs/<topic>` | 纯文档改动 | 从 `develop` 拉，PR 回 `develop` |

### 贡献流程

1. Fork 本仓库；
2. 从 `develop` 拉出你的分支（`feature/xxx`、`fix/xxx`、`docs/xxx`）；
3. 完成后 **Pull Request 到 `develop`**，不要直接提到 `master`；
4. 维护者合并后，`develop` 会定期合入 `master` 并发版。

> 功能类 PR 如果以 `master` 为目标，会被要求改到 `develop`；只有 `hotfix/*` 允许以 `master` 为目标。

### 发版流程（维护者）

1. `develop` 验收通过 → 合并到 `master`；
2. 在 `master` 上更新版本号与 `CHANGELOG.md`，打 tag（如 `v0.12.1`）；
3. 推送 tag，创建 Release 并上传 `backend.jar` / `getjobs.db.template`；
4. `master` 上的修复要回流到 `develop`（`git merge master`），避免下次发版丢补丁。

## 💡 先讨论，再动手

- **重大改动**（新增平台支持、破坏性配置变更、协议调整）请先提 [Issue](../../issues) 说明动机与方案，确认方向后再实现，避免返工。
- 小修小补（文案、样式、bug 修复）可直接 PR。

## 📝 提交信息规范（强制）

Commit 与 PR 标题**首行**必须遵循以下格式：

```
<emoji> <小写英文描述>.
```

- 以一个 emoji 开头；
- 空格后接**全小写英文**（避免中文或大小写混用）；
- 以英文句号 `.` 结尾。

示例：

```
✨ add image resume upload button.
🐛 fix ai greeting context lost on no placeholder.
📝 update readme install command to master branch.
```

### Emoji 速查

| Emoji | 含义 | 场景 |
| --- | --- | --- |
| ✨ feat | 新功能 | 新增能力 |
| 🐛 fix | 修复 | Bug 修复 |
| 📝 docs | 文档 | README / 注释 / 文档 |
| ♻️ refactor | 重构 | 不改变行为的代码整理 |
| ⚡ perf | 性能 | 性能优化 |
| 🧪 test | 测试 | 新增 / 修正测试 |
| 🔧 chore | 杂项 | 构建、配置、依赖 |
| 🚀 release | 发布 | 发版、打 tag |

> 维护者会在合并前检查首行格式，不符合会请先修正。

## 🔍 PR 要求

- 标题遵循上述 commit 规范；
- 描述清楚：解决了什么、怎么解决的、是否需要文档 / 配置变更；
- 确保 `npm run check` 全绿（build + gates + test）；
- 涉及 UI 的变更请说明其对滚动 / 布局的影响。

## 📜 协议与使用边界

- 本项目采用 [MIT](LICENSE) 协议。
- 你的贡献版权仍归你所有，合并即表示你同意以相同 MIT 条款分发你的改动。
- 提交 PR 即视为你理解并同意此协议。

---

感谢每一位贡献者 🙏
