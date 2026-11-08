---
"@calmlens/sdk-java": minor
---

Uploads no longer put asset fields in the URL. Text is sent as a JSON body, and files and first multipart parts as a `multipart/form-data` upload form: the name, description, metadata, tags, author, conversation context, external IDs, folder, upload preset and processing options go in its `options` part and the bytes in its `file` part, so none of them appear in proxy, CDN or server logs. The query string holds only `wait`, `contentType`, sizes and part numbers. The offline mock reads uploads the same way and refuses asset fields in a query string with `upload/options-in-query`, as the API does.
