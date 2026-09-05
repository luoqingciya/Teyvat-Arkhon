/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

import type { ArkhonAPI } from '@teyvat-arkhon/shared'

declare global {
  interface Window {
    arkhon: ArkhonAPI
  }
}

export {}