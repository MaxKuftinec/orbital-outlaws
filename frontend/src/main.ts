import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import 'vuetify/styles'
import './cockpit.css'
import App from './App.vue'

const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'orbital',
    themes: {
      orbital: { dark: true, colors: {
        background: '#060d17', surface: '#0b1725', primary: '#62d9f6',
        secondary: '#2dbac9', success: '#67e0aa', error: '#ff7184', warning: '#edbe6b'
      } },
    },
  },
})
createApp(App).use(vuetify).mount('#app')
