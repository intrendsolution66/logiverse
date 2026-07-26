// src/i18n/index.ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    lng: localStorage.getItem("lv-lang") ?? "en",   // ← 明确设置初始语言
    fallbackLng: "en",
    supportedLngs: ["en", "zh"],
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "lv-lang",
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },                   // ← 关闭 Suspense，防止未初始化时报错
  });

export default i18n;