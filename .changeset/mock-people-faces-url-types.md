---
"@calmlens/sdk": patch
"@calmlens/sdk-python": patch
"@calmlens/sdk-go": patch
"@calmlens/sdk-rust": patch
"@calmlens/sdk-ruby": patch
"@calmlens/sdk-java": patch
"@calmlens/sdk-php": patch
---

Mock decisions can supply the people and faces person and face detection find in an image: the mock reports them when the upload turns those features on, with each face's age range only when the upload also asks for age estimation, and still finds none without them. A mock URL upload now takes its asset type from the file extension of the URL's path, such as `image` for `.jpg` and `multimedia-document` for `.pdf`, and is a `website` for any other extension or none. A failure queued for `text.classify` or `assets.classify` fails only that operation's request, and in PHP the `moderate` callable's `MockModerationInput->asset` is an `Asset` object, read as properties or array keys.
