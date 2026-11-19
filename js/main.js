import { getConfig } from "./runtime/config.js";
import { initTheme } from "./runtime/theme.js";
import { OrderStore, mountOrderUI } from "./runtime/order.js";
import { initCatalogPage } from "./runtime/catalog.js";

const config = getConfig();
const orderStore = new OrderStore();

initTheme(config.ui?.defaultTheme || "system");
mountOrderUI(orderStore);
initCatalogPage(orderStore);
