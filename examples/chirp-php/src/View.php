<?php

declare(strict_types=1);

namespace Chirp;

/** Server-rendered HTML. Every dynamic value goes through h(). */
final class View
{
    private const NOTICES = [
        'pending' => 'CalmLens is checking your image. Only you can see this until it’s allowed.',
        'error' => 'We couldn’t check your image, so only you can see this. Delete it and try again.',
    ];

    public function __construct(private Content $content, private bool $demo) {}

    private static function h(?string $value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    public function message(string $message): string
    {
        return $this->layout('Chirp', null, '<p role="alert">' . self::h($message) . '</p><p><a href="/">Back to Chirp</a></p>');
    }

    public function home(array $data, ?array $viewer, string $csrf, ?Refused $error, array $input): string
    {
        $posts = array_filter($data['posts'], fn ($post) => $post['parentId'] === null && Content::isVisibleTo($post, $viewer));
        $body = $viewer === null ? $this->signIn($csrf) : $this->compose($csrf, null, $error, $input);
        $body .= '<h2>Home</h2>' . $this->feed($data, $posts, $viewer, $csrf, 'Nothing here yet. Write the first chirp.');
        return $this->layout('Chirp', $viewer, $body, $csrf, $this->hasPending($posts, $viewer));
    }

    public function thread(array $data, array $post, ?array $viewer, string $csrf, ?Refused $error, array $input): string
    {
        $replies = array_filter($data['posts'], fn ($reply) => $reply['parentId'] === $post['id'] && Content::isVisibleTo($reply, $viewer));
        $body = $this->post($data, $post, $viewer, $csrf);
        if ($viewer !== null && Content::isPublished($post)) {
            $body .= $this->compose($csrf, $post['id'], $error, $input);
        }
        $body .= '<h2>Replies</h2>' . $this->feed($data, $replies, $viewer, $csrf, 'No replies yet.', newestFirst: false);
        return $this->layout('Chirp', $viewer, $body, $csrf, $this->hasPending([$post, ...$replies], $viewer));
    }

    public function profile(array $data, array $user, ?array $viewer, string $csrf, ?Refused $error, array $input): string
    {
        $own = $user['username'] === ($viewer['username'] ?? null);
        $posts = array_filter($data['posts'], fn ($post) => $post['author'] === $user['username'] && $post['parentId'] === null && Content::isVisibleTo($post, $viewer));
        $body = '<section class="profile"><h2>@' . self::h($user['username']) . '</h2>'
            . ($user['bio'] !== '' ? '<p class="bio">' . self::h($user['bio']) . '</p>' : '');
        if ($own) {
            $body .= '<form method="post" action="/profile/bio" class="card">' . $this->csrf($csrf)
                . '<label for="bio">Bio</label><textarea id="bio" name="bio" maxlength="' . Content::MAX_BIO . '" rows="2">'
                . self::h($input['bio'] ?? $user['bio']) . '</textarea>' . $this->alert($error)
                . '<button type="submit">Save bio</button></form>';
            $body .= $user['showSensitiveMedia']
                ? '<form method="post" action="/profile/sensitive" class="card" id="sensitive">' . $this->csrf($csrf)
                    . '<p>Sensitive media is shown to you without a warning.</p><input type="hidden" name="show" value="0">'
                    . '<button type="submit">Hide sensitive media</button></form>'
                : '<form method="post" action="/profile/sensitive" class="card" id="sensitive">' . $this->csrf($csrf)
                    . '<input type="hidden" name="show" value="1"><p>Images CalmLens age-restricts are blurred behind a warning.</p>'
                    . '<label class="check"><input type="checkbox" name="confirmAdult" value="1" required> I am 18 or older</label>'
                    . '<button type="submit">Show sensitive media</button></form>';
        }
        $body .= '</section><h2>Posts</h2>' . $this->feed($data, $posts, $viewer, $csrf, 'No posts yet.');
        return $this->layout('@' . $user['username'] . ' on Chirp', $viewer, $body, $csrf, $this->hasPending($posts, $viewer));
    }

    private function feed(array $data, array $posts, ?array $viewer, string $csrf, string $empty, bool $newestFirst = true): string
    {
        usort($posts, fn ($a, $b) => $newestFirst ? $b['createdAt'] <=> $a['createdAt'] : $a['createdAt'] <=> $b['createdAt']);
        if ($posts === []) {
            return '<p class="empty">' . self::h($empty) . '</p>';
        }
        return '<ol class="feed">' . implode('', array_map(fn ($post) => '<li>' . $this->post($data, $post, $viewer, $csrf) . '</li>', array_slice($posts, 0, 100))) . '</ol>';
    }

    private function post(array $data, array $post, ?array $viewer, string $csrf): string
    {
        $status = $post['image']['status'] ?? 'text';
        $html = '<article class="post" data-post-id="' . self::h($post['id']) . '" data-status="' . self::h($status) . '">'
            . '<header><a class="author" href="/u/' . self::h($post['author']) . '">@' . self::h($post['author']) . '</a> · '
            . '<a href="/post/' . self::h($post['id']) . '"><time datetime="' . gmdate('c', intdiv($post['createdAt'], 1000)) . '">'
            . gmdate('M j, H:i', intdiv($post['createdAt'], 1000)) . '</time></a></header>';
        if ($post['text'] !== '') {
            $html .= '<p class="text">' . nl2br(self::h($post['text'])) . '</p>';
        }
        $html .= $this->media($post, $viewer);
        if (!Content::isPublished($post)) {
            $html .= $this->authorNotice($post);
        }
        $replies = count(array_filter($data['posts'], fn ($reply) => $reply['parentId'] === $post['id'] && Content::isPublished($reply)));
        $html .= '<footer>';
        if ($post['parentId'] === null) {
            $html .= '<a href="/post/' . self::h($post['id']) . '">' . $replies . ($replies === 1 ? ' reply' : ' replies') . '</a>';
        }
        if ($post['author'] === ($viewer['username'] ?? null)) {
            $html .= '<form method="post" action="/posts/' . self::h($post['id']) . '/delete">' . $this->csrf($csrf) . '<button type="submit" class="link">Delete</button></form>';
        }
        return $html . '</footer></article>';
    }

    private function media(array $post, ?array $viewer): string
    {
        if ($post['image'] === null) {
            return '';
        }
        $media = $this->content->mediaFor($post, $viewer);
        if ($media['url'] !== null) {
            return '<img class="media" src="' . self::h($media['url']) . '" alt="Image posted by @' . self::h($post['author']) . '" loading="lazy">';
        }
        if ($media['placeholderUrl'] !== null) {
            $action = $viewer === null ? 'Sign in and turn on “Show sensitive media” in your profile to see it.'
                : '<a href="/u/' . self::h($viewer['username']) . '#sensitive">Show sensitive media</a> to see it.';
            return '<figure class="sensitive"><img src="' . self::h($media['placeholderUrl']) . '" alt="">'
                . '<figcaption><strong>Sensitive content</strong> This image may not be suitable for everyone. ' . $action . '</figcaption></figure>';
        }
        return '';
    }

    /** Shown only to the author, since nobody else sees a post that isn't published. */
    private function authorNotice(array $post): string
    {
        $status = $post['image']['status'];
        $message = self::NOTICES[$status] ?? 'Removed: your image may contain '
            . Labels::describe(Moderation::flaggedCategories($post['image']['findings'])) . '. Only you can see this.';
        return '<p class="notice" role="status" data-categories="' . self::h(implode(' ', Moderation::flaggedCategories($post['image']['findings']))) . '">'
            . self::h($message) . '</p>';
    }

    private function compose(string $csrf, ?string $parentId, ?Refused $error, array $input): string
    {
        $label = $parentId === null ? 'What’s happening?' : 'Reply';
        $html = '<form method="post" action="/posts" enctype="multipart/form-data" class="card compose">' . $this->csrf($csrf)
            . ($parentId === null ? '' : '<input type="hidden" name="parentId" value="' . self::h($parentId) . '">')
            . '<label for="text">' . $label . '</label><textarea id="text" name="text" maxlength="' . Content::MAX_POST . '" rows="3">'
            . self::h($input['text'] ?? '') . '</textarea>' . $this->alert($error)
            . '<div class="row"><label class="file">Image <input type="file" name="image" accept="' . implode(',', Content::IMAGE_TYPES) . '"></label>';
        if ($this->demo) {
            $html .= '<label class="file">Demo image outcome <select name="demoOutcome">';
            foreach (Demo::IMAGE_OUTCOMES as $outcome) {
                $html .= '<option value="' . $outcome . '">' . $outcome . '</option>';
            }
            $html .= '</select></label>';
        }
        return $html . '<button type="submit">' . ($parentId === null ? 'Chirp' : 'Reply') . '</button></div></form>';
    }

    private function signIn(string $csrf): string
    {
        return '<form method="post" action="/signin" class="card">' . $this->csrf($csrf)
            . '<label for="username">Pick a username to post</label><div class="row"><input id="username" name="username" required pattern="[a-z0-9_]{3,20}" autocomplete="username">'
            . '<button type="submit">Sign in</button></div><p class="hint">Local example: no password. Anyone on this machine can use any name.</p></form>';
    }

    private function alert(?Refused $error): string
    {
        return $error === null ? '' : '<p role="alert" data-categories="' . self::h(implode(' ', $error->categories)) . '">' . self::h($error->getMessage()) . '</p>';
    }

    private function csrf(string $csrf): string
    {
        return '<input type="hidden" name="csrf" value="' . self::h($csrf) . '">';
    }

    private function hasPending(array $posts, ?array $viewer): bool
    {
        foreach ($posts as $post) {
            if (($post['image']['status'] ?? null) === 'pending' && $post['author'] === ($viewer['username'] ?? null)) {
                return true;
            }
        }
        return false;
    }

    private function layout(string $title, ?array $viewer, string $body, string $csrf = '', bool $refresh = false): string
    {
        $nav = $viewer === null ? '' : '<a href="/u/' . self::h($viewer['username']) . '">@' . self::h($viewer['username']) . '</a>'
            . '<form method="post" action="/signout">' . $this->csrf($csrf) . '<button type="submit" class="link">Sign out</button></form>';
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            // While the viewer's own image is being checked, reload so its decision shows up.
            . ($refresh ? '<meta http-equiv="refresh" content="3">' : '')
            . '<title>' . self::h($title) . '</title><link rel="stylesheet" href="/style.css"></head><body>'
            . '<header class="top"><a class="brand" href="/">Chirp</a><span class="mode">' . ($this->demo ? 'Demo' : 'Live') . '</span><nav>' . $nav . '</nav></header>'
            . '<main>' . $body . '</main></body></html>';
    }
}
