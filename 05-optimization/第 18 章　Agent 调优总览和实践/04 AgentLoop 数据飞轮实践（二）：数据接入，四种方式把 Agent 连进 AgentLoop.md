# AgentLoop 数据飞轮实践（二）：数据接入，四种方式把 Agent 连进 AgentLoop

> **AgentLoop 数据飞轮实践系列** · 第 2 篇 / 共 5 篇
>
> 上一篇：[总览，让 Agent 持续调优的闭环](./03%20AgentLoop%20%E6%95%B0%E6%8D%AE%E9%A3%9E%E8%BD%AE%E5%AE%9E%E8%B7%B5%EF%BC%88%E4%B8%80%EF%BC%89%EF%BC%9A%E6%80%BB%E8%A7%88%EF%BC%8C%E8%AE%A9%20Agent%20%E6%8C%81%E7%BB%AD%E8%B0%83%E4%BC%98%E7%9A%84%E9%97%AD%E7%8E%AF.md) ｜ 下一篇：[评估，从黄金指标到 Rubric](./05%20AgentLoop%20%E6%95%B0%E6%8D%AE%E9%A3%9E%E8%BD%AE%E5%AE%9E%E8%B7%B5%EF%BC%88%E4%B8%89%EF%BC%89%EF%BC%9A%E8%AF%84%E4%BC%B0%EF%BC%8C%E4%BB%8E%E9%BB%84%E9%87%91%E6%8C%87%E6%A0%87%E5%88%B0%20Rubric.md)

没有真实运行数据，后面观测、评估和实验都是空转。但把 Agent 的数据接上来比传统微服务麻烦得多：有的团队直接用现成的通用 Agent，有的基于框架开发，有的是纯手写高代码，还有的老系统压根不敢改代码。这一篇讲两件事：底层协议和四种接法怎么设计，以及怎么在十分钟内把演示用的 Claude Code 客服 Agent 真正接进平台。

## 一、技术底座：OTel 标准协议 + 探针

AgentLoop 的数据采集建立在 **OTel（OpenTelemetry）标准协议**和探针技术之上：

![AgentLoop 数据飞轮实践（二）配图 1](../../assets/imgs/chapter-18/image-024.png)

*图 1：基于 OTel 标准协议的探针接入*

探针会在不改动核心业务逻辑的前提下，自动把 Agent 里每一次模型调用、每一次工具执行都用同一个 Trace ID 串起来，把上下文依赖还原成一张 **Trace 拓扑图**，再组装出完整的思考与执行轨迹：

![AgentLoop 数据飞轮实践（二）配图 2](../../assets/imgs/chapter-18/image-025.png)

*图 2：Trace 拓扑：探针以 Trace ID 串联模型调用与工具调用，还原完整执行轨迹（示意图，依据演示描述绘制）*

用 OTel 当底座有个长远好处——标准开放、不绑定单一厂商，今天接进来的监控数据未来也能直接喂给任何兼容 OTel 的生态工具。

## 二、四种接入方式（按改造成本从低到高挑）

### 1. 通用 Agent：一键对接

针对市面上常见的开箱即用型通用 Agent，平台已经预先适配好专有埋点，几乎不用写代码就能直接对接。

### 2. Agent 框架：SDK 集成

如果 Agent 是基于 AgentScope 这类成熟框架写的，直接引框架级集成即可（图 3）：框架本来就知道模型调用、工具调度发生在哪里，SDK 会在关键节点自动采集，业务代码无感。

![AgentLoop 数据飞轮实践（二）配图 3](../../assets/imgs/chapter-18/image-026.png)

*图 3：基于 AgentScope 框架的 Agent 通过集成方式接入*

### 3. 自定义高代码：注解埋点

如果是纯自研高代码项目（包括用 AI Coding 工具手写的 Agent），引入依赖包后在想观测的函数或逻辑段加上注解就能上报（图 4）。如果用 AI 辅助写代码，补几行注解埋点基本零门槛。

![AgentLoop 数据飞轮实践（二）配图 4](../../assets/imgs/chapter-18/image-027.png)

*图 4：自定义高代码接入：依赖包 + 注解方式采集*

### 4. eBPF：内核级无侵入兜底

对完全不能改一行代码的存量应用或闭源组件，还有 **eBPF** 方案（图 5）：直接从操作系统内核层监听 Agent 发往模型网关的流量和执行的工具命令，对应用进程完全透明，特别适合先零改造看看数据长什么样。

![AgentLoop 数据飞轮实践（二）配图 5](../../assets/imgs/chapter-18/image-028.png)

*图 5：eBPF 无侵入接入：内核级监控*

