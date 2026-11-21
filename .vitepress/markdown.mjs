import { getPage, resolveBookLink } from "./book.mjs";

// Keep previously published section links valid when editorial numbering changes.
// Keys are stable public page URLs and the current generated heading IDs.
export const legacyHeadingIds = {
  "/architecture/chapter-01.html": {
    "第-01-章-ai-原生应用的新阶段": "第-1-章-ai-原生应用的新阶段",
  },
  "/architecture/chapter-02.html": {
    "第-02-章-agentic-application-参考架构": "第-2-章-agentic-application-参考架构",
  },
  "/build/chapter-03.html": {
    "第-03-章-范式-harness-的主流构建方式和责任边界": "第-3-章-范式-harness-的主流构建方式和责任边界",
  },
  "/build/chapter-04.html": {
    "第-04-章-任务-编排、长程推进与协作流转": "第-4-章-任务-编排、长程推进与协作流转",
    "_4-1-agent-loop-与任务状态机-别让聊天记录代替任务账本": "_4-1-2-用权威状态驱动任务",
    "_4-4-异步任务与长程续行-别让断网、超时或重启毁掉半小时的活": "_4-4-1-让任务脱离当前连接持续存在",
    "_4-6-可靠性与-用证据交差-怎么对症恢复、怎么叫停死循环、怎么才算真完成": [
      "_4-6-1-针对失败类型选择恢复策略",
      "_4-6-2-让完成由证据决定",
    ],
  },
  "/build/chapter-05.html": {
    "第-05-章-信息-上下文、状态与可复用能力资产": "第-5-章-信息-上下文、状态与可复用能力资产",
    "_5-4-memory-与企业-knowledge-分清-历史经验-与-官方事实": [
      "memory-的写入与使用",
      "让-knowledge-提供事实、memory-提供经验",
    ],
    "_5-6-多租户资产治理与反退化-防串台、防投毒、删得干净": "用作用域和元数据建立资产边界",
  },
  "/build/chapter-06.html": {
    "第-06-章-行动-受控执行、验证反馈与交付准备": "第-6-章-行动-受控执行、验证反馈与交付准备",
  },
  "/run/chapter-07.html": {
    "第-07-章-agent-运行时与沙箱": "第-7-章-agent-运行时与沙箱",
  },
  "/run/chapter-08.html": {
    "第-08-章-agent-状态存储与语义资产": "第-8-章-agent-状态存储与语义资产",
  },
  "/run/chapter-09.html": {
    "第-09-章-ai-网关与统一流量治理": "第-9-章-ai-网关与统一流量治理",
  },
  "/run/chapter-11.html": {
    "第-11-章-multi-agent-协作与编排": "第-11章-multi-agent-协作与编排",
  },
  "/cases/chapter-25/": {
    "第-25-章-研发效能": "第25章-研发效能",
  },
  "/cases/chapter-26/": {
    "第-26-章-设计工程": "第26章-设计工程",
  },
  "/cases/chapter-27/": {
    "第-27-章-运维、安全与企业-it": "第27章-运维、安全与企业-it",
  },
  "/cases/chapter-28/": {
    "第-28-章-客户、销售与运营": "第28章-客户、销售与运营",
  },
};

export function bookMarkdown(md) {
  const headingOpen = md.renderer.rules.heading_open;
  md.renderer.rules.heading_open = (tokens, index, options, env, self) => {
    const html = headingOpen
      ? headingOpen(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
    const page = getPage(env.relativePath || "");
    const oldId = legacyHeadingIds[page?.href]?.[tokens[index].attrGet("id")];
    const oldIds = Array.isArray(oldId) ? oldId : oldId ? [oldId] : [];
    return html + oldIds.map((id) => `<span id="${md.utils.escapeHtml(id)}"></span>`).join("");
  };

  md.core.ruler.after("inline", "book-links", (state) => {
    const page = getPage(state.env.relativePath || "");
    if (!page) return;
    function walk(tokens) {
      for (const token of tokens) {
        if (token.type === "link_open")
          token.attrSet(
            "href",
            resolveBookLink(token.attrGet("href"), page.source),
          );
        if (token.type === "image")
          token.attrSet(
            "src",
            resolveBookLink(token.attrGet("src"), page.source),
          );
        if (token.children) walk(token.children);
      }
    }
    walk(state.tokens);
  });

  const text = md.renderer.rules.text;
  md.renderer.rules.text = (tokens, index, options, env, self) => {
    const html = text
      ? text(tokens, index, options, env, self)
      : md.utils.escapeHtml(tokens[index].content);
    return html.replace(
      /\{\{[\s\S]*?\}\}/g,
      (match) => `<span v-pre>${match}</span>`,
    );
  };
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (token.info.trim() === "mermaid")
      return `<MermaidDiagram code="${encodeURIComponent(token.content)}" />\n`;
    return fence(tokens, index, options, env, self);
  };
}
