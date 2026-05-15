---
name: commit-from-review
description: >-
  Reviews working tree and staged changes, infers intent, drafts a concise
  commit message, then runs git add and git commit so the user only needs to
  push. Use when the user invokes commit-from-review, /commit-from-review, or
  asks for a reviewed commit workflow. Does not push unless explicitly asked.
disable-model-invocation: false
---

# 从代码审查到本地提交（你只 push）

启用本 skill 时：完成**检查改动 → 分析作用 → 写 commit 文案**后，**默认继续执行** `git add` 与 `git commit`；**不执行** `git push`（除非用户明确要求推送）。

若用户**只要文案、不要提交**，在其明确说明时仅执行流程 1～3 并输出文案，跳过第 4 步。

## 流程（必须按序）

1. **收集改动事实**（并行执行）  
   - `git status`（未跟踪、已暂存、未暂存）  
   - `git diff`（未暂存）  
   - `git diff --cached`（已暂存；若全部已暂存，以 staged 为准）  
   - `git log -10 --oneline`（对齐本仓库用语与粒度）

2. **审查代码**（在脑中完成，可简要向用户汇报）  
   - 改了哪些模块/文件，**行为变化**是什么（功能、修复、重构、配置、文档、测试）  
   - 是否有风险点（破坏性变更、API 变更、迁移）  
   - 仅当用户指定路径/范围时，再收窄审查面

3. **归纳并写 commit 文案**  
   - **Subject**：一句说明「**为什么 / 解决什么问题**」，必要时带作用域  
   - 长度：英文常见 ≤72 字符；中文可稍短，**一行读完**  
   - **Body**（可选）：跨多 concern 时用空行后 1～3 条短句，不写流水账文件列表  
   - 语言：**优先与 `git log` 近期提交一致**  
   - **不要**在消息里写「生成」「AI」等元话语

4. **暂存并提交（默认执行）**  
   - 若**无任何可提交改动**，说明原因并**不要**创建空提交  
   - **`git add`**：只加入本次审查要纳入的版本库改动；对已修改的已跟踪文件用明确路径或等价安全方式（**禁止** `git add .` 误把未审查或未同意内容全盘加入）  
   - **绝不** `git add` 明显含密钥的路径（如 `.env`、`credentials.json`、私钥文件等）；若改动仅限此类文件，停止并提示用户手动处理  
   - **未跟踪文件**：默认不加入；用户在本轮对话中**点名要提交**的路径才可 `git add`  
   - **`git commit`**：使用上一步产出的 subject/body；**多行正文必须用 HEREDOC**，例如：  
     `git commit -m "$(cat <<'EOF'` … `EOF` `)"`  
   - 遵守仓库既有 **hooks**（不跳过 `--no-verify` 等，除非用户明确要求）  
   - 完成后输出 **commit 摘要**（短 hash + subject），并说明：**本地已提交，你需要时自行 `git push`**

## 禁区

- 不猜测未出现在 diff 中的行为；看不全则说明「需补充上下文」  
- 不把密钥、`.env`、token 写进 commit 说明，也不把它们加入暂存区  
- **不** `git push`、`git push --force`（除非用户明确指令且符合其仓库安全约定）

## 仅要文案时

用户若说「只写提交说明 / 不要 commit」：完成步骤 1～3 后，用「交付格式」输出可复制文案，**不执行**步骤 4。

### 交付格式（仅文案模式或作为备忘）

```text
fix(server): 避免 history 与 message 重复追加用户句

降低 prompt 体积与首包延迟；前端用内存构造 history 并节流 IndexedDB 写入。
```
