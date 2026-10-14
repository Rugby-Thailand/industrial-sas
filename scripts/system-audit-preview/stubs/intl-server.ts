import { createTranslator } from "next-intl";
import { messagesFor } from "@/i18n/messages";
const locale =
  new URLSearchParams(location.search).get("locale") === "th" ? "th" : "en";
export const getLocale = async () => locale;
export const getTranslations = async (namespace: "Access") =>
  createTranslator({ locale, messages: messagesFor(locale), namespace });
