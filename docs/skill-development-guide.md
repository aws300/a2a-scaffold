# 业务 Skill 开发与验证指南

本指南面向**业务人员和非研发人员**，帮助你从零开始编写、测试并部署自己的 AI 业务 Skill。

---

## 目录

1. [概念说明：什么是 Skill](#1-概念说明什么是-skill)
2. [准备工作：获取 API Key](#2-准备工作获取-api-key)
3. [安装 Claude Code](#3-安装-claude-code)
4. [使用 skill-creator 开发 Skill](#4-使用-skill-creator-开发-skill)
5. [Skill 目录结构详解](#5-skill-目录结构详解)
6. [【可选】A2A 脚手架本地验证](#6-可选a2a-脚手架本地验证)
7. [【可选】打包 Docker 交给运维内网部署](#7-可选打包-docker-交给运维内网部署)
8. [常见问题](#8-常见问题)

---

## 1. 概念说明：什么是 Skill

**Skill（技能）** 是一段用 Markdown 写成的"专家指令文件"，告诉 AI Agent 在特定场景下应该如何思考、用什么规则、调用哪些脚本或参考哪些资料。

类比理解：
- 普通 AI = 没有任何培训的新员工
- 加载了 Skill 的 AI = 读过内部手册、了解公司规范、知道查哪些参考资料的有经验员工

一个 Skill 由以下几部分组成：

```
my-skill/                   ← Skill 根目录（即 Skill ID）
├── SKILL.md                ← 核心：描述 + AI 指令（必须有）
├── references/             ← 参考资料（AI 可以读取）
│   ├── api-spec.md
│   └── business-rules.md
├── scripts/                ← 可执行脚本（AI 可以运行）
│   └── validate.py
├── agents/                 ← 子 Agent 定义（可选，高级用法）
└── assets/                 ← 静态资源文件（可选，如模板、图片）
```

---

## 2. 准备工作：获取 API Key

联系公司运维团队，申请以下三个配置项：

| 配置项 | 说明 | 示例值 |
|--------|------|--------|
| `ANTHROPIC_BASE_URL` | 公司内网 LLM 服务地址 | `https://llmapi.example.com` |
| `ANTHROPIC_API_KEY` | 个人 API 密钥 | `sk-ant-xxxxxxxxxxxxxxxx` |
| `MODEL` | 使用的模型版本 | `anthropic://claude-sonnet-4-6` |

收到后，**在自己的电脑上**按以下方式配置为环境变量：

### macOS / Linux

打开终端，执行以下命令（将 `xxxx` 替换为实际值）：

```bash
# 写入当前 shell 环境（关闭终端后失效）
export ANTHROPIC_BASE_URL=https://llmapi.example.com
export ANTHROPIC_API_KEY=sk-ant-your_key_here
export MODEL=anthropic://claude-sonnet-4-6
```

若希望**永久生效**，将上面三行追加到 `~/.zshrc`（Mac）或 `~/.bashrc`（Linux），然后执行：

```bash
source ~/.zshrc   # Mac
# 或
source ~/.bashrc  # Linux
```

### Windows（PowerShell）

```powershell
$env:ANTHROPIC_BASE_URL = "https://llmapi.example.com"
$env:ANTHROPIC_API_KEY  = "sk-ant-your_key_here"
$env:MODEL              = "anthropic://claude-sonnet-4-6"
```

若希望永久生效，在"系统属性 → 环境变量"中添加上述三个用户变量。

### 验证配置是否生效

```bash
echo $ANTHROPIC_BASE_URL   # 应输出你填写的地址
echo $ANTHROPIC_API_KEY    # 应输出你的 key（以 sk-ant- 开头）
```

---

## 3. 安装 Claude Code

Claude Code 是用于开发 Skill 的命令行工具，支持 macOS、Windows、Linux。

### 安装步骤

1. 确保已安装 **Node.js 18+**（[下载地址](https://nodejs.org/)，选 LTS 版本）

2. 打开终端，执行：

```bash
npm install -g @anthropic-ai/claude-code
```

3. 验证安装成功：

```bash
claude --version
# 应输出版本号，如：claude 1.x.x
```

4. 首次启动：

```bash
claude
```

启动后会进入交互界面，如果能看到提示符 `>` 说明安装成功。

> **提示**：如果公司网络需要代理，请先配置 npm 代理，或联系运维提供离线安装包。

---

## 4. 使用 skill-creator 开发 Skill

`skill-creator` 是 Anthropic 官方提供的元技能，专门用于帮助你创建和优化 Skill。

### 4.1 下载 skill-creator

在终端执行以下命令，将 skill-creator 下载到本地：

```bash
# 新建一个工作目录
mkdir ~/my-skills && cd ~/my-skills

# 克隆 Anthropic 官方 skills 仓库（仅需下载一次）
git clone https://github.com/anthropics/skills.git anthropic-skills
```

> **没有 git？** 也可以直接访问 https://github.com/anthropics/skills/tree/main/skills/skill-creator，点击右上角 "Download ZIP" 下载后解压。

### 4.2 启动 Claude Code 并加载 skill-creator

```bash
cd ~/my-skills
claude
```

在 Claude Code 交互界面中，输入以下命令加载 skill-creator：

```
/skill-creator
```

Claude Code 会读取 skill-creator 的指令，进入 Skill 开发模式。

### 4.3 描述你想要的 Skill

加载后，用**自然语言**告诉 Claude 你要创建什么 Skill，例如：

**示例 1：创建新 Skill**
```
我需要一个"合同审查"技能，帮助法务同事自动检查合同中是否包含必填条款，
参考我们公司的合同规范文档，如果发现缺失条款要高亮提示。
```

**示例 2：优化已有 Skill**
```
我已经有一个"客服话术"的 skill，但它的回答太生硬，
请帮我优化 SKILL.md，让 AI 的回答更自然、更有同理心。
```

### 4.4 迭代优化

skill-creator 会生成 Skill 文件草稿，你可以继续对话进行调整：

```
把参考资料中的"合同规范v2.md"也纳入进来，放到 references/ 目录
```

```
帮我写一个 validate.py 脚本放到 scripts/ 目录，
用来检查合同文本是否超过 50 页
```

### 4.5 Skill 文件的核心：SKILL.md 写法

skill-creator 生成后，你也可以手动编辑 `SKILL.md`，格式如下：

```markdown
---
name: contract-reviewer
description: 法务合同审查技能，自动检查必填条款完整性
---

# 合同审查专家

你是一位资深法务专家，专注于合同条款的合规性审查。

## 工作原则

1. 严格对照公司合同规范（见 references/contract-standards.md）
2. 逐条检查必填条款清单
3. 发现缺失或不合规条款时，用 ⚠️ 标记并说明原因
4. 最终输出结构化的审查报告

## 审查流程

1. 读取合同文本
2. 识别合同类型（采购/销售/服务/保密）
3. 按类型加载对应的条款检查清单
4. 逐项比对，标注合规 ✅ / 缺失 ❌ / 需关注 ⚠️
5. 生成审查摘要报告

## 注意事项

- 如需运行验证脚本，调用 scripts/validate.py
- 如合同文本超过 100 页，提示用户分段提交
```

### 4.6 填充 references/ 参考资料

将业务相关文档放入 `references/` 目录，AI 会在处理时参考这些内容：

```bash
mkdir -p ~/my-skills/contract-reviewer/references

# 将你的业务文档复制进去
cp ~/Documents/合同规范v3.md ~/my-skills/contract-reviewer/references/contract-standards.md
cp ~/Documents/必填条款清单.xlsx ~/my-skills/contract-reviewer/references/required-clauses.md
```

> **格式建议**：优先使用 `.md`（Markdown）或 `.txt` 纯文本格式，AI 读取效果最好。Excel/Word 文件建议先转为 Markdown 或纯文本。

### 4.7 编写 scripts/ 可执行脚本

将 Skill 需要调用的工具脚本放入 `scripts/` 目录：

```bash
mkdir -p ~/my-skills/contract-reviewer/scripts
```

示例脚本 `scripts/validate.py`：

```python
#!/usr/bin/env python3
"""检查合同文件基本信息（页数、文件大小等）"""
import sys
import os

def check_contract(file_path: str):
    if not os.path.exists(file_path):
        print(f"❌ 文件不存在: {file_path}")
        sys.exit(1)
    
    size_kb = os.path.getsize(file_path) / 1024
    print(f"✅ 文件大小: {size_kb:.1f} KB")
    
    # 更多检查逻辑...
    print("✅ 基本校验通过")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python validate.py <合同文件路径>")
        sys.exit(1)
    check_contract(sys.argv[1])
```

确保脚本可以在本地运行：

```bash
python3 ~/my-skills/contract-reviewer/scripts/validate.py /path/to/contract.pdf
```

### 4.8 可选：agents/ 和 assets/

| 目录 | 用途 | 何时需要 |
|------|------|----------|
| `agents/` | 定义可被主 Skill 调用的子 Agent，每个子 Agent 有独立的 Markdown 指令文件 | 任务复杂、需要多个 AI 角色协作时 |
| `assets/` | 存放静态资源，如模板文件、示例文档、图片 | Skill 需要输出固定格式报告、或提供示例给 AI 参考时 |

`agents/` 示例：

```
contract-reviewer/
└── agents/
    ├── clause-extractor.md    ← 专门负责提取条款的子 Agent
    └── risk-assessor.md       ← 专门负责风险评估的子 Agent
```

`assets/` 示例：

```
contract-reviewer/
└── assets/
    ├── report-template.md     ← 审查报告输出模板
    └── sample-contract.pdf    ← 示例合同（用于测试）
```

---

## 5. Skill 目录结构详解

完整的 Skill 结构示例：

```
contract-reviewer/                  ← Skill ID（目录名，用连字符，小写）
│
├── SKILL.md                        ← 【必须】技能描述 + AI 指令
│   # YAML frontmatter:
│   #   name: contract-reviewer
│   #   description: 法务合同审查技能
│   # body: 给 AI 的详细指令
│
├── references/                     ← 【建议】参考资料（AI 可读）
│   ├── contract-standards.md       # 合同规范文档
│   ├── required-clauses.md         # 必填条款清单
│   └── legal-glossary.md           # 法律术语表
│
├── scripts/                        ← 【建议】可执行脚本（AI 可调用）
│   ├── validate.py                 # 合同基本校验
│   ├── extract-clauses.sh          # 条款提取脚本
│   └── generate-report.py          # 生成报告脚本
│
├── agents/                         ← 【可选】子 Agent 定义
│   └── risk-assessor.md            # 风险评估子 Agent
│
└── assets/                         ← 【可选】静态资源
    ├── report-template.md          # 报告输出模板
    └── sample-contract.pdf         # 测试用示例合同
```

**命名规范**：

| 规范 | 正确示例 | 错误示例 |
|------|---------|---------|
| 目录名用小写 + 连字符 | `code-reviewer` | `Code Reviewer`、`code_reviewer` |
| SKILL.md 大写 | `SKILL.md` | `skill.md`、`Skill.MD` |
| 脚本文件名用小写 | `validate.py` | `Validate.PY` |

---

## 6. 【可选】A2A 脚手架本地验证

如果你想在网页端直观验证 Skill 效果，可以使用 A2A 脚手架项目。

### 6.1 下载脚手架项目

```bash
cd ~
git clone https://github.com/aws300/a2a-scaffold.git
cd a2a-scaffold
```

### 6.2 配置 API Key

```bash
# 复制环境变量模板
cp .env.example .env
```

用文本编辑器打开 `.env` 文件，修改为以下内容（填入运维提供的实际值）：

```bash
# 取消注释并填写以下三行（删除行首的 # 号）
ANTHROPIC_BASE_URL=https://llmapi.example.com
ANTHROPIC_API_KEY=sk-ant-your_key_here
MODEL=anthropic://claude-sonnet-4-6
```

> **注意**：`.env` 文件包含密钥，不要上传到 git 或分享给他人。

### 6.3 放置你的 Skill

将开发好的 Skill 目录复制到脚手架的 skills 目录：

```bash
# 假设你的 Skill 在 ~/my-skills/contract-reviewer
cp -r ~/my-skills/contract-reviewer ./agent-config/skills/

# 检查目录结构是否正确
ls ./agent-config/skills/
# 应看到 contract-reviewer  example-skill
```

最终结构：

```
a2a-scaffold/
└── agent-config/
    └── skills/
        ├── example-skill/      ← 原有示例（保留即可）
        │   └── SKILL.md
        └── contract-reviewer/  ← 你的 Skill
            ├── SKILL.md
            ├── references/
            └── scripts/
```

### 6.4 启动服务

**方式 A：使用一键启动脚本（推荐）**

```bash
./start.sh
```

脚本会自动检测并选择 Docker 或本地模式启动。

**方式 B：指定本地模式**（需要 Python 3.13+ 和 Node 20+）

```bash
./start.sh local
```

**方式 C：指定 Docker 模式**（需要已安装 Docker）

```bash
./start.sh docker
```

### 6.5 打开网页验证

启动成功后，打开浏览器访问：

```
http://localhost:8080
```

你应该看到内置的聊天界面。

**验证 Skill 效果：**

在聊天框中直接发送和你 Skill 相关的请求，例如：

```
请帮我审查这份合同，检查必填条款是否完整：
[粘贴合同内容或上传文件]
```

**确认 Skill 已加载：**

点击页面右上角的 🔗 图标，查看 Agent Card，在 `skills` 字段中应能看到你的 `contract-reviewer`：

```json
{
  "skills": [
    {
      "id": "contract-reviewer",
      "name": "Contract Reviewer",
      "description": "法务合同审查技能，自动检查必填条款完整性"
    }
  ]
}
```

### 6.6 查看运行日志（排查问题）

如果 AI 响应不符合预期，查看终端日志：

```bash
# 日志中搜索 Skill 加载信息
# 正常加载会看到类似：
# [A2A Scaffold] Skills: /agent/config/skills
# strands.skills.loaded dir=...
```

---

## 7. 【可选】打包 Docker 交给运维内网部署

验证通过后，可以将整个服务打包为 Docker 镜像，交由运维部署到内网供更多同学测试。

### 7.1 构建 Docker 镜像

在 `a2a-scaffold` 目录下执行：

```bash
# 构建镜像，镜像名可以自定义，建议包含日期或版本号
docker build -t my-agent:v1.0 .
```

构建过程约 3-5 分钟，完成后验证：

```bash
docker images | grep my-agent
# 应看到类似：my-agent   v1.0   xxxxx   2 minutes ago   1.2GB
```

### 7.2 本地测试镜像

将 API Key 作为环境变量传入，验证镜像是否正常工作：

```bash
docker run -p 8080:8080 \
  -e ANTHROPIC_BASE_URL=https://llmapi.example.com \
  -e ANTHROPIC_API_KEY=sk-ant-your_key_here \
  -e MODEL=anthropic://claude-sonnet-4-6 \
  my-agent:v1.0
```

打开 http://localhost:8080 验证功能正常后，继续下一步。

### 7.3 导出镜像文件（交给运维）

```bash
# 将镜像导出为压缩文件
docker save my-agent:v1.0 | gzip > my-agent-v1.0.tar.gz

# 查看文件大小
ls -lh my-agent-v1.0.tar.gz
```

将生成的 `.tar.gz` 文件交给运维，并附上以下部署说明：

---

**运维部署说明（附件）**

```bash
# 1. 导入镜像
docker load < my-agent-v1.0.tar.gz

# 2. 运行服务（替换为实际密钥和端口）
docker run -d \
  --name my-agent \
  --restart unless-stopped \
  -p 8080:8080 \
  -e ANTHROPIC_BASE_URL=https://llmapi.example.com \
  -e ANTHROPIC_API_KEY=sk-ant-your_key_here \
  -e MODEL=anthropic://claude-sonnet-4-6 \
  my-agent:v1.0

# 3. 查看运行状态
docker ps | grep my-agent
docker logs my-agent

# 4. 访问地址（将 SERVER_IP 替换为服务器 IP）
# http://SERVER_IP:8080
```

---

### 7.4 更新 Skill 后重新打包

每次修改 Skill 内容后，需要重新构建镜像：

```bash
# 重新构建，版本号递增
docker build -t my-agent:v1.1 .
docker save my-agent:v1.1 | gzip > my-agent-v1.1.tar.gz
```

---

## 8. 常见问题

### Q: 提示 "command not found: claude"

**A:** Claude Code 未正确安装，或 npm 全局路径未加入 PATH。

```bash
# 检查 npm 全局路径
npm config get prefix
# 将 {prefix}/bin 加入 PATH，例如：
export PATH="$HOME/.npm-global/bin:$PATH"
```

### Q: Claude Code 启动后提示 API 连接失败

**A:** 检查环境变量是否正确设置：

```bash
echo $ANTHROPIC_BASE_URL   # 是否有值
echo $ANTHROPIC_API_KEY    # 是否有值
# 如果为空，重新执行 export 命令或重启终端
```

### Q: A2A 脚手架启动后看不到我的 Skill

**A:** 检查以下几点：

1. Skill 目录名是否全小写、用连字符（如 `contract-reviewer`）
2. Skill 目录下是否有 `SKILL.md` 文件（大写）
3. `SKILL.md` 是否有 `name` 和 `description` frontmatter

```bash
# 快速验证目录结构
find ./agent-config/skills -name "SKILL.md" -exec echo "✅ {}" \;
```

### Q: SKILL.md 的 frontmatter 应该怎么写

**A:** 最小必填格式：

```markdown
---
name: my-skill-name
description: 一句话描述这个技能是做什么的
---

（以下是给 AI 的指令内容）
```

### Q: references/ 里放什么格式的文件最好

**A:** 推荐优先级：`.md` > `.txt` > `.json` > `.pdf`。Word/Excel 文件建议先用工具转换为 Markdown 再放入。

### Q: 怎么判断 AI 是否真的在用我的 Skill 里的内容

**A:** 在对话中直接问 AI：

```
你当前加载了哪些技能？请列出你的审查依据来自哪个参考文档。
```

AI 会告知它参考的内容来源。

---

## 附录：快速检查清单

开发完成后，对照以下清单自查：

- [ ] `SKILL.md` 存在，frontmatter 包含 `name` 和 `description`
- [ ] 目录名是 kebab-case（小写字母 + 连字符）
- [ ] `references/` 中的文档为纯文本或 Markdown 格式
- [ ] `scripts/` 中的脚本可以独立运行（已本地测试过）
- [ ] 在 Claude Code 中用自然语言测试过核心场景
- [ ] 【如做了本地验证】在 `http://localhost:8080` 看到 Skill 出现在 Agent Card 中
- [ ] 【如做了本地验证】在网页端完成了至少一次端到端对话测试
