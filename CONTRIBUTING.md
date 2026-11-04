# 参与贡献（Contributing）

感谢你关注 **dsh-get-jobs**！本项目欢迎 Issue 反馈与 Pull Request。为保持质量与一致性，请先阅读以下规范。

## 🌿 分支策略

- 默认分支为 `master`（发布分支）。
- 贡献请 **Fork 本仓库**，从 `master` 拉出你的特性分支（如 `feat/xxx`、`fix/xxx`）。
- 完成后提交 **Pull Request 到 `master`**。
- 本项目规模较小，不维护独立的 `dev` 分支，直接 PR 到 `master` 即可。

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

> CI 会校验首行格式，不符合将被拒绝合并。

## 🔍 PR 要求

- 标题遵循上述 commit 规范；
- 描述清楚：解决了什么、怎么解决的、是否需要文档 / 配置变更；
- 确保 `npm run check` 全绿（build + gates + test）；
- 涉及 UI 的变更请说明其对滚动 / 布局的影响。

## 📜 协议与使用边界

- 你的贡献版权仍归你所有，合并即表示你同意以 [LICENSE](LICENSE) 协议分发你的改动。
- **本项目仅供个人学习交流与辅助求职投递，禁止任何商业用途**；提交 PR 即视为你理解并同意此使用边界。

---

感谢每一位贡献者 🙏
