import { getConfig } from "./runtime/config.js";
import { initGlobalSearch } from "./runtime/global-search.js";
import { initTheme } from "./runtime/theme.js";
import { OrderStore, mountOrderUI } from "./runtime/order.js";

const config = getConfig();
const orderStore = new OrderStore();

initTheme(config.ui?.defaultTheme || "system");
mountOrderUI(orderStore);
initGlobalSearch();
