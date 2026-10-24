/** Print whether the keeper env is configured. Never prints secret values. */
import { describeEnv } from "../src/env.js";

for (const line of describeEnv()) console.log(line);
