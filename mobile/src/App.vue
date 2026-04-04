<script setup lang="ts">
import { ref } from 'vue'
import type { SessionUser } from './api'
import LoginView from './views/LoginView.vue'
import MainView from './views/MainView.vue'

const session = ref<SessionUser | null>(
  JSON.parse(localStorage.getItem('mb_session') ?? 'null')
)

function onLogin(user: SessionUser) {
  session.value = user
  localStorage.setItem('mb_session', JSON.stringify(user))
}

function onLogout() {
  session.value = null
  localStorage.removeItem('mb_session')
  localStorage.removeItem('mb_draft')
}
</script>

<template>
  <LoginView v-if="!session" @login="onLogin" />
  <MainView  v-else :session="session" @logout="onLogout" />
</template>