四种接法不是非此即彼，核心原则就一条：**照着自己 Agent 的形态，选改造成本最低的那条路先接上**。

## 三、两个必填字段：Service Name 与 License Key

所有数据都汇总在同一个 AgentSpace（工作空间）里，上手接入时先配好两个基础字段：

![AgentLoop 数据飞轮实践（二）配图 6](../../assets/imgs/chapter-18/image-029.png)

*图 6：Service Name 区分应用，License Key 用于鉴权*

- **Service Name**：数据归属标识。同一个空间下往往跑着好几个 Agent，靠它区分数据来自哪个应用，后面的观测和评估也靠它圈定范围；
- **License Key**：数据通行证。上报链路时的身份鉴权凭证，缺了它数据进不来。

## 四、实操：把 Claude Code 客服 Agent 接进平台

演示用的客服 Agent 基于 **Claude Code / Claude Agent SDK** 构建。这类 Agent 可以挂探针，也可以走它原生支持的 webhook 把事件推出来。本次演示采用 **Claude Code webhook + LoongSuite Pilot** 这条更轻量的路线，前后不到十分钟走完四步：

### 步骤 1：拿 License Key 并执行一键安装

在控制台取到 License Key 后，直接在机器上跑安装命令（图 7），它会自动装好依赖和采集组件：

![AgentLoop 数据飞轮实践（二）配图 7](../../assets/imgs/chapter-18/image-030.png)

*图 7：在机器上执行安装命令，部署 LoongSuite Pilot*

### 步骤 2：弄懂「旁路进程」为什么安全

这套链路（图 8）的设计亮点在于 **LoongSuite Pilot 是独立旁路进程**：Claude Code 触发 webhook 把交互事件发给 Pilot，再由 Pilot 异步上报云端。因为不在主执行链路上，哪怕网络抖动发不出去数据，Agent 照样正常回用户消息，不会把主业务拖挂。

![AgentLoop 数据飞轮实践（二）配图 8](../../assets/imgs/chapter-18/image-031.png)

*图 8：采集链路：Claude Code 经 webhook 发送到 LoongSuite Pilot 旁路进程，再上报云端（示意图）*

### 步骤 3：拷贝配置并重启（最容易漏掉的坑）

安装命令会把 hooks 自动写进 Claude Code 默认路径的 `settings.json`（图 9）。**千万注意**：一定要把这份带 hooks 的 `settings.json` **拷贝到你自己 Agent 的实际安装目录下，并重启 Agent**。忘了拷贝或者没重启，数据根本不会发出来。

![AgentLoop 数据飞轮实践（二）配图 9](../../assets/imgs/chapter-18/image-032.png)

*图 9：settings.json 里已安装好 hooks*

### 步骤 4：发一条测试消息并去观测页验真

重启后向客服 Agent 发一条测试提问，然后打开控制台的 **观测** 页面（图 10）。不光要看到条目冒出来，还要点开链路明细（图 11），确认连 **大模型的处理步骤** 也完整串在链路上，才算真正验收通过。

![AgentLoop 数据飞轮实践（二）配图 10](../../assets/imgs/chapter-18/image-033.png)

*图 10：观测页已能看到上报的数据*

![AgentLoop 数据飞轮实践（二）配图 11](../../assets/imgs/chapter-18/image-034.png)

*图 11：链路明细中可见大模型处理步骤*

## 五、小结

| 要点 | 说明 |
| --- | --- |
| 协议底座 | OTel 标准协议 + 探针，Trace ID 串联全链路 |
| 四种方式 | 通用 Agent 一键对接 / Agent 框架集成 / 高代码注解 / eBPF 无侵入 |
| 两个概念 | Service Name（区分应用）、License Key（鉴权） |
| Claude Code 实操 | webhook + LoongSuite Pilot 旁路进程，拷贝 settings、重启生效 |
| 验证方式 | 观测页查看上报数据与链路明细 |

---

**下一篇预告**：数据进来了，怎么回答「Agent 到底跑得怎么样」？下一篇从业务黄金指标出发，教你用 AI 拆解出可执行、可解释的 Rubric，配好评估器并跑出第一份诊断报告——[详见第 3 篇](./05%20AgentLoop%20%E6%95%B0%E6%8D%AE%E9%A3%9E%E8%BD%AE%E5%AE%9E%E8%B7%B5%EF%BC%88%E4%B8%89%EF%BC%89%EF%BC%9A%E8%AF%84%E4%BC%B0%EF%BC%8C%E4%BB%8E%E9%BB%84%E9%87%91%E6%8C%87%E6%A0%87%E5%88%B0%20Rubric.md)。
