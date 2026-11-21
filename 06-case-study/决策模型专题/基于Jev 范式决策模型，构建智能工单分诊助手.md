# 基于Jev 范式决策模型，构建智能工单分诊助手

在上一篇《[开发框架：让 Agent 学会判断，从 Jev 接入到完整 Harness 决策流程](<./开发框架：让 Agent 学会判断，从 Jev 接入到完整 Harness 决策流程.md>)》里，我们介绍了如何用客户端组件把结构化判断嵌进 AgentScope Java 的 Harness 流程。但框架跑通只是第一步——真正把一个 Agent 搬到生产线上，还得回答三个现实问题：国内网络环境下模型服务怎么接、写好的业务工程怎么打包部署免维护镜像，以及高优先级故障单怎么和人类或团队里的其他 Agent 交接协同？

这篇文章用一个**智能工单分诊助手**把开发、打包、上线、排障和团队协作串成一条完整链路：用 **AgentScope Java + 百炼 System One 决策模型**做稳定分诊（替代国内网络不便直连的 TypeSafe Jev），通过**代码包部署**上线到阿里云 AgentCore，验证普通调用与流式响应，最后再把它接入 AgentCore Team，参与工单分派与报告复核。

选择代码包部署的核心原因很务实：**团队只想管好自己的业务代码和依赖，不想为每个小助手单独搭一套容器镜像构建与维护流水线。** 把应用与运行期依赖打成一个压缩包交给平台，基础运行环境、健康检查与弹性扩缩由 AgentCore 承接，开发者就能把精力全留在分诊规则与业务工具上。

## 1. 业务场景：为什么工单分诊需要“决策模型 + 生成模型”打配合？

企业工单池里，每天同时涌进各种轻重缓急完全不同的请求。比如下面这两张典型工单：

> **工单 A**：生产登录接口全部返回 502，所有用户无法登录，十分钟前开始，尚未确认根因。\
> **工单 B**：申请补开上月发票，没有服务中断。

值班同学接单前必须先干两件事：**第一，立刻定下类别和优先级**——登录 502 影响全量用户属于 P1 故障，必须马上响应；补开发票属于计费类常规工单（P3），按账期流程排期即可。**第二，按类别查材料、写排查建议**——登录故障要去拉近期发布记录和故障手册，补开发票要去对订单主体和开票状态。

如果把“定级”和“写建议”全打包扔给同一个生成式大模型，很容易出现“大促高峰一来响应慢、或者同一类故障昨天判 P1 今天判 P2”的漂移问题。更稳妥的工程拆法是让专业角色各干各的：

- **百炼专用决策模型**：只负责看懂工单描述、按照企业预设分级标准输出结构化的**类别与优先级**，快且口风稳。
- **业务工具 + 生成模型（`qwen-plus`）**：拿到分诊结果后，由 AgentScope Java 编排 ReAct 循环去查工单记录和对应处理手册，再由生成模型整理成带依据的排查建议和“待人工确认项”，交给值班人员拍板。
- **AgentCore 运行底座与 Team 扩展**：通过代码包把已有高代码工程直接搬上云，后续遇上需要多方协同的重大故障单，再按需接入 Team 协作。

![图 1](../../assets/imgs/jev/agentcore-ticket-01.png)

图 1：代码包部署贯穿开发与上线；百炼提供运行时决策与生成能力，Team 是按业务需要接入的协作扩展。

## 2. 开发阶段：把分诊规则和业务工具装进现有工程

因为分级条件、结果校验和工单库查询都要严密贴合企业内部规则，这类场景并不适合纯靠拖拉拽低代码硬凑，更合适采用高代码方式在现有工程里维护。AgentScope Java 负责组织模型和工具调用，需要访问平台托管的模型、MCP 工具、Skill、记忆或凭据时，通过 AgentCore SDK 接入即可。

AgentCore SDK 已在 GitHub 开源，支持多语言与主流框架直接复用现有技术栈：

