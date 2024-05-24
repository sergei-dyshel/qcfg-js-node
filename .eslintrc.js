/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ["@sergei-dyshel"],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ["./tsconfig.json"],
  },
};
