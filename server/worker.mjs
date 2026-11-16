import { handleBridge } from "./bridge.mjs";
export default { fetch(request, env) { return handleBridge(request, env); } };
