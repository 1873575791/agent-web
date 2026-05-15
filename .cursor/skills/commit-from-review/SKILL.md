---
name: commit-from-review
description: >-
  Reviews working tree and staged changes, infers intent from the diff, and
  drafts a short commit message (subject + optional body). Use when the user
  asks for a commit message, 提交说明, commit subject, or to summarize changes
  before committing—without executing git commit unless they explicitly ask.
disable-model-invocation: false
---

# 从代码审查生成 Commit 说明

在用户需要**提交说明**或**拟写 commit** 时启用本 skill。只负责**检查改动、分析作用、产出文案**；除非用户明确要求，否则**不执行** `git commit` / `git push`。

## 流程（必须按序）

1. **收集改动事实**（并行执行）  
   - `git status`（未跟踪、已暂存、未暂存）  
   - `git diff`（未暂存）  
   - `git diff --cached`（已暂存；若全部已暂存，以 staged 为准）  
   - `git log -10 --oneline`（对齐本仓库用语与粒度）

2. **审查代码**（在脑中完成，可简要向用户汇报）  
   - 改了哪些模块/文件，**行为变化**是什么（功能、修复、重构、配置、文档、测试）  
   - 是否有风险点（破坏性变更、API 变更、迁移）  
   - **忽略**与本次提交无关的噪音（仅当用户要求「只针对某路径」时再收窄）

3. **归纳并写 commit 文案**  
   - **Subject**：一句说明「**为什么 / 解决什么问题**」，必要时带作用域，例如 `fix(chat): 去重用户消息以缩短首包`  
   - 长度：英文常见 ≤72 字符；中文可稍短，**一行读完**  
   - **Body**（可选）：若改动跨多 concern 或需说明取舍，用空行后 1～3 条短句，不写流水账文件列表  
   - 语言：**优先与 `git log` 近期提交一致**（中文仓库用中文 subject 亦可）  
   - **不要**在消息里写「生成」「AI」等元话语

4. **交付格式**  
   向用户输出可直接复制的内容，例如：

   ```text
   fix(server): 避免 history 与 message 重复追加用户句

   降低 prompt 体积与首包延迟；前端用内存构造 history 并节流 IndexedDB 写入。
   ```

   若用户稍后会用 HEREDOC 提交，提醒其用仓库既有方式包裹多行正文即可。

## 禁区

- 不猜测未出现在 diff 中的行为；看不全则说明「需补充上下文」  
- 不把密钥、`.env`、token 写进 commit 说明  
- 用户未明确说「请提交 / 执行 commit」时，**不**运行 `git add` / `git commit`

## 与「用户要求代为 commit」的关系

若用户**同时**要求代为执行 `git commit`，在完成上述 1～3 步后，再按其仓库规则执行 add/commit；仍以本 skill 产出的说明作为 `git commit -m` 或 HEREDOC 的正文基础。
