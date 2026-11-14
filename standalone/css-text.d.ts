/**
 * A CSS file that a module imports `with { type: "text" }` is the file's text: the attribute
 * overrides Bun's loader for the extension (https://bun.com/docs/bundler/loaders#text).
 */
declare module "*.css" {
  const text: string;
  export default text;
}
