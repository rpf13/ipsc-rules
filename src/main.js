import { createApp } from 'vue'
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'
import App from './App.vue'

const vuetify = createVuetify({
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  theme: {
    defaultTheme: 'system',
    themes: {
      // Black & gold, matching the banner. Light mode uses a darker gold so text stays readable on white.
      light: {
        colors: {
          primary: '#9a6700', secondary: '#1a1a1a', appbar: '#111111', 'on-appbar': '#ffffff', gold: '#f2b01e',
          surface: '#ffffff', background: '#f6f4ef',
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: '#f2b01e', 'on-primary': '#111111', secondary: '#bdbdbd', appbar: '#0b0b0b', 'on-appbar': '#ffffff',
          gold: '#f2b01e', surface: '#1c1b19', background: '#111111',
        },
      },
    },
  },
})

createApp(App).use(vuetify).mount('#app')
