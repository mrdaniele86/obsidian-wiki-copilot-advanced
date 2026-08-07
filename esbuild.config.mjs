import esbuild from "esbuild";
import path from "node:path";

const production = process.argv[2] === "production";

const inlineSourceCatalogWorkerPlugin = {
  name: "inline-source-catalog-worker",
  setup(build) {
    build.onResolve({ filter: /^virtual:source-catalog-worker$/ }, (args) => ({
      path: args.path,
      namespace: "source-catalog-worker"
    }));
    build.onLoad({ filter: /.*/, namespace: "source-catalog-worker" }, async () => {
      const result = await esbuild.build({
        entryPoints: ["src/workers/source-catalog-worker.ts"],
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        target: "es2020",
        minify: production,
        metafile: true,
        logLevel: "silent"
      });
      return {
        contents: `export default ${JSON.stringify(result.outputFiles[0].text)}`,
        loader: "js",
        watchFiles: Object.keys(result.metafile.inputs).map((file) => path.resolve(file))
      };
    });
  }
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  plugins: [inlineSourceCatalogWorkerPlugin]
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
