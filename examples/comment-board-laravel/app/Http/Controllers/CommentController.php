<?php

namespace App\Http\Controllers;

use CalmLens\CalmLensException;
use CalmLens\ServerClient;
use Illuminate\Http\Request;

final class CommentController
{
    public function store(Request $request, ServerClient $client)
    {
        $input = $request->validate(['comment' => ['required', 'string', 'max:5000']]);
        try {
            $asset = $client->text->classify(['text' => $input['comment']]);
        } catch (CalmLensException $error) {
            // Never display an unmoderated comment when the API is unavailable.
            return back()->withInput()->withErrors(['comment' => 'Moderation is unavailable. Please try again.']);
        }
        // Allowed and limited comments publish (limited is only marked so an app can reduce its reach);
        // pending, age-restricted, blocked, purged and unknown statuses do not.
        if (!in_array($asset['classification']['moderation']['status'] ?? null, ['allowed', 'limited'], true)) {
            return back()->withInput()->withErrors(['comment' => 'This comment cannot be published yet.']);
        }
        // Session storage keeps this demo database-free and private to the visitor.
        $comments = $request->session()->get('comments', []);
        $comments[] = ['text' => $input['comment'], 'assetId' => $asset['id']];
        $request->session()->put('comments', array_slice($comments, -50));
        return redirect('/');
    }
}
