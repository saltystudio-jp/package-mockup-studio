import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run build:standalone` → standalone/package-mockup-studio.html: the whole app in
// ONE html file that Chrome can open straight from disk (double-click, drag in, or a
// bookmark to file:///…). A normal build can't: it loads its JS as a separate
// <script type="module" src>, and Chrome refuses module scripts from file:// URLs. So
// here every script and stylesheet is inlined into the page.
function inlineIntoHtml() {
  return {
    name: "inline-into-html",
    enforce: "post",
    generateBundle(_, bundle) {
      const htmlName = Object.keys(bundle).find((n) => n.endsWith(".html"));
      if (!htmlName) return;
      const html = bundle[htmlName];
      let source = String(html.source);
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type === "chunk" && chunk.isEntry) {
          // "</script" inside the code would end the inline <script> early
          const code = chunk.code.replace(/<\/script/gi, "<\\/script");
          const tag = new RegExp(`<script[^>]*src="[^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*></script>`);
          source = source.replace(tag, () => `<script type="module">\n${code}\n</script>`);
          delete bundle[name];
        } else if (chunk.type === "asset" && name.endsWith(".css")) {
          const tag = new RegExp(`<link[^>]*href="[^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`);
          source = source.replace(tag, () => `<style>\n${chunk.source}\n</style>`);
          delete bundle[name];
        }
      }
      html.source = source;
      html.fileName = "package-mockup-studio.html";
    },
  };
}

export default defineConfig(({ mode }) => {
  const standalone = mode === "standalone";
  return {
    plugins: [react(), ...(standalone ? [inlineIntoHtml()] : [])],
    server: {
      port: 5173,
      open: true,
    },
    ...(standalone && {
      base: "./",
      build: {
        outDir: "standalone",
        emptyOutDir: true,
        assetsInlineLimit: 100_000_000, // any imported image/font becomes a data: URL
        cssCodeSplit: false,
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    }),
  };
});
