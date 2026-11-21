<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import { useData, useRoute } from "vitepress";

const { frontmatter, page } = useData();
const route = useRoute();
const size = ref("normal");
const progress = ref(0);
const viewer = ref(null);
const media = ref({ src: "", alt: "" });
const printing = ref(false);
const resumeToast = ref("");
const swAvailable = ref(false);
const mediaState = ref({
  done: 0,
  total: 0,
  loading: false,
  finished: false,
});

let timer;
let toastTimer;
let objectUrl;
let restoring = false;
let restoreTimers = [];
let interruptBound = false;

const offlineLabel = computed(() => {
  if (mediaState.value.loading) {
    return `缓存中 ${mediaState.value.done}/${mediaState.value.total}`;
  }
  if (
    mediaState.value.finished ||
    (mediaState.value.total > 0 &&
      mediaState.value.done >= mediaState.value.total)
  ) {
    return "插图已离线 ✓";
  }
  return "离线插图";
});

const offlineTitle = computed(() =>
  mediaState.value.total > 0
    ? `已离线缓存 ${mediaState.value.done}/${mediaState.value.total} 张配图，点击补充缓存全书插图`
    : "离线缓存全书插图",
);

function setSize(value) {
  size.value = value;
  document.documentElement.dataset.readingSize = value;
  try {
    localStorage.setItem("handbook:size", value);
  } catch {}
}

function readLast() {
  try {
    return JSON.parse(localStorage.getItem("handbook:last") || "null");
  } catch {
    return null;
  }
}

function computeProgress() {
  const doc = document.querySelector(".vp-doc");
  if (!doc) return { range: 0, pct: 0, ratio: 0 };
  const range = Math.max(0, document.documentElement.scrollHeight - innerHeight);
  const ratio = range > 0 ? Math.min(1, Math.max(0, scrollY / range)) : 0;
  const pct = range > 0 ? Math.min(100, Math.round(ratio * 100)) : 100;
  return { range, pct, ratio };
}

function saveProgress() {
  if (restoring) return;
  const doc = document.querySelector(".vp-doc");
  if (!doc) return;
  const { pct, ratio } = computeProgress();
  progress.value = pct;
  if (!frontmatter.value.bookPart) return;
  const headings = [...doc.querySelectorAll("h2[id], h3[id]")];
  const current = headings
    .filter((h) => h.getBoundingClientRect().top < 150)
    .at(-1);
  const href =
    location.pathname + (current ? "#" + encodeURIComponent(current.id) : "");
  try {
    localStorage.setItem(
      "handbook:last",
      JSON.stringify({
        pathname: location.pathname,
        href,
        title: page.value.title,
        part: frontmatter.value.bookPart,
        scrollY: Math.round(scrollY),
        scrollRatio: Number(ratio.toFixed(6)),
        progress: pct,
        updatedAt: Date.now(),
      }),
    );
  } catch {}
}

function onScroll() {
  clearTimeout(timer);
  timer = setTimeout(saveProgress, 120);
}

function onVisibilityChange() {
  if (document.visibilityState === "hidden") saveProgress();
}

function showToast(text) {
  resumeToast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    resumeToast.value = "";
  }, 2500);
}

function onUserInterrupt() {
  cancelRestore();
  saveProgress();
}

function bindInterruptListeners() {
  if (interruptBound) return;
  interruptBound = true;
  window.addEventListener("touchstart", onUserInterrupt, {
    passive: true,
    once: true,
  });
  window.addEventListener("wheel", onUserInterrupt, {
    passive: true,
    once: true,
  });
  window.addEventListener("keydown", onUserInterrupt, { once: true });
}

function removeInterruptListeners() {
  if (!interruptBound) return;
  interruptBound = false;
  window.removeEventListener("touchstart", onUserInterrupt);
  window.removeEventListener("wheel", onUserInterrupt);
  window.removeEventListener("keydown", onUserInterrupt);
}

function cancelRestore() {
  for (const id of restoreTimers) clearTimeout(id);
  restoreTimers = [];
  restoring = false;
  removeInterruptListeners();
}

function scrollToRatio(ratio) {
  const range = Math.max(0, document.documentElement.scrollHeight - innerHeight);
  const targetY = Math.round(ratio * range);
  window.scrollTo({ top: targetY, behavior: "instant" });
}

function openImage(src, alt) {
  media.value = { src, alt };
  viewer.value?.showModal();
}

function imageClick(event) {
  const img = event.target.closest?.(".vp-doc img:not(.mermaid-diagram img)");
  if (img && !img.closest("a"))
    openImage(img.currentSrc || img.src, img.alt || "正文插图");
}

function imageKey(event) {
  if (event.key === "Enter" || event.key === " ") {
    if (event.target.matches('.vp-doc img[role="button"]')) {
      event.preventDefault();
      imageClick(event);
    }
  }
}

function diagramOpen(event) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(
    new Blob([event.detail.svg], { type: "image/svg+xml" }),
  );
  openImage(objectUrl, "Mermaid 图表");
}

function postSwMessage(payload) {
  try {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage(payload);
      return true;
    }
    navigator.serviceWorker?.ready
      ?.then((reg) => reg.active?.postMessage(payload))
      .catch(() => {});
  } catch {}
  return false;
}

function onSwMessage(event) {
  const data = event.data || {};
  if (data.type === "SW_OFFLINE_STATUS") {
    swAvailable.value = true;
    mediaState.value = {
      done: data.mediaDone || 0,
      total: data.mediaTotal || 0,
      loading: false,
      finished:
        (data.mediaTotal || 0) > 0 &&
        (data.mediaDone || 0) >= (data.mediaTotal || 0),
    };
  } else if (data.type === "SW_MEDIA_PROGRESS") {
    swAvailable.value = true;
    mediaState.value = {
      done: data.done || 0,
      total: data.total || 0,
      loading: !data.finished,
      finished: Boolean(data.finished),
    };
    if (data.finished) showToast("全书配图已离线缓存完毕");
  }
}

