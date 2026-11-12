---
"@calmlens/sdk-php": minor
---

Results are now objects. Every method returns a model from `CalmLens\Model`, such as `Asset`,
`Folder`, `Lens`, `Policy` or `Event`, instead of an associative array. Read a field as a property
(`$asset->classification->moderation->status`) or as an array key, iterate over its fields, or
turn it back into arrays with `toArray()`; `json_encode` writes it as the API sent it. Fields
this version doesn't know yet are kept. Objects are read-only: change a resource through its
service. Each model documents every field and its type, null included, for PHPStan and IDEs.

Enumerated values are class constants on the model, such as `Moderation::STATUS_BLOCKED`,
`Asset::TYPE_IMAGE` and `Event::TYPE_ASSET_ALLOWED`; moderation categories and policy qualifiers
are on `Model\Category` and `Model\Qualifier`.

Lists return a `Collection` page: iterate it for its `items`, or call `autoPagingIterator()` to
yield every item across pages. `events->list` returns an `EventCollection` and `folders->list` a
`FolderCollection`, with their extra fields.

Request options, such as `idempotencyKey`, `timeout` and `maxRetries`, are now each method's
second argument, apart from its params: `$client->assets->create([...], ['idempotencyKey' => $key])`.
Webhooks::parseEvent returns an `Event`, and the `Webhooks` helpers take an `Event` or an array.
