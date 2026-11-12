<script lang="ts">
  import type { CalmLensProvidedOptions, UploaderProps } from "../src/svelte/index.js";
  // A Svelte uploader beneath a component that calls setCalmLensContext, for uploader.test.ts.
  import { CalmLensUploader, setCalmLensContext } from "../src/svelte/index.js";

  let { provided, ...props }: UploaderProps<File> & { provided: CalmLensProvidedOptions<File> } = $props();
  setCalmLensContext(provided);
</script>

<CalmLensUploader {...props} />
