import { ALL_PUSH_KINDS, setupPush } from "./push";
import { installShell } from "./register";

await installShell().then((registration) => setupPush(registration, ALL_PUSH_KINDS));
