<script setup lang="ts">
/** 從左側滑出的抽屜（篩選用，☰ 開啟） */
const open = defineModel<boolean>({ default: false })
defineProps<{ title: string }>()
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" data-no-pull class="fixed inset-0 z-50 flex">
        <div class="drawer-panel w-[85%] max-w-sm h-full bg-surface border-r border-hairline flex flex-col safe-top">
          <div class="flex items-center justify-between px-4 py-3 border-b border-hairline shrink-0">
            <span class="font-bold text-fg">{{ title }}</span>
            <slot name="actions" />
            <button @click="open = false" class="w-9 h-9 text-xl text-muted" aria-label="關閉">×</button>
          </div>
          <div class="flex-1 overflow-y-auto" :style="{ paddingBottom: 'calc(var(--safe-b) + 1rem)' }">
            <slot />
          </div>
        </div>
        <div class="flex-1 bg-black/40" @click="open = false" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-enter-active, .drawer-leave-active { transition: opacity .2s; }
.drawer-enter-active .drawer-panel, .drawer-leave-active .drawer-panel { transition: transform .22s ease; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .drawer-panel, .drawer-leave-to .drawer-panel { transform: translateX(-100%); }
</style>
