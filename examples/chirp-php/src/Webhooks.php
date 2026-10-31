<?php

declare(strict_types=1);

namespace Chirp;

use CalmLens\CalmLensException;
use CalmLens\Webhooks as CalmLensWebhooks;

/**
 * Applies verified CalmLens webhook deliveries. A delivery's body is the event itself:
 * `{id, projectId, type, assetId, asset, facts, createdAt, ...}`.
 */
final class Webhooks
{
    /**
     * Events that can change an image's moderation status: classification finishing, one event
     * per status (sent for automated and reviewer decisions alike) and failed processing.
     */
    public const SYNC_EVENTS = ['asset.classified', 'asset.allowed', 'asset.limited', 'asset.age-restricted', 'asset.blocked', 'asset.purged', 'asset.failed'];
    private const REMEMBERED_DELIVERIES = 500;

    public function __construct(private Store $store, private Content $content, private string $projectId, private string $secret) {}

    /** @return int the HTTP status to answer with */
    public function handle(string $rawBody, ?string $signature, ?string $timestamp): int
    {
        if ($this->secret === '') {
            return 404;
        }
        try {
            // The exact raw bytes: never a re-encoded copy of the parsed JSON.
            $event = CalmLensWebhooks::parseEvent($rawBody, $signature, $timestamp, $this->secret);
        } catch (CalmLensException $error) {
            return 401;
        }
        if ($event['projectId'] !== $this->projectId) {
            return 403;
        }
        // Test sends from the portal carry the registered `test` fact and change nothing.
        if (CalmLensWebhooks::isTest($event) || in_array($event['id'], $this->store->read()['deliveries'], true)) {
            return 204;
        }
        $assetId = $event['assetId'] ?? null;
        if (in_array($event['type'], self::SYNC_EVENTS, true) && is_string($assetId) && $assetId !== '') {
            try {
                // The event's snapshot may be stale by the time it arrives: fetch the asset's current state.
                $this->content->syncAsset($assetId);
            } catch (CalmLensException $error) {
                error_log('[chirp] webhook sync failed: ' . $error->errorCode);
                // Not recorded as applied, so CalmLens's retry applies it.
                return 503;
            }
        }
        $this->store->update(function (array &$data) use ($event) {
            $data['deliveries'] = array_slice([...$data['deliveries'], $event['id']], -self::REMEMBERED_DELIVERIES);
        });
        return 204;
    }
}
