<?php

namespace App\Http\Controllers;

use CalmLens\CalmLensException;
use CalmLens\SdkErrorCodes;
use CalmLens\Webhooks;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

final class WebhookController
{
    public function __invoke(Request $request)
    {
        try {
            $event = Webhooks::parseEvent(
                $request->getContent(),
                $request->header(Webhooks::SIGNATURE_HEADER),
                $request->header(Webhooks::TIMESTAMP_HEADER),
                (string) config('calmlens.webhook_secret'),
            );
        } catch (CalmLensException $error) {
            // A forged or stale delivery is 401; a verified body that is not an event is 400.
            $status = $error->errorCode === SdkErrorCodes::INVALID_WEBHOOK_SIGNATURE ? 401 : 400;
            return response()->json(['code' => $error->errorCode], $status);
        }
        if ($event->projectId !== config('calmlens.project_id')) {
            return response()->json(['code' => 'example/project-mismatch'], 403);
        }
        if (Webhooks::isTest($event)) {
            return response()->noContent();
        }
        if (!Cache::add('calmlens-event:' . $event->id, true, now()->addDay())) {
            return response()->noContent();
        }
        // Demonstrate verified delivery without publishing or altering the visitor's comments.
        Cache::put('calmlens-last-event', [
            'id' => $event->id, 'type' => $event->type, 'facts' => $event->toArray()['facts'] ?? [],
        ], now()->addDay());
        return response()->noContent();
    }
}
