<script lang="ts">
  import AssetViewer from "./AssetViewer.svelte";

  let props = $props();
</script>

<AssetViewer kind="spreadsheet" {...props} />
