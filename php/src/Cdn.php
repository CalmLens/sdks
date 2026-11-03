<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Transforms;
use CalmLens\Internal\Values;
use Psr\Http\Message\ResponseInterface;

final class Cdn extends Resource
{
    protected const OPERATIONS = 'cdn';

    /**
     * Builds a CDN URL for an asset's content, without a request.
     *
     * `viewerClaims` takes `region` and `ageConfirmed`. `ageConfirmed` is your platform's
     * confirmation that the viewer passed its age check: your platform confirms the viewer's age,
     * and CalmLens does not verify this claim. Anyone requesting a public asset's URL can set it, so
     * it doesn't restrict access; to control who loads an age-restricted asset, make it private and
     * include the claim in a signed URL, whose signature covers it.
     *
     * @param array<string, mixed> $options assetIdentifier, resource, lens, transform and viewerClaims
     */
    public function getAssetUrl(array $options): string
    {
        Values::knownOptions($options, 'cdn.getAssetUrl');
        $resource = $options['resource'] ?? 'rendered';
        if (!in_array($resource, ['original', 'rendered', 'placeholder'], true)) {
            Values::invalid('Resource must be original, rendered or placeholder');
        }
        // Only the rendered resource takes a lens or transform.
        $transformed = isset($options['lens']) || isset($options['transform']);
        if ($resource === 'original' && $transformed) {
            Values::invalid('Lenses and transforms apply only to the rendered resource');
        }
        // A placeholder is a small blurred PNG, public for every asset whatever its visibility or moderation.
        if ($resource === 'placeholder' && $transformed) {
            Values::invalid('A placeholder takes no lens or transform');
        }
        $url = $this->session->cdnBaseUrl . '/assets/' . Values::segment($this->session->projectId)
            . '/' . Values::segment($options['assetIdentifier'] ?? null) . '/' . $resource;
        // One path segment: the lens, then options that replace the lens's same-named options.
        $selector = [];
        if (isset($options['lens'])) {
            $selector[] = '@' . Values::segment($options['lens']);
        }
        if (isset($options['transform']) && $options['transform'] !== '') {
            $selector[] = Transforms::path($options['transform']);
        }
        if ($selector !== []) {
            $url .= '/' . implode(',', $selector);
        }
        // Opts a public age-restricted asset in to its public URL; only for viewers your app has
        // already decided may see age-restricted content. Without it, use a signed URL or the API key.
        $query = isset($options['viewerClaims'])
            ? ['viewerClaims' => json_encode(self::orderedClaims($options['viewerClaims']), JSON_THROW_ON_ERROR)]
            : [];
        return $query ? $url . '?' . http_build_query($query) : $url;
    }

    /** Returns a PSR-7 response with a streaming body; HTTP errors are returned, not thrown. */
    public function serve(array $options): ResponseInterface
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $init = $api['init'] ?? [];
        if (!is_array($init) || !is_array($init['headers'] ?? [])) {
            Values::invalid('init and headers must be arrays');
        }
        $method = strtoupper($init['method'] ?? 'GET');
        if (!in_array($method, ['GET', 'HEAD'], true)) {
            Values::invalid('CDN method must be GET or HEAD');
        }
        unset($api['init']);
        return $this->session->cdn($method, $this->getAssetUrl($api), $init['headers'] ?? [], $request);
    }

    /** Viewer claims in the order the other SDKs send them, so equal claims build equal CDN URLs. */
    private static function orderedClaims(mixed $claims): mixed
    {
        if (!is_array($claims)) {
            return $claims;
        }
        $ordered = [];
        foreach (['region', 'ageConfirmed'] as $key) {
            if (array_key_exists($key, $claims)) {
                $ordered[$key] = $claims[$key];
            }
        }
        return $ordered + $claims;
    }
}
