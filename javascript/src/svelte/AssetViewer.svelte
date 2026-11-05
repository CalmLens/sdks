<script lang="ts">
  // Mounts one of the shared asset viewers (preview) into its element; the named viewer
  // components wrap it.
  import { onMount } from "svelte";
  import { ASSET_VIEWERS, type AssetViewer, type AssetViewerName } from "../ui.js";

  let { kind, ...options }: { kind: AssetViewerName } & Record<string, unknown> = $props();
  let root: HTMLElement | undefined = $state();
  let viewer: AssetViewer<never> | undefined;

  // Every change of props: the viewer loads again only when what it shows changed.
  $effect(() => {
    const next = { ...options } as never;
    if (!root) return;
    if (viewer) viewer.update(next);
    else viewer = ASSET_VIEWERS[kind](root, next) as AssetViewer<never>;
  });
  onMount(() => () => {
    viewer?.destroy();
    viewer = undefined;
  });
</script>

<!-- The viewer owns the element's children; Svelte renders none. -->
<div bind:this={root} class="calmlens-viewer" data-kind={kind}></div>