| 开发语言 | 已提供适配的主流框架 | 开源仓库 |
| --- | --- | --- |
| [Java](https://help.aliyun.com/zh/agentcore/agentcore-java-sdk-usage-guide) | AgentScope Java、Spring AI、LangChain4j | [agentcore-sdk-java](https://github.com/ai-agentcore/agentcore-sdk-java) |
| [Python](https://help.aliyun.com/zh/agentcore/agentcore-python-sdk-user-guide) | AgentScope、LangChain / LangGraph、Google ADK、Pydantic AI、CrewAI | [agentcore-sdk-python](https://github.com/ai-agentcore/agentcore-sdk-python) |
| [JavaScript / TypeScript](https://help.aliyun.com/zh/agentcore/agentcore-node-js-sdk-user-guide) | LangChain / LangGraph、Google ADK、Mastra、AI SDK | [agentcore-sdk-nodejs](https://github.com/ai-agentcore/agentcore-sdk-nodejs) |

在 Java 工单助手工程中，先引入基础 SDK 与 AgentScope 适配依赖（模型 Provider 仍按业务需要照常引入）：

```xml
<properties>
    <agentcore.version>0.1.3</agentcore.version>
</properties>

<dependencies>
    <dependency>
        <groupId>io.github.ai-agentcore</groupId>
        <artifactId>agentcore-sdk</artifactId>
        <version>${agentcore.version}</version>
    </dependency>
    <dependency>
        <groupId>io.github.ai-agentcore</groupId>
        <artifactId>agentcore-sdk-agentscope</artifactId>
        <version>${agentcore.version}</version>
    </dependency>
</dependencies>
```

### 第一环：先用决策模型把“类别 + 优先级”卡死

光是分清“这是技术问题”远远不够。“全部用户无法登录”和“个别用户登录偏慢”同属技术工单，但紧急度天差地别。因此送给决策模型的条件定义里，必须把**影响范围与对应级别**（如全部用户或核心业务中断定 P1，普通咨询或无服务中断定 P3）写透。

AgentScope Java 官方提供了封装好类型化请求、结果解析与校验的扩展客户端（详见 [Jev 决策模型扩展指南](https://github.com/agentscope-ai/agentscope-java/blob/main/docs/v2/zh/jev/guides/client.md)），海外或可连通环境可直接接 TypeSafe Jev。国内落地时，我们选用兼容同款 System One 接口规范的[百炼决策模型](https://help.aliyun.com/zh/model-studio/decision-model-api)（模型名 `decision-model-preview`），在工程中封装一个决策客户端，提交工单原文与分类标准，直接取回结构化的类别和优先级；助手在代码里还会做一层白名单校验，确保返回值落回预设选项之后再放行到下一步。

### 第二环：带着定级结论去查库、翻手册、出建议

定好级之后，助手才开始调工具查实据。工程里把“查工单明细（返回影响范围、报错日志线索、近期发布记录）”和“查处理手册”分别注册为两个 AgentScope 工具（`lookup_ticket` 与 `lookup_runbook`）。

代码执行顺序非常清晰：**先由决策客户端给出分诊定级，再把工单原文连同分诊结果一并喂给装配了查询工具的 ReActAgent（底层通过 AgentCore 工作空间调用 `qwen-plus`）**。注意我们在拼接上下文时明确加了一句约束——“分类不是根因结论”，防止生成模型偷懒直接把分诊标签当成最终排障结论：

```java
var decision = decisionClient.classify(input);
String content = input
    + "\n百炼决策模型分诊结果（分类不是根因结论）：" + Main.json(decision);
var agent = ReActAgent.builder().name("triage")
    .model(model).toolkit(toolkit)
    .sysPrompt(prompt).maxIters(6).build();
String text = agent.call(List.of(new UserMessage(content)), context)
    .block(Duration.ofSeconds(150)).getTextContent();
```

最后，应用向外暴露兼容 OpenAI Chat Completions 协议的 HTTP 接口。在本地测试通过后，就可以直接打包发到云上。

## 3. 代码包部署：不写 Dockerfile 也能把应用跑上云

如果你的团队已经有成熟稳定的镜像流水线、或者需要塞进特殊系统组件，可以选择[容器镜像部署](https://help.aliyun.com/zh/agentcore/high-code-agent-deployment-guide)；而像这个工单助手一样只需要标准 Java 运行环境的业务，走 **AgentCore 代码包部署**省事得多（平台内置 Python、Node.js 和 Java 基础环境）。

打包完全沿用团队习惯的 Maven 流程：
1. 把业务代码、AgentScope 和 SDK 等全部运行期依赖打成一个可执行包 `app.jar`；
2. 把这个 JAR 放到 ZIP 压缩包的根目录，做成待发布的代码包；
3. 上传方式任选其一——本地小步联调直接上传 ZIP，接入 CI/CD 流水线则把包推到 OSS 后再从 OSS 导入。

![图 2](../../assets/imgs/jev/agentcore-ticket-02.png)

图 2：代码包创建入口，支持选择运行环境、本地上传与 OSS 导入。

部署参数填写同样和本地启动保持一致：运行环境选 **Java 17**，启动命令填 `java -jar app.jar`，监听端口填 **8080**。平台会自动解压代码包、拉起进程并用健康检查探活，就绪后配好服务入口和鉴权，上游工单系统就能直接调用。

![图 3](../../assets/imgs/jev/agentcore-ticket-03.png)

图 3：工单助手的部署配置，集中展示代码包来源、运行环境与启动参数。

### 上线实测：普通调用与流式调用效果

把开头的两张演示工单发给已部署的服务入口，同时覆盖后端异步接收（普通调用）和工单工作台实时展示（流式调用）两种方式：

- **收到全员登录 502 工单**：助手准确判为“技术故障、P1”，并自动查出日志线索与发布记录生成报告：
  > 工单类别与优先级：技术故障，P1。已知事实：登录接口返回 502，影响全部用户；日志线索为 `upstream_connect_error`，近期有应用发布。排查建议：检查上游健康、连接池、超时设置和近期发布，保留请求 ID 与相关日志。人工确认事项：上游当前是否可达，近期变更是否有关联，是否需要由值班负责人授权修复或回退。
- **收到补开发票工单**：助手立刻切到“计费类、P3”，拉出的处理依据也切换成发票处理手册，围绕账期、订单主体和开票状态给出核对清单。

## 4. 线上运维：弹性抗峰、日志追踪与代码包热更新

登录系统一旦炸掉，几分钟内就会有成百上千张同源工单涌进来；故障恢复后流量又瞬间掉回谷底。靠人工预估峰值常备大规格机器既浪费又容易被打挂，接入 [AgentCore 弹性运行能力](https://www.aliyun.com/product/agentcore) 后，平台会根据并发策略自动扩缩实例、并在波峰过去后回收空闲资源。

![图 4](../../assets/imgs/jev/agentcore-ticket-04.png)

图 4：工单助手的运行实例与 Session 监控，直观掌握实时并发与会话负载。

排查线上异常（比如某张单子半天没吐出建议，或者分诊结果不理想）时，在控制台中把实例状态、Session 占用与运行日志放在了同一套视图下：启用日志采集并绑定 SLS 日志库（Logstore）后，每条请求的请求 ID、执行耗时、决策模型给的分类结果以及 Agent 调了哪张工单、翻了哪本手册都能一一对上账，方便带着现场线索回本地改规则。详见[高代码 Agent 运行与排障说明](https://help.aliyun.com/zh/agentcore/high-code-agent-deployment-guide)。

日常需要接入真实工单库或微调 P1/P3 判定口径时，直接在本地工程修改测试后重打代码包更新即可。这里有一个很贴心的安全细节：**如果代码包放在 OSS，往 OSS 上传覆盖新包并不会立刻篡改正在跑的线上服务**——AgentCore 在创建或更新 Agent 时会单独保存一份代码包快照，只有你显式点击触发 Agent 更新才会拉取新包部署，发布节奏完全由团队自己把控。

## 5. 进阶扩展：接入 AgentCore Team 跑通“分派—处理—验收”

单兵助手已经能接单写建议，但真遇上 P1 级大故障，工单背后往往还得有值班 Leader 拆任务、跟进度、最后还要有人审过报告才算闭环。为了不让处理过程散落在聊天窗口里反复扯皮，可以把这个高代码工单助手接入 **AgentCore Team**，让它作为团队里的专业 Worker 干活、交报告。

> 注：高代码 Agent 协作能力目前采用白名单开放机制，有体验需求可提交工单联系支持团队申请开通。

在 Team 协作模式下，每项子任务、执行过程和交付报告文件都挂在同一个任务上下文里，后续接手的人直接看记录和报告提修改意见就行（详见[了解 Team 任务](https://help.aliyun.com/zh/agentcore/using-team-tasks)）。在刚才的登录故障案例里，团队分工如下：

| 参与者 | 角色定位 | 承担职责 |
| --- | --- | --- |
| 托管 Agent | Leader | 拆解并分派登录故障分析任务，审核 Worker 交上来的报告 |
| 工单分诊助手（高代码） | Worker | 复用已部署分诊能力，查工单与手册并交付结构化报告 |
| 人类值班员 | 验收方 | 补充需求约束、参与关键确认，并验收最终报告 |

![图 5](../../assets/imgs/jev/agentcore-ticket-05.png)

图 5：登录故障工单的 Team 任务记录，清晰呈现子任务分派、Worker 提交、Leader 审核与用户验收全过程。

### 接入协作 SDK（最小改动）

让已有助手加入协作并不需要推翻重写，只要在原工程里再引入 `agentcore-collaboration`（版本 `0.1.0`，基础 SDK 与 AgentScope 适配继续沿用 `0.1.3`）：

```xml
<dependency>
    <groupId>io.github.ai-agentcore</groupId>
    <artifactId>agentcore-collaboration</artifactId>
    <version>0.1.0</version>
</dependency>
```

通过协作 SDK 自动装配任务领取、文件交付等团队工具（同时过滤掉不需要的命令行执行工具以收紧权限），再把 Worker 协作规范合并进原有提示词里（`collaboration` 实例随应用复用，在应用关闭时释放）：

```java
var workspace = Path.of(".");
var collaboration = Collaboration.auto(workspace);
var workerTools = new ArrayList<>(collaboration.tools().block());
Skill.tools(collaboration.skills().block(), workspace).stream()
    .filter(tool -> !"execute_command".equals(tool.name()))
    .forEach(workerTools::add);

workerTools.forEach(tool ->
    toolkit.registerAgentTool(AgentCoreAgentScope.tool(tool)));
var worker = ReActAgent.builder().name("ticket-worker")
    .model(model).toolkit(toolkit)
    .sysPrompt(collaboration.composePrompt(businessPrompt))
    .maxIters(18).build();
```

并在收到平台可信请求时，从请求头提取任务上下文并塞进运行上下文，确保所有工具动作和产出的文件准确归档到当前任务名下（普通调用与流式调用传递方式完全一致）：

```java
var taskContext = CollaborationContext.fromHeaders(trustedHeaders);
var contextBuilder = RuntimeContext.builder().sessionId(sessionId);
if (taskContext != null) {
    contextBuilder.put(CollaborationContext.KEY, taskContext);
}
var context = contextBuilder.build();
var response = worker.call(List.of(new UserMessage(input)), context)
    .block(Duration.ofSeconds(150));
// 流式调用使用 worker.streamEvents(new UserMessage(input), context)
```

重新打好代码包更新 Agent 后，工单助手就能直接在 Team 里接单、交付 `report.md`。Leader 和值班人员打开报告即可一眼核对 P1 定级依据、已查明的事实、排查建议和待确认事项，不用再从十几轮对话日志里人肉拼结论。完整接口见 [Java 协作 SDK](https://github.com/ai-agentcore/agentcore-sdk-java/blob/main/collaboration/README.md)。

![图 6](../../assets/imgs/jev/agentcore-ticket-06.png)

图 6：工单助手在 Team 任务中交付的 `report.md`，审核人员可直接预览核对依据与建议。

## 总结

回顾整个实战方案，它之所以跑得顺手，在于每层技术选型都踩在了合适的职责边界上：

- **用专用决策模型卡住结构化分诊**，保证每张工单的类别与优先级输出快、口风稳、方便代码校验；
- **用高代码工程接活企业内部系统**，查工单库、翻排障手册、调优分级规则全部留在团队可控的 Java 代码里；
- **用 AgentCore 代码包 + Team 托底运行与协同**，免去自己维护镜像和弹性伸缩基建的负担，有跨角色协作需求时随时平滑接入。

如果你手里已经有现成的业务 Agent 脚本或工程想搬上生产，可以前往[阿里云 AgentCore 控制台](https://agentcore.console.aliyun.com/)直接用代码包方式试跑部署。
