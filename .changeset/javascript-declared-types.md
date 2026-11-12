---
"@calmlens/sdk": minor
---

Match the JavaScript types to what the API sends and accepts. `Asset.visibility` is always
present and never `null`. `assets.listChildren` requires its options, which hold the asset ID.
Upload options accept `null` for `authorId` and `context`, as the API does. Member event facts
list the `reviewer` role.
