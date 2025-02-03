import { userConfig } from "../lib/config";

// argv[1] is script path itself
void userConfig.writeJsonSchema(process.argv[2]);
