import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const patchSourcePlugin = () => ({
  postcssPlugin: "postcss-patch-source",
  Once(root) {
    const rootInput = root.source?.input;
    if (!rootInput?.file) return;
    root.walk((node) => {
      if (!node.source?.input?.file) {
        node.source = { ...node.source, input: rootInput };
      }
    });
  },
});
patchSourcePlugin.postcss = true;

export default {
  plugins: [tailwindcss(), patchSourcePlugin(), autoprefixer()],
};