function cacheAllMedia() {
  if (mediaState.value.loading || mediaState.value.finished) return;
  mediaState.value.loading = true;
  postSwMessage({ type: "CACHE_ALL_MEDIA" });
}

async function preparePage() {
  cancelRestore();
  await nextTick();
  document.querySelectorAll(".vp-doc img").forEach((img) => {
    if (!img.closest("a, .mermaid-diagram")) {
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.setAttribute("aria-label", `放大：${img.alt || "正文插图"}`);
    }
  });

  let pendingRestore = false;
  try {
    pendingRestore =
      sessionStorage.getItem("handbook:pending_restore") === "1";
    if (pendingRestore) sessionStorage.removeItem("handbook:pending_restore");
  } catch {}

  const saved = readLast();
  const isFreshPageLoad = !window.__handbookDidSpaNav;

  const shouldRestore = Boolean(
    frontmatter.value.bookPart &&
      saved &&
      saved.pathname === location.pathname &&
      typeof saved.scrollRatio === "number" &&
      saved.scrollRatio > 0.01 &&
      (pendingRestore || (isFreshPageLoad && !location.hash)),
  );

  if (shouldRestore) {
    restoring = true;
    progress.value = Math.round(saved.scrollRatio * 100);
    bindInterruptListeners();
    scrollToRatio(saved.scrollRatio);
    restoreTimers.push(
      setTimeout(() => scrollToRatio(saved.scrollRatio), 120),
      setTimeout(() => {
        scrollToRatio(saved.scrollRatio);
        restoring = false;
        restoreTimers = [];
        removeInterruptListeners();
        saveProgress();
        showToast(
          `已回到上次阅读位置（${Math.round(saved.scrollRatio * 100)}%）`,
        );
      }, 350),
    );
    return;
  }

  saveProgress();
}

async function printPage() {
  printing.value = true;
  try {
    const pending = [];
    window.dispatchEvent(
      new CustomEvent("book:prepare-print", { detail: pending }),
    );
    document.querySelectorAll(".vp-doc img").forEach((img) => {
      img.loading = "eager";
      pending.push(img.decode().catch(() => {}));
    });
    await Promise.all(pending);
    await nextTick();
    window.print();
  } finally {
    printing.value = false;
  }
}

onMounted(() => {
  try {
    const value = localStorage.getItem("handbook:size");
    if (["small", "normal", "large"].includes(value)) setSize(value);
  } catch {}
  preparePage();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pagehide", saveProgress);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("book:diagram", diagramOpen);
  document.addEventListener("click", imageClick);
  document.addEventListener("keydown", imageKey);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", onSwMessage);
    if (navigator.serviceWorker.controller) {
      swAvailable.value = true;
      postSwMessage({ type: "GET_OFFLINE_STATUS" });
    } else {
      navigator.serviceWorker.ready
        ?.then(() => {
          swAvailable.value = true;
          postSwMessage({ type: "GET_OFFLINE_STATUS" });
        })
        .catch(() => {});
    }
  }
});

watch(() => route.path, preparePage, { flush: "post" });

onBeforeUnmount(() => {
  clearTimeout(timer);
  clearTimeout(toastTimer);
  cancelRestore();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("pagehide", saveProgress);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("book:diagram", diagramOpen);
  document.removeEventListener("click", imageClick);
  document.removeEventListener("keydown", imageKey);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.removeEventListener("message", onSwMessage);
  }
});
</script>
<template>
  <div
    class="reading-progress"
    :style="{ width: progress + '%' }"
    aria-hidden="true"
  />
  <div class="reader-tools" aria-label="阅读设置">
    <div class="reading-meta">
      <span v-if="frontmatter.bookPart">{{ frontmatter.bookPart }}</span
      ><span>约 {{ frontmatter.readingMinutes }} 分钟</span>
    </div>
    <div class="reader-actions">
      <button
        v-if="swAvailable"
        class="offline-button"
        :class="{ ready: mediaState.finished }"
        :disabled="mediaState.loading || mediaState.finished"
        :title="offlineTitle"
        @click="cacheAllMedia"
      >
        {{ offlineLabel }}
      </button>
      <div class="font-controls" role="group" aria-label="正文字号">
        <button
          v-for="(label, value) in { small: '小', normal: '中', large: '大' }"
          :key="value"
          :aria-label="`${label}号字`"
          :aria-pressed="size === value"
          @click="setSize(value)"
        >
          {{ label }}
        </button>
      </div>
      <button
        class="print-button"
        :disabled="printing"
        @click="printPage"
        aria-label="打印本页"
      >
        {{ printing ? "准备中…" : "打印" }}
      </button>
    </div>
  </div>
  <div v-if="resumeToast" class="resume-toast" role="status" aria-live="polite">
    {{ resumeToast }}
  </div>
  <dialog
    ref="viewer"
    class="image-viewer"
    aria-label="图片预览"
    @click="
      (event) => {
        if (event.target === viewer) viewer.close();
      }
    "
  >
    <div class="viewer-actions">
      <a :href="media.src" target="_blank" rel="noopener noreferrer"
        >打开原图 ↗</a
      ><button autofocus @click="viewer.close()" aria-label="关闭图片预览">
        关闭 ×
      </button>
    </div>
    <img :src="media.src || undefined" :alt="media.alt" />
    <p>{{ media.alt }}</p>
  </dialog>
</template>
