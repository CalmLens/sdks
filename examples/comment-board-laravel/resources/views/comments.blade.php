<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CalmLens comments</title></head>
<body>
<main>
    <h1>Comment board</h1>
    <p>Comments appear after CalmLens approves them. This example keeps your board in your session.</p>
    <form method="post" action="/comments">
        @csrf
        <label for="comment">Your comment</label>
        <textarea id="comment" name="comment" maxlength="5000" required>{{ old('comment') }}</textarea>
        @error('comment')<p role="alert">{{ $message }}</p>@enderror
        <button type="submit">Post comment</button>
    </form>
    <ul>@foreach ($comments as $comment)<li>{{ $comment['text'] }}</li>@endforeach</ul>
</main>
</body>
</html>
