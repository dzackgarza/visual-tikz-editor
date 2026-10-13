import { createApp } from "vue";
import PrimeVue from "primevue/config";
import { definePreset } from "@primeuix/themes";
import Aura from "@primeuix/themes/aura";
import StandaloneApp from "./StandaloneApp.vue";

const MathNotes = definePreset(Aura, {
  semantic: {
    primary: {
      50: "#fbf1f0",
      100: "#f3dedd",
      200: "#e7bdbb",
      300: "#d89491",
      400: "#c16564",
      500: "#9e2a2b",
      600: "#842425",
      700: "#6b2021",
      800: "#541c1d",
      900: "#3e1919",
      950: "#281212",
    },
  },
});

createApp(StandaloneApp)
  .use(PrimeVue, { theme: { preset: MathNotes, options: { darkModeSelector: ".dark" } } })
  .mount("#app");
