<script lang="ts">
  import { ICON_ATTRIBUTES, ICONS, type IconName } from "../ui.js";

  let { name }: { name: IconName } = $props();
</script>

<svg {...ICON_ATTRIBUTES}><path d={ICONS[name]} /></svg>
