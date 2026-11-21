<script setup>
import { onMounted, watch } from "vue";
import { useRoute, useRouter, withBase } from "vitepress";
import DefaultTheme from "vitepress/theme";
import ReaderTools from "./components/ReaderTools.vue";

const route = useRoute();
const router = useRouter();

watch(
  () => route.path,
  () => {
    if (typeof window !== "undefined") window.__handbookDidSpaNav = true;
  },
);

onMounted(() => {
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register(withBase("/sw.js")).catch(() => {});
  }
  navigator.storage?.persist?.().catch(() => {});

  try {
    const params = new URLSearchParams(location.search);
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      navigator.standalone === true ||
      params.get("pwa") === "1";
    const sessionStarted =
      sessionStorage.getItem("handbook:session_started") === "1";
    sessionStorage.setItem("handbook:session_started", "1");

    const homePaths = new Set([withBase("/"), withBase("/index.html")]);
    if (
      isStandalone &&
      !sessionStarted &&
      homePaths.has(location.pathname) &&
      !location.hash
    ) {
      const saved = JSON.parse(localStorage.getItem("handbook:last") || "null");
      const targetPath =
        saved?.pathname || (saved?.href || "").split("#")[0] || "";
      if (
        targetPath &&
        targetPath.startsWith(withBase("/")) &&
        !targetPath.startsWith("//") &&
        !homePaths.has(targetPath)
      ) {
        sessionStorage.setItem("handbook:pending_restore", "1");
        router.go(targetPath);
      }
    }
  } catch {
    /* Storage or router errors should never block reading. */
  }
});
</script>

<template>
  <DefaultTheme.Layout>
    <template #doc-before><ReaderTools /></template>
    <template #doc-after>
      <p class="book-feedback">
        发现问题或有实践经验想分享？
        <a
          href="https://github.com/namelessssssssssss/ai-agent-handbook/issues"
          target="_blank"
          rel="noopener noreferrer"
          >参与本书讨论 ↗</a
        >
      </p>
    </template>
  </DefaultTheme.Layout>
</template>
